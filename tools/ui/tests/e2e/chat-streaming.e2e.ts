import { expect, test } from '@playwright/test';

test.describe('Chat streaming with mock llama.cpp server', () => {
	test.beforeEach(async ({ page }) => {
		await page.request.delete('/__mock/requests');
		await page.addInitScript(() => {
			localStorage.setItem(
				'LlamaUi.config',
				JSON.stringify({
					titleGenerationUseLLM: false,
					preEncodeConversation: false
				})
			);
		});
	});

	test('streams assistant tokens from the mock server and records the chat request', async ({
		page
	}) => {
		await page.goto('/');

		await expect(page.getByText('Server unavailable')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Hello there' })).toBeVisible();

		const textarea = page.getByPlaceholder('Type a message...');
		await expect(textarea).toBeEnabled();
		await textarea.fill('Please stream a deterministic mock response.');
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(
			page
				.getByLabel('User message with actions')
				.getByText('Please stream a deterministic mock response.')
		).toBeVisible();
		await expect(
			page.getByLabel('Assistant message with actions').getByText('This is a mock streaming')
		).toBeVisible();
		await expect(
			page
				.getByLabel('Assistant message with actions')
				.getByText('This is a mock streaming response.')
		).toBeVisible();

		const mockState = await page.request
			.get('/__mock/requests')
			.then((response) => response.json());
		const chatRequest = mockState.chatCompletions.find(
			(entry: { body?: { messages?: unknown[] } }) =>
				entry.body?.messages?.some((message) => {
					if (typeof message !== 'object' || message === null) return false;
					const candidate = message as { role?: unknown; content?: unknown };
					return (
						candidate.role === 'user' &&
						candidate.content === 'Please stream a deterministic mock response.'
					);
				})
		);

		expect(chatRequest).toBeTruthy();
		expect(chatRequest.body.stream).toBe(true);
		expect(chatRequest.body.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: 'user',
					content: 'Please stream a deterministic mock response.'
				})
			])
		);
	});

	test('handles reasoning-content chunks before visible assistant text', async ({ page }) => {
		await page.goto('/');

		const textarea = page.getByPlaceholder('Type a message...');
		await expect(textarea).toBeEnabled();
		await textarea.fill('mock-scenario: reasoning');
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(
			page.getByLabel('Assistant message with actions').getByText('Reasoning stream')
		).toBeVisible();
		await expect(
			page.getByLabel('Assistant message with actions').getByText('Reasoning stream complete.')
		).toBeVisible();
	});
});
