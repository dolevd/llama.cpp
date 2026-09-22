import { describe, expect, it } from 'vitest';
import { STORY_OUTLINE_TOOL_INSTRUCTION, STORY_OUTLINE_TOOL_NAME } from '$lib/constants';
import {
	generateStoryChaptersSequentially,
	getActiveStoryMetadata,
	getStoryChapterOutlineItems,
	getStoryMetadataByMessageId,
	getStoryChapterPrompt,
	parseStoryOutlineText,
	parseStoryOutlineToolCalls,
	resolveChatRequestProfile,
	storyMetadataFromOutlineMessage,
	storyOutlineToText
} from '$lib/utils';
import { MessageRole } from '$lib/enums';
import type { DatabaseConversation, DatabaseMessage, StoryMetadata } from '$lib/types';

function toolCall(name: string, args: unknown): string {
	return JSON.stringify([
		{
			id: 'call_1',
			type: 'function',
			function: {
				name,
				arguments: typeof args === 'string' ? args : JSON.stringify(args)
			}
		}
	]);
}

function message(role: MessageRole, content: string, id = `${role}-1`): DatabaseMessage {
	return {
		id,
		convId: 'conv-1',
		type: 'text',
		timestamp: 123,
		role,
		content,
		parent: null,
		children: [],
		toolCalls: ''
	};
}

describe('resolveChatRequestProfile', () => {
	it('adds the story outline instruction only to the outbound API copy', () => {
		const userMessage: DatabaseMessage = {
			...message(MessageRole.USER, 'Continue from the attached snippet.'),
			requestProfile: { kind: 'story_outline' }
		};

		const result = resolveChatRequestProfile([userMessage]);

		expect(result?.messages[0].content).toContain('Continue from the attached snippet.');
		expect(result?.messages[0].content).toContain(STORY_OUTLINE_TOOL_INSTRUCTION);
		expect(userMessage.content).toBe('Continue from the attached snippet.');
		expect(result?.tools[0].function.name).toBe(STORY_OUTLINE_TOOL_NAME);
		expect(result?.tool_choice).toBe('required');
		expect(result?.disableAgentic).toBe(true);
	});

	it('applies only to the immediate profiled user turn', () => {
		const userMessage: DatabaseMessage = {
			...message(MessageRole.USER, 'Draft an outline.'),
			requestProfile: { kind: 'story_outline' }
		};
		const assistantMessage = message(MessageRole.ASSISTANT, '', 'assistant-1');
		const chapterMessage = message(MessageRole.USER, getStoryChapterPrompt(0, 'Open the gate.'));

		expect(resolveChatRequestProfile([userMessage, assistantMessage])).toBeUndefined();
		expect(resolveChatRequestProfile([chapterMessage])).toBeUndefined();
	});
});

describe('parseStoryOutlineToolCalls', () => {
	it('parses a valid story outline tool call', () => {
		const result = parseStoryOutlineToolCalls(
			toolCall(STORY_OUTLINE_TOOL_NAME, {
				title: 'The Ember Gate',
				summary: 'A mage follows a vanished road into an older kingdom.',
				chapters: [{ title: 'Ash Road', summary: 'The mage finds the hidden road.' }]
			})
		);

		expect(result.error).toBeUndefined();
		expect(result.outline?.title).toBe('The Ember Gate');
		expect(result.outline?.chapters).toHaveLength(1);
	});

	it('finds the story outline tool call among multiple calls', () => {
		const result = parseStoryOutlineToolCalls(
			JSON.stringify([
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'other_tool', arguments: '{}' }
				},
				{
					id: 'call_2',
					type: 'function',
					function: {
						name: STORY_OUTLINE_TOOL_NAME,
						arguments: JSON.stringify({
							title: 'Moonlit Archive',
							summary: 'A scholar bargains with an impossible library.',
							chapters: [{ title: 'The Door', summary: 'The library opens.' }]
						})
					}
				}
			])
		);

		expect(result.outline?.title).toBe('Moonlit Archive');
	});

	it('returns an error for malformed tool arguments', () => {
		const result = parseStoryOutlineToolCalls(toolCall(STORY_OUTLINE_TOOL_NAME, '{bad json'));

		expect(result.error).toBe('The story outline tool arguments were not valid JSON.');
	});

	it('returns an error when title is missing', () => {
		const result = parseStoryOutlineToolCalls(
			toolCall(STORY_OUTLINE_TOOL_NAME, {
				summary: 'No title here.',
				chapters: [{ title: 'One', summary: 'A beginning.' }]
			})
		);

		expect(result.error).toBe('The story outline is missing a title.');
	});

	it('returns an error when chapters are empty', () => {
		const result = parseStoryOutlineToolCalls(
			toolCall(STORY_OUTLINE_TOOL_NAME, {
				title: 'No Chapters',
				summary: 'A story with nowhere to go.',
				chapters: []
			})
		);

		expect(result.error).toBe('The story outline must include at least one chapter.');
	});
});

describe('storyMetadataFromOutlineMessage', () => {
	it('links outline metadata to the assistant message that called the story tool', () => {
		const message: DatabaseMessage = {
			id: 'assistant-outline-1',
			convId: 'conv-1',
			type: 'text',
			timestamp: 123,
			role: MessageRole.ASSISTANT,
			content: '',
			parent: 'user-1',
			children: [],
			toolCalls: toolCall(STORY_OUTLINE_TOOL_NAME, {
				title: 'The Ember Gate',
				summary: 'A mage follows a vanished road into an older kingdom.',
				chapters: [{ title: 'Ash Road', summary: 'The mage finds the hidden road.' }]
			})
		};

		const story = storyMetadataFromOutlineMessage(message, 'Continue the snippet.');

		expect(story).toMatchObject({
			initialAssistantMessageId: 'assistant-outline-1',
			initialPrompt: 'Continue the snippet.',
			phase: 'awaiting_approval',
			title: 'The Ember Gate',
			summary: 'A mage follows a vanished road into an older kingdom.'
		});
		expect(story?.outlineText).toContain('# The Ember Gate');
	});
});

describe('branch-local story metadata', () => {
	const conversation: DatabaseConversation = {
		currNode: 'outline-b',
		id: 'conv-1',
		lastModified: 123,
		mode: 'story',
		name: 'Story'
	};
	const storyA: StoryMetadata = {
		approvedAt: 1,
		chapterSummaries: [{ summary: 'The first A chapter.', title: 'A One' }],
		initialAssistantMessageId: 'outline-a',
		phase: 'complete',
		title: 'Outline A',
		updatedAt: 1
	};
	const storyB: StoryMetadata = {
		approvedAt: 2,
		chapterSummaries: [{ summary: 'The first B chapter.', title: 'B One' }],
		initialAssistantMessageId: 'outline-b',
		phase: 'generating',
		title: 'Outline B',
		updatedAt: 2
	};

	it('keeps sibling outlines attached to their own assistant messages', () => {
		const messages = [
			{ ...message(MessageRole.ASSISTANT, '', 'outline-a'), story: storyA },
			{ ...message(MessageRole.ASSISTANT, '', 'outline-b'), story: storyB }
		];
		const stories = getStoryMetadataByMessageId(conversation, messages);

		expect(stories.get('outline-a')?.title).toBe('Outline A');
		expect(stories.get('outline-b')?.title).toBe('Outline B');
		expect(getActiveStoryMetadata(conversation, [messages[1]])?.title).toBe('Outline B');
	});

	it('reads legacy conversation metadata for its matching outline message', () => {
		const legacyConversation = { ...conversation, story: storyA };
		const outlineMessage = message(MessageRole.ASSISTANT, '', 'outline-a');

		expect(getStoryMetadataByMessageId(legacyConversation, [outlineMessage]).get('outline-a')).toBe(
			storyA
		);
	});
});

describe('chapter outline progress', () => {
	const chapters = [
		{ summary: 'First summary.', title: 'One' },
		{ summary: 'Second summary.', title: 'Two' },
		{ summary: 'Third summary.', title: 'Three' }
	];

	it('targets assistant responses and reports generated, generating, and pending states', () => {
		const story: StoryMetadata = {
			approvedAt: 1,
			chapterMessageIds: ['assistant-1'],
			chapterSummaries: chapters,
			currentChapterIndex: 1,
			initialAssistantMessageId: 'outline-1',
			phase: 'generating',
			updatedAt: 1
		};
		const firstPrompt = {
			...message(MessageRole.USER, getStoryChapterPrompt(0, chapters[0].summary), 'user-1'),
			parent: 'outline-1'
		};
		const secondPrompt = {
			...message(MessageRole.USER, getStoryChapterPrompt(1, chapters[1].summary), 'user-2'),
			parent: 'assistant-1'
		};
		const messages = [
			message(MessageRole.ASSISTANT, '', 'outline-1'),
			firstPrompt,
			{ ...message(MessageRole.ASSISTANT, 'Chapter one.', 'assistant-1'), parent: 'user-1' },
			secondPrompt,
			{ ...message(MessageRole.ASSISTANT, 'Chapter two.', 'assistant-2'), parent: 'user-2' }
		];

		expect(getStoryChapterOutlineItems(story, messages)).toEqual([
			expect.objectContaining({ messageId: 'assistant-1', status: 'generated' }),
			expect.objectContaining({ messageId: 'assistant-2', status: 'generating' }),
			expect.objectContaining({ messageId: undefined, status: 'pending' })
		]);
	});

	it('reconstructs response targets for completed legacy stories', () => {
		const story: StoryMetadata = {
			approvedAt: 1,
			chapterSummaries: [chapters[0]],
			currentChapterIndex: 1,
			initialAssistantMessageId: 'outline-1',
			phase: 'complete',
			updatedAt: 1
		};
		const prompt = {
			...message(MessageRole.USER, getStoryChapterPrompt(0, chapters[0].summary), 'user-1'),
			parent: 'outline-1'
		};
		const response = {
			...message(MessageRole.ASSISTANT, 'Chapter one.', 'assistant-1'),
			parent: 'user-1'
		};

		expect(
			getStoryChapterOutlineItems(story, [
				message(MessageRole.ASSISTANT, '', 'outline-1'),
				prompt,
				response
			])[0]
		).toMatchObject({ messageId: 'assistant-1', status: 'generated' });
	});

	it('returns the interrupted chapter to pending after generation stops', () => {
		const story: StoryMetadata = {
			approvedAt: 1,
			chapterSummaries: chapters,
			currentChapterIndex: 1,
			phase: 'stopped',
			updatedAt: 1
		};

		expect(getStoryChapterOutlineItems(story, []).map((item) => item.status)).toEqual([
			'generated',
			'pending',
			'pending'
		]);
	});
});

describe('editable story outline text', () => {
	it('round-trips a story outline through editable markdown text', () => {
		const outline = {
			title: 'The Ember Gate',
			summary: 'A mage follows a vanished road into an older kingdom.',
			chapters: [
				{ title: 'Ash Road', summary: 'The mage finds the hidden road.' },
				{ title: 'Older Fire', summary: 'The road remembers its maker.' }
			]
		};

		const text = storyOutlineToText(outline);
		const result = parseStoryOutlineText(text);

		expect(result.error).toBeUndefined();
		expect(result.outline).toEqual(outline);
	});

	it('parses user-edited chapter headings with added and removed chapters', () => {
		const result = parseStoryOutlineText(`# The Changed Map

The story now follows a shorter path.

## Chapter 1: Lantern Dust

The first chapter moves the party into the ruined watchtower.

## Chapter 2: Salt Door

The second chapter opens the sea gate.`);

		expect(result.error).toBeUndefined();
		expect(result.outline?.title).toBe('The Changed Map');
		expect(result.outline?.chapters).toEqual([
			{
				title: 'Lantern Dust',
				summary: 'The first chapter moves the party into the ruined watchtower.'
			},
			{
				title: 'Salt Door',
				summary: 'The second chapter opens the sea gate.'
			}
		]);
	});

	it('returns an error when an edited chapter has no summary', () => {
		const result = parseStoryOutlineText(`# Hollow Crown

A missing chapter summary should be rejected.

## Chapter 1: Empty Room`);

		expect(result.error).toBe('Chapter 1 is missing a summary.');
	});
});

describe('story chapter generation sequencing', () => {
	it('uses the approved first-chapter prompt for chapter one and next-chapter prompt after that', () => {
		expect(getStoryChapterPrompt(0, 'Open the gate.')).toBe(
			'Approved. Please write the first chapter based on the following outline:\n\nOpen the gate.'
		);
		expect(getStoryChapterPrompt(1, 'Cross the bridge.')).toBe(
			'Please write the next chapter based on the following outline:\n\nCross the bridge.'
		);
	});

	it('waits for each chapter generation promise before starting the next chapter', async () => {
		const events: string[] = [];
		const resolvers: Array<() => void> = [];
		const generation = generateStoryChaptersSequentially(
			[
				{ title: 'One', summary: 'First summary.' },
				{ title: 'Two', summary: 'Second summary.' }
			],
			(prompt, chapter, index) => {
				events.push(`generate:${index}:${chapter.title}:${prompt}`);

				return new Promise<void>((resolve) => {
					resolvers.push(() => {
						events.push(`complete:${index}`);
						resolve();
					});
				});
			},
			(chapter, index) => {
				events.push(`start:${index}:${chapter.title}`);
			}
		);

		await Promise.resolve();

		expect(events).toEqual([
			'start:0:One',
			'generate:0:One:Approved. Please write the first chapter based on the following outline:\n\nFirst summary.'
		]);
		expect(resolvers).toHaveLength(1);

		resolvers[0]();
		await Promise.resolve();
		await Promise.resolve();

		expect(events).toEqual([
			'start:0:One',
			'generate:0:One:Approved. Please write the first chapter based on the following outline:\n\nFirst summary.',
			'complete:0',
			'start:1:Two',
			'generate:1:Two:Please write the next chapter based on the following outline:\n\nSecond summary.'
		]);

		resolvers[1]();
		await generation;

		expect(events.at(-1)).toBe('complete:1');
	});
});
