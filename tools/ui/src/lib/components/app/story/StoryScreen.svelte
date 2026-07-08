<script lang="ts">
	import ChatScreen from '$lib/components/app/chat/ChatScreen/ChatScreen.svelte';
	import { STORY_INITIAL_PROMPT } from '$lib/constants';
	import { isLoading, isChatStreaming } from '$lib/stores/chat.svelte';
	import { activeConversation, activeMessages } from '$lib/stores/conversations.svelte';
	import { storyStore } from '$lib/stores/story.svelte';
	import { getStoryMetadataByMessageId } from '$lib/utils';
	import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
	import StoryMessageAddons from './StoryMessageAddons.svelte';

	interface Props {
		showCenteredEmpty?: boolean;
	}

	let { showCenteredEmpty = false }: Props = $props();

	storyStore.ensureRequestProfileCompletionHandler();

	let activeStory = $derived(activeConversation()?.story);
	let isStoryStart = $derived(
		!activeConversation() && activeMessages().length === 0
	);
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
		getStoryMetadataByMessageId(
			activeConversation(),
			activeMessages() as DatabaseMessage[]
		)
	);

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
