import { SETTINGS_KEYS } from '$lib/constants';
import { DatabaseService } from '$lib/services/database.service';
import { chatStore } from '$lib/stores/chat/index.svelte';
import { conversationsStore } from '$lib/stores/conversations/index.svelte';
import { settingsStore } from '$lib/stores/settings/index.svelte';
import type {
	DatabaseMessage,
	DatabaseMessageExtra,
	MessageRequestProfile,
	StoryMetadata
} from '$lib/types';
import {
	generateStoryChaptersSequentially,
	getActiveStoryMetadata,
	notifyStoryApprovalNeeded,
	notifyStoryComplete,
	parseStoryOutlineText,
	storyMetadataFromOutlineMessage
} from '$lib/utils';
import { toast } from 'svelte-sonner';

const STORY_OUTLINE_REQUEST_PROFILE: MessageRequestProfile = { kind: 'story_outline' };

function responseNotificationsEnabled(): boolean {
	return settingsStore.config[SETTINGS_KEYS.ENABLE_RESPONSE_NOTIFICATIONS] !== false;
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

		chatStore.registerRequestProfileCompletionHandler('story_outline', ({ assistantMessage }) =>
			this.captureOutline(assistantMessage)
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

	private async persistStory(conversationId: string, story: StoryMetadata): Promise<StoryMetadata> {
		const nextStory = {
			...story,
			updatedAt: Date.now()
		};
		const outlineMessageId = nextStory.initialAssistantMessageId;

		if (!outlineMessageId) {
			await conversationsStore.updateConversationStory(conversationId, nextStory);

			return nextStory;
		}

		await DatabaseService.updateMessage(outlineMessageId, { story: nextStory });

		if (conversationsStore.activeConversation?.id === conversationId) {
			const messageIndex = conversationsStore.findMessageIndex(outlineMessageId);

			if (messageIndex !== -1) {
				conversationsStore.updateMessageAtIndex(messageIndex, { story: nextStory });
			}
		}

		const conversation =
			conversationsStore.activeConversation?.id === conversationId
				? conversationsStore.activeConversation
				: await DatabaseService.getConversation(conversationId);
		const legacyStory = conversation?.story;

		if (
			legacyStory &&
			(!legacyStory.initialAssistantMessageId ||
				legacyStory.initialAssistantMessageId === outlineMessageId)
		) {
			await conversationsStore.updateConversationStory(conversationId, undefined);
		}

		return nextStory;
	}

	private getActiveStory(): StoryMetadata | undefined {
		return getActiveStoryMetadata(
			conversationsStore.activeConversation,
			conversationsStore.activeMessages
		);
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
		const legacyStory = conversation.story;
		const baseStory =
			assistantMessage.story ??
			(legacyStory &&
			(!legacyStory.initialAssistantMessageId ||
				legacyStory.initialAssistantMessageId === assistantMessage.id)
				? legacyStory
				: this.createBaseStory(prompt, 'outline_generating'));
		const nextStory = storyMetadataFromOutlineMessage(assistantMessage, prompt, {
			...baseStory,
			initialUserMessageId: userMessage.id
		});

		if (!nextStory) return;

		if (nextStory.phase === 'error') {
			await this.persistStory(conversation.id, nextStory);
			toast.error('Story outline could not be parsed', {
				description: nextStory.error
			});

			return;
		}

		await this.persistStory(conversation.id, nextStory);
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
		const story = storyOverride ?? this.getActiveStory();

		if (!activeConversation || !story?.initialAssistantMessageId || !story.initialPrompt) return;

		await this.activateOutlineBranch(activeConversation.id, story);

		await chatStore.regenerateMessageWithBranching(story.initialAssistantMessageId);
	}

	async approveOutline(outlineText: string, storyOverride?: StoryMetadata): Promise<void> {
		const activeConversation = conversationsStore.activeConversation;
		const currentStory = storyOverride ?? this.getActiveStory();

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
			chapterMessageIds: [],
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
		let generationStory = await this.persistStory(activeConversation.id, approvedStory);

		this.stoppedConversationIds.delete(activeConversation.id);

		try {
			await generateStoryChaptersSequentially(
				outline.chapters,
				async (prompt, _chapter, index) => {
					if (this.stoppedConversationIds.has(activeConversation.id)) {
						throw new StoryGenerationStoppedError();
					}

					const assistantMessage = await this.generateChapter(activeConversation.id, prompt);

					if (this.stoppedConversationIds.has(activeConversation.id)) {
						throw new StoryGenerationStoppedError();
					}

					if (assistantMessage) {
						const chapterMessageIds = [...(generationStory.chapterMessageIds ?? [])];

						chapterMessageIds[index] = assistantMessage.id;
						generationStory = await this.persistStory(activeConversation.id, {
							...generationStory,
							chapterMessageIds
						});
					}
				},
				async (_chapter, i) => {
					generationStory = await this.persistStory(activeConversation.id, {
						...generationStory,
						currentChapterIndex: i,
						phase: 'generating'
					});
				}
			);

			generationStory = await this.persistStory(activeConversation.id, {
				...generationStory,
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

				await this.persistStory(activeConversation.id, {
					...generationStory,
					error: undefined,
					phase: 'stopped'
				});

				return;
			}

			const message = error instanceof Error ? error.message : String(error);

			await this.persistStory(activeConversation.id, {
				...generationStory,
				error: message,
				phase: 'error'
			});
			toast.error('Story generation failed', { description: message });
		}
	}

	async stopGeneration(): Promise<void> {
		const activeConversation = conversationsStore.activeConversation;

		if (!activeConversation) return;

		const story = this.getActiveStory();

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
