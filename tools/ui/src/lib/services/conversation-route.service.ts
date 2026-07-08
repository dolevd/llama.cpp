import { goto } from '$app/navigation';
import { RouterService } from '$lib/services/router.service';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import type { ConversationMode, DatabaseConversation } from '$lib/types';

export type ConversationRouteLoadResult = 'ready' | 'redirected' | 'missing';

function conversationMode(conversation: DatabaseConversation): ConversationMode {
	return conversation.mode ?? 'chat';
}

async function syncConversationStream(conversationId: string): Promise<void> {
	chatStore.syncLoadingStateForChat(conversationId);
	await chatStore.discoverActiveStream(conversationId);
}

export async function loadConversationForRoute(
	conversationId: string,
	expectedMode: ConversationMode,
	missingRoute: string
): Promise<ConversationRouteLoadResult> {
	const activeConversation = conversationsStore.activeConversation;

	if (activeConversation?.id === conversationId) {
		if (conversationMode(activeConversation) !== expectedMode) {
			await goto(RouterService.conversation(activeConversation));
			return 'redirected';
		}

		await syncConversationStream(conversationId);
		return 'ready';
	}

	const success = await conversationsStore.loadConversation(conversationId);

	if (!success) {
		await goto(missingRoute);
		return 'missing';
	}

	const conversation = conversationsStore.activeConversation;

	if (!conversation || conversationMode(conversation) !== expectedMode) {
		await goto(conversation ? RouterService.conversation(conversation) : missingRoute);
		return 'redirected';
	}

	await syncConversationStream(conversationId);
	return 'ready';
}
