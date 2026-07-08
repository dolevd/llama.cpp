<script lang="ts">
	import { page } from '$app/state';
	import { ChatScreen, StoryScreen } from '$lib/components/app';
	import { RouterService } from '$lib/services/router.service';

	let { children } = $props();

	let showCenteredEmpty = $derived(!page.params.id);
	let isStoryRoute = $derived(RouterService.isStoryRoute(page.route.id));
</script>

{#if isStoryRoute}
	<StoryScreen {showCenteredEmpty} />
{:else}
	<ChatScreen {showCenteredEmpty} />
{/if}

{@render children?.()}
