<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME, ROUTES } from '$lib/constants';
	import { loadConversationForRoute } from '$lib/services/conversation-route.service';
	import { isLoading } from '$lib/stores/chat.svelte';
	import { activeConversation } from '$lib/stores/conversations.svelte';
	import { storyStore } from '$lib/stores/story.svelte';

	let storyId = $derived(page.params.id);
	let currentStoryId: string | undefined = undefined;

	$effect(() => {
		if (storyId && storyId !== currentStoryId) {
			currentStoryId = storyId;

			(async () => {
				await loadConversationForRoute(storyId, 'story', ROUTES.NEW_STORY);
			})();
		}
	});

	$effect(() => {
		if (typeof window !== 'undefined') {
			const handleBeforeUnload = () => {
				if (isLoading()) {
					void storyStore.stopGeneration();
				}
			};

			window.addEventListener('beforeunload', handleBeforeUnload);

			return () => {
				window.removeEventListener('beforeunload', handleBeforeUnload);
			};
		}
	});
</script>

<svelte:head>
	<title>{activeConversation()?.name || 'Story mode'} - {APP_NAME}</title>
</svelte:head>
