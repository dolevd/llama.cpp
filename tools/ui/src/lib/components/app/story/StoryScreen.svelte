<script lang="ts">
	import StoryChapterOutline from './StoryChapterOutline.svelte';
	import StoryMessageAddons from './StoryMessageAddons.svelte';
	import ChatScreen from '$lib/components/app/chat/ChatScreen/ChatScreen.svelte';
	import { STORY_INITIAL_PROMPT } from '$lib/constants';
	import { isChatStreaming, isLoading } from '$lib/stores/chat.svelte';
	import { activeConversation, activeMessages } from '$lib/stores/conversations.svelte';
	import { storyStore } from '$lib/stores/story.svelte';
	import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
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
		getActiveStoryMetadata(activeConversation(), activeMessages() as DatabaseMessage[])
	);
	let isStoryStart = $derived(!activeConversation() && activeMessages().length === 0);
	let isCurrentConversationLoading = $derived(isLoading() || isChatStreaming());
	let isStoryFlowLocked = $derived(
		activeStory?.phase === 'outline_generating' ||
			activeStory?.phase === 'awaiting_approval' ||
			activeStory?.phase === 'generating' ||
			activeStory?.phase === 'error'
	);
	let hideComposer = $derived(
		Boolean(activeConversation()) && activeMessages().length > 0 && !isCurrentConversationLoading
	);
	let draftKey = $derived(`story:${activeConversation()?.id ?? 'new'}`);
	let initialMessage = $derived(isStoryStart ? STORY_INITIAL_PROMPT : '');
	let storyByMessageId = $derived(
		getStoryMetadataByMessageId(activeConversation(), activeMessages() as DatabaseMessage[])
	);
	let chapterOutlineItems = $derived(
		activeStory
			? getStoryChapterOutlineItems(activeStory, activeMessages() as DatabaseMessage[])
			: []
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
		greetingTitle="Start a story"
		greetingDescription="Attach a snippet, tune the prompt, then generate an outline"
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
		title={activeStory.title ?? 'Story chapters'}
		onNavigate={navigateToChapter}
	/>
{/if}
