import { onMount } from 'svelte';
import { afterNavigate, beforeNavigate } from '$app/navigation';
import { draftMessagesStore } from '$lib/stores/draft-messages.svelte';

interface UseDraftMessagesOptions {
	getChatId: () => string | undefined;
	getMessage: () => string;
	getFiles: () => ChatUploadedFile[];
	setMessage: (message: string) => void;
	setFiles: (files: ChatUploadedFile[]) => void;
	getInitialMessage: () => string;
}

export function useDraftMessages(options: UseDraftMessagesOptions) {
	onMount(() => {
		const chatId = options.getChatId();
		const draft = draftMessagesStore.getDraftMessage(chatId);

		if (draft.message || draft.files.length > 0) {
			options.setMessage(draft.message);
			options.setFiles(draft.files);
		}
	});

	beforeNavigate(() => {
		const chatId = options.getChatId();
		const initialMessage = options.getInitialMessage();
		const message = options.getMessage();
		const files = options.getFiles();

		if (initialMessage && message === initialMessage && files.length === 0) {
			draftMessagesStore.clearDraftMessage(chatId);
			return;
		}

		draftMessagesStore.saveDraftMessage(chatId, message, files);
	});

	afterNavigate((navigation) => {
		if (navigation?.from != null) {
			const chatId = options.getChatId();
			const draft = draftMessagesStore.getDraftMessage(chatId);

			if (draft.message || draft.files.length > 0) {
				options.setMessage(draft.message);
				options.setFiles(draft.files);
			} else {
				options.setMessage(options.getInitialMessage());
				options.setFiles([]);
			}
		}
	});

	function clearDraft() {
		const chatId = options.getChatId();
		draftMessagesStore.clearDraftMessage(chatId);
	}

	return { clearDraft };
}
