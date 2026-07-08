<script lang="ts">
	import type { StoryMetadata } from '$lib/types';
	import StoryOutlineMessage from './StoryOutlineMessage.svelte';

	interface Props {
		story?: StoryMetadata;
	}

	let { story }: Props = $props();
</script>

{#if story}
	<StoryOutlineMessage {story} />
{/if}
