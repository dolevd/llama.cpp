import {
	STORY_FIRST_CHAPTER_PROMPT_PREFIX,
	STORY_NEXT_CHAPTER_PROMPT_PREFIX,
	STORY_OUTLINE_TOOL,
	STORY_OUTLINE_TOOL_INSTRUCTION,
	STORY_OUTLINE_TOOL_NAME
} from '$lib/constants/story';
import { MessageRole } from '$lib/enums';
import type { ApiChatCompletionRequest, ApiChatCompletionToolCall } from '$lib/types/api';
import type {
	DatabaseConversation,
	DatabaseMessage,
	MessageRequestProfile,
	StoryChapterSummary,
	StoryMetadata
} from '$lib/types/database';

export interface StoryOutline {
	title: string;
	summary: string;
	chapters: StoryChapterSummary[];
}

export interface StoryOutlineParseResult {
	outline?: StoryOutline;
	error?: string;
}

export interface ResolvedRequestProfile {
	disableAgentic: true;
	messages: DatabaseMessage[];
	profile: MessageRequestProfile;
	tool_choice: NonNullable<ApiChatCompletionRequest['tool_choice']>;
	tools: NonNullable<ApiChatCompletionRequest['tools']>;
	userMessage: DatabaseMessage;
}

const CHAPTER_HEADING_REGEX = /^##\s+(?:Chapter\s+\d+\s*:?\s*)?(.*)$/i;
const STORY_DISPLAY_PHASES = new Set<StoryMetadata['phase']>([
	'awaiting_approval',
	'error',
	'generating',
	'complete',
	'stopped'
]);

function cleanString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function validateOutline(value: unknown): StoryOutlineParseResult {
	if (!value || typeof value !== 'object') {
		return { error: 'The story outline tool returned an invalid payload.' };
	}

	const record = value as Record<string, unknown>;
	const title = cleanString(record.title);
	const summary = cleanString(record.summary);
	const chaptersValue = record.chapters;

	if (!title) {
		return { error: 'The story outline is missing a title.' };
	}

	if (!summary) {
		return { error: 'The story outline is missing a summary.' };
	}

	if (!Array.isArray(chaptersValue) || chaptersValue.length === 0) {
		return { error: 'The story outline must include at least one chapter.' };
	}

	const chapters = chaptersValue.map((chapter, index) => {
		const chapterRecord =
			chapter && typeof chapter === 'object' ? (chapter as Record<string, unknown>) : {};

		return {
			title: cleanString(chapterRecord.title) || `Chapter ${index + 1}`,
			summary: cleanString(chapterRecord.summary)
		};
	});

	const invalidChapterIndex = chapters.findIndex((chapter) => !chapter.summary);

	if (invalidChapterIndex !== -1) {
		return {
			error: `Chapter ${invalidChapterIndex + 1} is missing a summary.`
		};
	}

	return {
		outline: {
			title,
			summary,
			chapters
		}
	};
}

export function parseStoryOutlineToolCalls(toolCallsValue?: string | null): StoryOutlineParseResult {
	if (!toolCallsValue?.trim()) {
		return { error: 'The model did not call the story outline tool.' };
	}

	let toolCalls: ApiChatCompletionToolCall[];

	try {
		toolCalls = JSON.parse(toolCallsValue) as ApiChatCompletionToolCall[];
	} catch {
		return { error: 'The story outline tool call could not be parsed.' };
	}

	if (!Array.isArray(toolCalls)) {
		return { error: 'The story outline tool call was not an array.' };
	}

	const outlineCall = toolCalls.find((call) => call.function?.name === STORY_OUTLINE_TOOL_NAME);

	if (!outlineCall) {
		return { error: 'The model did not call the story outline tool.' };
	}

	const args = outlineCall.function?.arguments;

	if (!args?.trim()) {
		return { error: 'The story outline tool call did not include arguments.' };
	}

	try {
		return validateOutline(JSON.parse(args));
	} catch {
		return { error: 'The story outline tool arguments were not valid JSON.' };
	}
}

export function storyOutlineToText(outline: StoryOutline): string {
	const lines = [`# ${outline.title}`, '', outline.summary.trim(), ''];

	outline.chapters.forEach((chapter, index) => {
		lines.push(`## Chapter ${index + 1}: ${chapter.title}`, '', chapter.summary.trim(), '');
	});

	return lines.join('\n').trim();
}

export function stripStoryOutlineInstruction(content: string): string {
	const suffix = `\n\n${STORY_OUTLINE_TOOL_INSTRUCTION}`;

	if (content.endsWith(suffix)) {
		return content.slice(0, -suffix.length).trim();
	}

	return content.trim();
}

function withStoryOutlineInstruction(content: string): string {
	const prompt = stripStoryOutlineInstruction(content);

	return `${prompt}\n\n${STORY_OUTLINE_TOOL_INSTRUCTION}`.trim();
}

export function resolveChatRequestProfile(
	messages: DatabaseMessage[],
	profileOverride?: MessageRequestProfile
): ResolvedRequestProfile | undefined {
	const userMessage = messages[messages.length - 1];
	const profile = userMessage?.requestProfile ?? profileOverride;

	if (!userMessage || userMessage.role !== MessageRole.USER || profile?.kind !== 'story_outline') {
		return undefined;
	}

	return {
		disableAgentic: true,
		messages: messages.map((message, index) =>
			index === messages.length - 1
				? {
						...message,
						content: withStoryOutlineInstruction(message.content),
						requestProfile: profile
					}
				: message
		),
		profile,
		tool_choice: { type: 'function', function: { name: STORY_OUTLINE_TOOL_NAME } },
		tools: [STORY_OUTLINE_TOOL],
		userMessage
	};
}

export function storyMetadataFromOutlineMessage(
	assistantMessage: DatabaseMessage,
	initialPrompt: string,
	baseStory?: StoryMetadata
): StoryMetadata | undefined {
	const parseResult = parseStoryOutlineToolCalls(assistantMessage.toolCalls);
	const base: StoryMetadata = baseStory ?? {
		initialPrompt,
		phase: 'outline_generating',
		updatedAt: assistantMessage.timestamp
	};

	if (!parseResult.outline && !assistantMessage.toolCalls?.includes(STORY_OUTLINE_TOOL_NAME)) {
		return undefined;
	}

	if (!parseResult.outline) {
		return {
			...base,
			error: parseResult.error,
			initialAssistantMessageId: assistantMessage.id,
			initialPrompt,
			phase: 'error',
			updatedAt: assistantMessage.timestamp
		};
	}

	const outline = parseResult.outline;

	return {
		...base,
		chapterSummaries: outline.chapters,
		currentChapterIndex: 0,
		error: undefined,
		initialAssistantMessageId: assistantMessage.id,
		initialPrompt,
		outlineText: storyOutlineToText(outline),
		phase: 'awaiting_approval',
		summary: outline.summary,
		title: outline.title,
		updatedAt: assistantMessage.timestamp
	};
}

function getInitialPromptForOutlineMessage(
	messages: DatabaseMessage[],
	assistantMessage: DatabaseMessage
): string {
	const parent = messages.find((candidate) => candidate.id === assistantMessage.parent);

	if (parent?.role === MessageRole.USER) {
		return stripStoryOutlineInstruction(parent.content);
	}

	const assistantIndex = messages.findIndex((candidate) => candidate.id === assistantMessage.id);

	for (let i = assistantIndex - 1; i >= 0; i--) {
		const candidate = messages[i];
		if (candidate.role === MessageRole.USER) {
			return stripStoryOutlineInstruction(candidate.content);
		}
	}

	return '';
}

export function getStoryMetadataByMessageId(
	conversation: DatabaseConversation | null | undefined,
	messages: DatabaseMessage[]
): Map<string, StoryMetadata> {
	const result = new Map<string, StoryMetadata>();

	if (conversation?.mode !== 'story') {
		return result;
	}

	const activeStory = conversation.story;

	for (const message of messages) {
		if (message.role !== MessageRole.ASSISTANT) continue;

		const linkedStory =
			activeStory?.initialAssistantMessageId === message.id ? activeStory : undefined;

		if (linkedStory && STORY_DISPLAY_PHASES.has(linkedStory.phase)) {
			result.set(message.id, linkedStory);
			continue;
		}

		const prompt = getInitialPromptForOutlineMessage(messages, message);
		const initialPrompt = linkedStory?.initialPrompt ?? (prompt || activeStory?.initialPrompt || '');
		const derivedStory = storyMetadataFromOutlineMessage(message, initialPrompt, linkedStory);

		if (derivedStory && STORY_DISPLAY_PHASES.has(derivedStory.phase)) {
			result.set(message.id, derivedStory);
		}
	}

	return result;
}

export function getStoryChapterPrompt(index: number, summary: string): string {
	const prefix = index === 0 ? STORY_FIRST_CHAPTER_PROMPT_PREFIX : STORY_NEXT_CHAPTER_PROMPT_PREFIX;

	return `${prefix}${summary}`;
}

export async function generateStoryChaptersSequentially(
	chapters: StoryChapterSummary[],
	generateChapter: (
		prompt: string,
		chapter: StoryChapterSummary,
		index: number
	) => Promise<unknown>,
	onChapterStart?: (chapter: StoryChapterSummary, index: number) => Promise<void> | void
): Promise<void> {
	for (let index = 0; index < chapters.length; index++) {
		const chapter = chapters[index];

		await onChapterStart?.(chapter, index);
		await generateChapter(getStoryChapterPrompt(index, chapter.summary), chapter, index);
	}
}

export function parseStoryOutlineText(text: string): StoryOutlineParseResult {
	const trimmed = text.trim();

	if (!trimmed) {
		return { error: 'The story outline is empty.' };
	}

	const lines = trimmed.split(/\r?\n/);
	const titleLineIndex = lines.findIndex((line) => line.trim().startsWith('# '));
	const title =
		titleLineIndex === -1
			? ''
			: lines[titleLineIndex]
					.trim()
					.replace(/^#\s+/, '')
					.trim();

	if (!title) {
		return { error: 'The story outline is missing a title.' };
	}

	const chapterStarts = lines
		.map((line, index) => ({ line: line.trim(), index }))
		.filter(({ line }) => CHAPTER_HEADING_REGEX.test(line));

	if (chapterStarts.length === 0) {
		return { error: 'The story outline must include at least one chapter.' };
	}

	const summaryLines = lines
		.slice(titleLineIndex + 1, chapterStarts[0].index)
		.map((line) => line.trim())
		.filter(Boolean);
	const summary = summaryLines.join('\n\n').trim();

	if (!summary) {
		return { error: 'The story outline is missing a summary.' };
	}

	const chapters = chapterStarts.map(({ line, index }, chapterIndex) => {
		const nextStart = chapterStarts[chapterIndex + 1]?.index ?? lines.length;
		const titleMatch = line.match(CHAPTER_HEADING_REGEX);
		const chapterTitle = titleMatch?.[1]?.trim() || `Chapter ${chapterIndex + 1}`;
		const chapterSummary = lines
			.slice(index + 1, nextStart)
			.map((summaryLine) => summaryLine.trim())
			.filter(Boolean)
			.join('\n\n')
			.trim();

		return {
			title: chapterTitle,
			summary: chapterSummary
		};
	});

	const missingSummaryIndex = chapters.findIndex((chapter) => !chapter.summary);

	if (missingSummaryIndex !== -1) {
		return { error: `Chapter ${missingSummaryIndex + 1} is missing a summary.` };
	}

	return {
		outline: {
			title,
			summary,
			chapters
		}
	};
}
