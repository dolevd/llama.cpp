<script lang="ts">
	import { APP_NAME } from '$lib/constants';
	import { conversationsStore, modelsStore } from '$lib/stores';
	import { onMount } from 'svelte';

	onMount(async () => {
		if (!conversationsStore.isInitialized) {
			await conversationsStore.initialize();
		}

		conversationsStore.clearActiveConversation();

		await modelsStore.fetch();
		await modelsStore.ensureFirstModelSelected();
	});
</script>

<svelte:head>
	<title>Story mode - {APP_NAME}</title>
</svelte:head>
