import { toast } from 'svelte-sonner';
import { SETTINGS_KEYS } from '$lib/constants';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { DatabaseService } from '$lib/services/database.service';
import { config } from '$lib/stores/settings.svelte';
import {
	notifyStoryApprovalNeeded,
	notifyStoryComplete,
	generateStoryChaptersSequentially,
	parseStoryOutlineText,
	storyMetadataFromOutlineMessage
} from '$lib/utils';
import type {
	DatabaseMessage,
	DatabaseMessageExtra,
	MessageRequestProfile,
	StoryMetadata
} from '$lib/types';

const STORY_OUTLINE_REQUEST_PROFILE: MessageRequestProfile = { kind: 'story_outline' };

function responseNotificationsEnabled(): boolean {
	return config()[SETTINGS_KEYS.ENABLE_RESPONSE_NOTIFICATIONS] !== false;
}

class StoryGenerationStoppedError extends Error {
	constructor() {
		super('Story generation stopped');
		this.name = 'StoryGenerationStoppedError';
	}
}

class StoryStore {
	private activeChapterStops = new Map<string, () => void>();
	private stoppedConversationIds = new Set<string>();
	private requestProfileHandlerRegistered = false;

	ensureRequestProfileCompletionHandler(): void {
		if (this.requestProfileHandlerRegistered) return;

		chatStore.registerRequestProfileCompletionHandler(
			'story_outline',
			({ assistantMessage }) => this.captureOutline(assistantMessage)
		);
		this.requestProfileHandlerRegistered = true;
	}

	private createBaseStory(prompt: string, phase: StoryMetadata['phase']): StoryMetadata {
		return {
			initialPrompt: prompt,
			phase,
			updatedAt: Date.now()
		};
	}

	private async persistStory(conversationId: string, story: StoryMetadata): Promise<void> {
		await conversationsStore.updateConversationStory(conversationId, {
			...story,
			updatedAt: Date.now()
		});
	}

	private async activateOutlineBranch(conversationId: string, story: StoryMetadata): Promise<void> {
		if (
			!story.initialAssistantMessageId ||
			conversationsStore.activeConversation?.id !== conversationId
		) {
			return;
		}

		await conversationsStore.updateCurrentNode(story.initialAssistantMessageId);
		await conversationsStore.refreshActiveMessages();
	}

	private async captureOutline(assistantMessage: DatabaseMessage): Promise<void> {
		const conversation = await DatabaseService.getConversation(assistantMessage.convId);

		if (!conversation) return;

		const messages = await DatabaseService.getConversationMessages(assistantMessage.convId);
		const userMessage = messages.find((message) => message.id === assistantMessage.parent);

		if (!userMessage) return;

		const prompt = userMessage.content;
		const baseStory = conversation.story ?? this.createBaseStory(prompt, 'outline_generating');
		const nextStory = storyMetadataFromOutlineMessage(assistantMessage, prompt, {
			...baseStory,
			initialUserMessageId: userMessage.id
		});

		if (!nextStory) return;

		if (nextStory.phase === 'error') {
			await conversationsStore.updateConversationStory(conversation.id, {
				...nextStory,
				updatedAt: Date.now()
			});
			toast.error('Story outline could not be parsed', {
				description: nextStory.error
			});
			return;
		}

		await conversationsStore.updateConversationStory(conversation.id, {
			...nextStory,
			updatedAt: Date.now()
		});
		await conversationsStore.updateConversationName(conversation.id, nextStory.title!);

		toast.info('Story outline ready for approval');
		notifyStoryApprovalNeeded(responseNotificationsEnabled());
	}

	private async generateChapter(
		conversationId: string,
		prompt: string
	): Promise<DatabaseMessage | undefined> {
		return new Promise((resolve, reject) => {
			let settled = false;

			const settle = (message?: DatabaseMessage) => {
				if (settled) return;
				settled = true;
				this.activeChapterStops.delete(conversationId);
				resolve(message);
			};

			this.activeChapterStops.set(conversationId, () => settle());

			chatStore
				.sendMessage(prompt, undefined, {
					conversationId,
					onComplete: (assistantMessage) => settle(assistantMessage)
				})
				.then(() => {
					if (this.stoppedConversationIds.has(conversationId)) settle();
				})
				.catch((error) => {
					this.activeChapterStops.delete(conversationId);
					reject(error);
				});
		});
	}

	async startOutline(prompt: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		let conversationId = conversationsStore.activeConversation?.id;

		if (!conversationId) {
			conversationId = await conversationsStore.createConversation(undefined, { mode: 'story' });
		}

		this.stoppedConversationIds.delete(conversationId);
		await this.persistStory(conversationId, this.createBaseStory(prompt, 'outline_generating'));

		await chatStore.sendMessage(prompt, extras, {
			conversationId,
			mode: 'story',
			requestProfile: STORY_OUTLINE_REQUEST_PROFILE
		});
	}

	async sendMessage(prompt: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		await chatStore.sendMessage(prompt, extras);
	}

	async regenerateOutline(storyOverride?: StoryMetadata): Promise<void> {
		const activeConversation = conversationsStore.activeConversation;
		const story = storyOverride ?? activeConversation?.story;

		if (!activeConversation || !story?.initialAssistantMessageId || !story.initialPrompt) return;

		await this.activateOutlineBranch(activeConversation.id, story);

		await this.persistStory(activeConversation.id, {
			...story,
			error: undefined,
			phase: 'outline_generating'
		});

		await chatStore.regenerateMessageWithBranching(story.initialAssistantMessageId, {
			conversationId: activeConversation.id,
			requestProfile: STORY_OUTLINE_REQUEST_PROFILE
		});
	}

	async approveOutline(outlineText: string, storyOverride?: StoryMetadata): Promise<void> {
		const activeConversation = conversationsStore.activeConversation;
		const currentStory = storyOverride ?? activeConversation?.story;

		if (!activeConversation || !currentStory) return;

		await this.activateOutlineBranch(activeConversation.id, currentStory);

		const parseResult = parseStoryOutlineText(outlineText);

		if (!parseResult.outline) {
			await this.persistStory(activeConversation.id, {
				...currentStory,
				error: parseResult.error,
				outlineText,
				phase: 'awaiting_approval'
			});
			toast.error('Story outline needs a quick edit', { description: parseResult.error });
			return;
		}

		const outline = parseResult.outline;
		const approvedStory: StoryMetadata = {
			...currentStory,
			approvedAt: Date.now(),
			chapterSummaries: outline.chapters,
			currentChapterIndex: 0,
			error: undefined,
			outlineText,
			phase: 'generating',
			summary: outline.summary,
			title: outline.title,
			updatedAt: Date.now()
		};

		await conversationsStore.updateConversationName(activeConversation.id, outline.title);
		await this.persistStory(activeConversation.id, approvedStory);
		this.stoppedConversationIds.delete(activeConversation.id);

		try {
			await generateStoryChaptersSequentially(
				outline.chapters,
				async (prompt) => {
					if (this.stoppedConversationIds.has(activeConversation.id)) {
						throw new StoryGenerationStoppedError();
					}

					await this.generateChapter(activeConversation.id, prompt);

					if (this.stoppedConversationIds.has(activeConversation.id)) {
						throw new StoryGenerationStoppedError();
					}
				},
				(_chapter, i) =>
					this.persistStory(activeConversation.id, {
						...approvedStory,
						currentChapterIndex: i,
						phase: 'generating'
					})
			);

			await this.persistStory(activeConversation.id, {
				...approvedStory,
				currentChapterIndex: outline.chapters.length,
				phase: 'complete'
			});

			toast.success('Final story chapter complete');
			notifyStoryComplete(responseNotificationsEnabled());
		} catch (error) {
			if (
				error instanceof StoryGenerationStoppedError ||
				this.stoppedConversationIds.has(activeConversation.id)
			) {
				this.stoppedConversationIds.delete(activeConversation.id);
				const latestStory = conversationsStore.activeConversation?.story ?? approvedStory;

				await this.persistStory(activeConversation.id, {
					...latestStory,
					error: undefined,
					phase: 'stopped'
				});
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			await this.persistStory(activeConversation.id, {
				...approvedStory,
				error: message,
				phase: 'error'
			});
			toast.error('Story generation failed', { description: message });
		}
	}

	async stopGeneration(): Promise<void> {
		const activeConversation = conversationsStore.activeConversation;

		if (!activeConversation) return;

		const story = activeConversation.story;

		this.stoppedConversationIds.add(activeConversation.id);
		this.activeChapterStops.get(activeConversation.id)?.();

		await chatStore.stopGenerationForChat(activeConversation.id);

		if (story?.phase === 'outline_generating' || story?.phase === 'generating') {
			await this.persistStory(activeConversation.id, {
				...story,
				phase: 'stopped'
			});
		}
	}
}

export const storyStore = new StoryStore();
