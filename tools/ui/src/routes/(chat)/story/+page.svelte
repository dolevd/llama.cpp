<script lang="ts">
	import { APP_NAME } from '$lib/constants';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { conversationsStore, isConversationsInitialized } from '$lib/stores/conversations.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { onMount } from 'svelte';

	onMount(async () => {
		if (!isConversationsInitialized()) {
			await conversationsStore.initialize();
		}

		conversationsStore.clearActiveConversation();
		chatStore.clearUIState();

		await modelsStore.fetch();
		await modelsStore.ensureFirstModelSelected();
	});
</script>

<svelte:head>
	<title>Story mode - {APP_NAME}</title>
</svelte:head>
