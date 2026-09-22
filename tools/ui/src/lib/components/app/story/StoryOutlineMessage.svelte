<script lang="ts">
	import ChatFormReasoningToggle from '$lib/components/app/chat/ChatForm/ChatFormActions/ChatFormReasoningToggle.svelte';
	import { chatStore } from '$lib/stores';
	import { storyStore } from '$lib/stores/story.svelte';
	import type { StoryMetadata } from '$lib/types';
	import StoryOutlineCard from './StoryOutlineCard.svelte';

	interface Props {
		story: StoryMetadata;
	}

	let { story }: Props = $props();
</script>

<StoryOutlineCard
	{story}
	isLoading={chatStore.isLoading}
	onApprove={(outlineText, story) => storyStore.approveOutline(outlineText, story)}
	onRegenerate={(story) => storyStore.regenerateOutline(story)}
>
	{#snippet leftActions()}
		<ChatFormReasoningToggle
			align="start"
			label="Chapter reasoning"
			showLabel
			class="border border-border"
		/>
	{/snippet}
</StoryOutlineCard>
