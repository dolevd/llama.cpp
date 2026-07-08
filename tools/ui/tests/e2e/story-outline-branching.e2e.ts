import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type MockMessage = { content?: unknown };
type ToolChoice = { type?: string; function?: { name?: string } };
type ChatCompletionBody = {
	chat_template_kwargs?: { enable_thinking?: boolean };
	messages?: MockMessage[];
	thinking_budget_tokens?: number;
	tool_choice?: unknown;
	tools?: unknown;
};
type MockRequest = { body?: ChatCompletionBody };
type MockRequestWithBody = { body: ChatCompletionBody };
type MockState = { chatCompletions: MockRequest[] };

function messageContentIncludes(content: unknown, text: string): boolean {
	if (typeof content === 'string') return content.includes(text);
	if (!Array.isArray(content)) return false;

	return content.some(
		(part) =>
			part &&
			typeof part === 'object' &&
			'text' in part &&
			typeof part.text === 'string' &&
			part.text.includes(text)
	);
}

function isStoryToolChoice(toolChoice: unknown): toolChoice is ToolChoice {
	return (
		!!toolChoice &&
		typeof toolChoice === 'object' &&
		'type' in toolChoice &&
		toolChoice.type === 'function' &&
		'function' in toolChoice &&
		!!toolChoice.function &&
		typeof toolChoice.function === 'object' &&
		'name' in toolChoice.function &&
		toolChoice.function.name === 'submit_story_outline'
	);
}

async function startStoryOutline(page: Page) {
	await page.locator('input[type="file"]').setInputFiles({
		name: 'story-snippet.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from("The old road rang like a bell beneath Mira's boots.")
	});

	const textarea = page.getByPlaceholder('Edit the story prompt, then attach context...');
	await expect(textarea).toBeEnabled();
	await textarea.fill('mock-scenario: story-outline');
	await page.getByRole('button', { name: 'Send' }).click();

	await expect(page.getByText('Story outline', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
}

async function setDefaultReasoningEffort(page: Page, effort: 'low' | 'medium' | 'high' | 'max') {
	await page.addInitScript((value) => {
		localStorage.setItem('LlamaUi.reasoningEffortDefault', value);
	}, effort);
}

async function setReasoningEffort(
	page: Page,
	buttonName: RegExp | string,
	effort: 'Off' | 'Low' | 'Medium' | 'High' | 'Max'
) {
	await page.getByRole('button', { name: buttonName }).last().click();
	await page.getByRole('button', { name: new RegExp(`^${effort}\\b`) }).click();
}

async function getMockRequests(page: Page): Promise<MockState> {
	return page.request.get('/__mock/requests').then((response) => response.json());
}

function getStoryRequests(mockState: MockState): MockRequestWithBody[] {
	return mockState.chatCompletions.filter(
		(entry): entry is MockRequestWithBody =>
			!!entry.body &&
			isStoryToolChoice(entry.body.tool_choice) &&
			entry.body.messages?.some((message) =>
				messageContentIncludes(message.content, 'mock-scenario: story-outline')
			) === true
	);
}

function getChapterRequests(mockState: MockState): MockRequestWithBody[] {
	return mockState.chatCompletions.filter(
		(entry): entry is MockRequestWithBody =>
			!!entry.body &&
			!entry.body?.tool_choice &&
			entry.body?.messages?.some(
				(message) =>
					messageContentIncludes(message.content, 'Approved. Please write the first chapter') ||
					messageContentIncludes(message.content, 'Please write the next chapter')
			) === true
	);
}

test.describe('Story outline branching with mock llama.cpp server', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		await page.request.delete('/__mock/requests');
		await page.addInitScript(() => {
			localStorage.removeItem('LlamaUi.thinkingEnabledDefault');
			localStorage.removeItem('LlamaUi.reasoningEffortDefault');
			localStorage.setItem('LlamaUi.mcpServersSetupDone', 'true');
			localStorage.setItem(
				'LlamaUi.config',
				JSON.stringify({
					titleGenerationUseLLM: false,
					preEncodeConversation: false
				})
			);
		});
	});

	test('regenerates story outlines as branches and removes the attached outline on delete', async ({
		page
	}) => {
		await page.goto('/#/story');

		await expect(page.getByRole('heading', { name: 'Start a story' })).toBeVisible();

		await page.locator('input[type="file"]').setInputFiles({
			name: 'story-snippet.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from("The old road rang like a bell beneath Mira's boots.")
		});

		const textarea = page.getByPlaceholder('Edit the story prompt, then attach context...');
		await expect(textarea).toBeEnabled();
		await textarea.fill('mock-scenario: story-outline');
		await page.getByRole('button', { name: 'Send' }).click();

		const userMessage = page.getByLabel('User message with actions').first();
		await expect(userMessage).toContainText('mock-scenario: story-outline');
		await expect(userMessage).not.toContainText('submit_story_outline');

		await expect(page.getByText('Story outline', { exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Chapter 1: The Brass Seed' })).toBeVisible();

		await page
			.getByLabel('Assistant message with actions')
			.getByRole('button', { name: 'Regenerate' })
			.click();

		await expect(page.getByRole('heading', { name: 'The Lantern Archive' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Chapter 1: Borrowed Flame' })).toBeVisible();
		await expect(page.getByLabel('Message version 2 of 2')).toBeVisible();

		await page.getByRole('button', { name: 'Previous version' }).click();
		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'The Lantern Archive' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Approve story outline' })).toBeEnabled();

		await page.getByRole('button', { name: 'Next version' }).click();
		await expect(page.getByRole('heading', { name: 'The Lantern Archive' })).toBeVisible();

		await page
			.getByLabel('Assistant message with actions')
			.getByRole('button', { name: 'Delete' })
			.click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

		await expect(page.getByRole('heading', { name: 'The Lantern Archive' })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Approve story outline' })).toBeEnabled();

		await page.getByRole('button', { name: 'Approve story outline' }).click();
		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
		await expect(page.getByText('This is a mock streaming response.').first()).toBeVisible();

		const mockState = await page.request
			.get('/__mock/requests')
			.then((response) => response.json());
		const storyRequests = mockState.chatCompletions.filter(
			(entry: {
				body?: {
					messages?: Array<{ content?: unknown }>;
					tool_choice?: { type?: string; function?: { name?: string } };
				};
			}) =>
				entry.body?.tool_choice?.type === 'function' &&
				entry.body.tool_choice.function?.name === 'submit_story_outline' &&
				entry.body?.messages?.some((message) =>
					messageContentIncludes(message.content, 'mock-scenario: story-outline')
				)
		);

		expect(storyRequests).toHaveLength(2);
		const chapterRequests = mockState.chatCompletions.filter(
			(entry: { body?: { messages?: Array<{ content?: unknown }>; tool_choice?: unknown } }) =>
				!entry.body?.tool_choice &&
				entry.body?.messages?.some(
					(message) =>
						messageContentIncludes(message.content, 'Approved. Please write the first chapter') ||
						messageContentIncludes(message.content, 'Please write the next chapter')
				)
		);

		expect(chapterRequests).toHaveLength(2);
		expect(
			chapterRequests.some((entry: { body?: { messages?: Array<{ content?: unknown }> } }) =>
				entry.body?.messages?.some((message) =>
					messageContentIncludes(message.content, 'Mira finds the seed ticking')
				)
			)
		).toBe(true);
		expect(
			chapterRequests.some((entry: { body?: { messages?: Array<{ content?: unknown }> } }) =>
				entry.body?.messages?.some((message) =>
					messageContentIncludes(message.content, 'Ilan steals the lantern')
				)
			)
		).toBe(false);

		for (const request of storyRequests) {
			expect(request.body.tool_choice).toEqual({
				type: 'function',
				function: { name: 'submit_story_outline' }
			});
			expect(request.body.tools).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						function: expect.objectContaining({ name: 'submit_story_outline' })
					})
				])
			);
			expect(
				request.body.messages?.some((message: { content?: unknown }) =>
					messageContentIncludes(
						message.content,
						'Use the submit_story_outline tool to submit the story title'
					)
				)
			).toBe(true);
		}
	});

	test('keeps story outline request behavior when editing and resending the first prompt', async ({
		page
	}) => {
		await page.goto('/#/story');

		await page.locator('input[type="file"]').setInputFiles({
			name: 'story-snippet.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from("The old road rang like a bell beneath Mira's boots.")
		});

		const textarea = page.getByPlaceholder('Edit the story prompt, then attach context...');
		await textarea.fill('mock-scenario: story-outline before edit');
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();

		await page
			.getByLabel('User message with actions')
			.getByRole('button', { name: 'Edit' })
			.click();
		const editTextarea = page.getByPlaceholder('Edit your message...');
		await editTextarea.fill('mock-scenario: story-outline edited');
		await editTextarea
			.locator('xpath=ancestor::form')
			.getByRole('button', { name: 'Send' })
			.click();

		await expect(page.getByRole('heading', { name: 'The Lantern Archive' })).toBeVisible();
		await expect(page.getByLabel('User message with actions')).toContainText(
			'mock-scenario: story-outline edited'
		);
		await expect(page.getByLabel('User message with actions')).not.toContainText(
			'submit_story_outline'
		);

		const mockState = await page.request
			.get('/__mock/requests')
			.then((response) => response.json());
		const storyRequests = mockState.chatCompletions.filter(
			(entry: {
				body?: {
					messages?: Array<{ content?: unknown }>;
					tool_choice?: { type?: string; function?: { name?: string } };
				};
			}) =>
				entry.body?.tool_choice?.type === 'function' &&
				entry.body.tool_choice.function?.name === 'submit_story_outline'
		);

		expect(storyRequests).toHaveLength(2);
		expect(
			storyRequests.some((entry: { body?: { messages?: Array<{ content?: unknown }> } }) =>
				entry.body?.messages?.some(
					(message) =>
						messageContentIncludes(message.content, 'mock-scenario: story-outline edited') &&
						messageContentIncludes(
							message.content,
							'Use the submit_story_outline tool to submit the story title'
						)
				)
			)
		).toBe(true);
	});

	test('uses approval-message reasoning effort for chapter generation', async ({ page }) => {
		await setDefaultReasoningEffort(page, 'high');
		await page.goto('/#/story');

		await page.locator('input[type="file"]').setInputFiles({
			name: 'story-snippet.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from("The old road rang like a bell beneath Mira's boots.")
		});

		const textarea = page.getByPlaceholder('Edit the story prompt, then attach context...');
		await expect(textarea).toBeEnabled();
		await textarea.fill('mock-scenario: story-outline');
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.getByRole('heading', { name: 'The Clockwork Orchard' })).toBeVisible();
		await expect(page.getByText('Chapter reasoning')).toBeVisible();

		await setReasoningEffort(page, /high Reasoning\. Click to configure\./, 'Low');
		await expect(page.getByText('Chapter reasoning')).toBeVisible();
		await expect(
			page.getByRole('button', { name: /low Reasoning\. Click to configure\./ }).last()
		).toBeVisible();

		await page.getByRole('button', { name: 'Approve story outline' }).click();
		await expect(page.getByText('This is a mock streaming response.').first()).toBeVisible();

		const mockState = await getMockRequests(page);
		const storyRequests = getStoryRequests(mockState);
		const chapterRequests = getChapterRequests(mockState);

		expect(storyRequests).toHaveLength(1);
		expect(chapterRequests).toHaveLength(2);
		expect(storyRequests[0].body.chat_template_kwargs).toEqual(
			expect.objectContaining({ enable_thinking: true })
		);
		expect(storyRequests[0].body.thinking_budget_tokens).toBe(8192);

		for (const request of chapterRequests) {
			expect(request.body.chat_template_kwargs).toEqual(
				expect.objectContaining({ enable_thinking: true })
			);
			expect(request.body.thinking_budget_tokens).toBe(512);
		}
	});

	test('can disable reasoning from the story approval message before chapters', async ({
		page
	}) => {
		await setDefaultReasoningEffort(page, 'high');
		await page.goto('/#/story');
		await startStoryOutline(page);

		await expect(page.getByText('Chapter reasoning')).toBeVisible();
		await setReasoningEffort(page, /high Reasoning\. Click to configure\./, 'Off');
		await expect(page.getByText('Chapter reasoning')).toBeVisible();
		await expect(
			page.getByRole('button', { name: /Disabled Reasoning\. Click to configure\./ }).last()
		).toBeVisible();

		await page.getByRole('button', { name: 'Approve story outline' }).click();
		await expect(page.getByText('This is a mock streaming response.').first()).toBeVisible();

		const mockState = await getMockRequests(page);
		const storyRequests = getStoryRequests(mockState);
		const chapterRequests = getChapterRequests(mockState);

		expect(storyRequests).toHaveLength(1);
		expect(chapterRequests).toHaveLength(2);
		expect(storyRequests[0].body.chat_template_kwargs).toEqual(
			expect.objectContaining({ enable_thinking: true })
		);
		expect(storyRequests[0].body.thinking_budget_tokens).toBe(8192);

		for (const request of chapterRequests) {
			expect(request.body.chat_template_kwargs).toEqual(
				expect.objectContaining({ enable_thinking: false })
			);
			expect(request.body.thinking_budget_tokens).toBeUndefined();
		}
	});
});
