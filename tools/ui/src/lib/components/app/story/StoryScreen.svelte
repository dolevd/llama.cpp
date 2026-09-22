<script lang="ts">
	import StoryChapterOutline from './StoryChapterOutline.svelte';
	import StoryMessageAddons from './StoryMessageAddons.svelte';
	import ChatScreen from '$lib/components/app/chat/ChatScreen/ChatScreen.svelte';
	import { STORY_INITIAL_PROMPT } from '$lib/constants';
	import { chatStore, conversationsStore } from '$lib/stores';
	import { storyStore } from '$lib/stores/story.svelte';
	import type { DatabaseMessageExtra } from '$lib/types';
	import {
		getActiveStoryMetadata,
		getStoryChapterOutlineItems,
		getStoryMetadataByMessageId
	} from '$lib/utils';

	interface Props {
		showCenteredEmpty?: boolean;
	}

	let { showCenteredEmpty = false }: Props = $props();

	storyStore.ensureRequestProfileCompletionHandler();

	let activeStory = $derived(
		getActiveStoryMetadata(conversationsStore.activeConversation, conversationsStore.activeMessages)
	);
	let isStoryStart = $derived(
		!conversationsStore.activeConversation && conversationsStore.activeMessages.length === 0
	);
	let isCurrentConversationLoading = $derived(chatStore.isLoading || chatStore.isStreaming());
	let isStoryFlowLocked = $derived(
		activeStory?.phase === 'outline_generating' ||
			activeStory?.phase === 'awaiting_approval' ||
			activeStory?.phase === 'generating' ||
			activeStory?.phase === 'error'
	);
	let hideComposer = $derived(
		Boolean(conversationsStore.activeConversation) &&
			conversationsStore.activeMessages.length > 0 &&
			!isCurrentConversationLoading
	);
	let draftKey = $derived(`story:${conversationsStore.activeConversation?.id ?? 'new'}`);
	let initialMessage = $derived(isStoryStart ? STORY_INITIAL_PROMPT : '');
	let storyByMessageId = $derived(
		getStoryMetadataByMessageId(
			conversationsStore.activeConversation,
			conversationsStore.activeMessages
		)
	);
	let chapterOutlineItems = $derived(
		activeStory ? getStoryChapterOutlineItems(activeStory, conversationsStore.activeMessages) : []
	);
	let showChapterOutline = $derived(
		Boolean(activeStory?.approvedAt && chapterOutlineItems.length > 0)
	);

	function navigateToChapter(messageId: string): void {
		const target = document.querySelector<HTMLElement>(
			`.chat-message[data-message-id="${CSS.escape(messageId)}"]`
		);

		target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	async function handleSendMessage(
		message: string,
		extras?: DatabaseMessageExtra[]
	): Promise<void> {
		if (isStoryStart) {
			await storyStore.startOutline(message, extras);

			return;
		}

		await storyStore.sendMessage(message, extras);
	}
</script>

<div class={showChapterOutline ? 'pt-12 2xl:pt-0 2xl:pr-72' : ''}>
	<ChatScreen
		composerDisabled={isStoryFlowLocked}
		{draftKey}
		greetingDescription="Attach a snippet, tune the prompt, then generate an outline"
		greetingTitle="Start a story"
		{hideComposer}
		{initialMessage}
		onSend={handleSendMessage}
		onStop={() => storyStore.stopGeneration()}
		placeholder="Edit the story prompt, then attach context..."
		requireAttachmentToSubmit={isStoryStart}
		resetKey={draftKey}
		{showCenteredEmpty}
	>
		{#snippet messageAddons(message)}
			<StoryMessageAddons story={storyByMessageId.get(message.id)} />
		{/snippet}
	</ChatScreen>
</div>

{#if showChapterOutline && activeStory}
	<StoryChapterOutline
		items={chapterOutlineItems}
		onNavigate={navigateToChapter}
		title={activeStory.title ?? 'Story chapters'}
	/>
{/if}
