<script lang="ts">
	import { page } from '$app/state';
	import {
		ChatScreenForm,
		ChatMessages,
		ChatScreenDragOverlay,
		ChatScreenStreamResumeStatus,
		ServerLoadingSplash,
		ChatScreenServerError
	} from '$lib/components/app';
	import { createAutoScrollController } from '$lib/hooks/use-auto-scroll.svelte';
	import { useChatScreenActiveModel } from '$lib/hooks/use-chat-screen-active-model.svelte';
	import { useChatScreenDragAndDrop } from '$lib/hooks/use-chat-screen-drag-and-drop.svelte';
	import { useChatScreenFileUpload } from '$lib/hooks/use-chat-screen-file-upload.svelte';
	import { useChatScreenScroll } from '$lib/hooks/use-chat-screen-scroll.svelte';
	import { useChatScrollPosition } from '$lib/hooks/use-chat-scroll-position.svelte';
	import { useKeyboardShortcuts } from '$lib/hooks/use-keyboard-shortcuts.svelte';
	import { device } from '$lib/stores/device.svelte';
	import { isMobile } from '$lib/stores/viewport.svelte';
	import {
		chatStore,
		errorDialog,
		isLoading,
		isChatStreaming,
		isEditing
	} from '$lib/stores/chat.svelte';
	import {
		conversationsStore,
		activeMessages,
		activeConversation
	} from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { serverLoading, serverError } from '$lib/stores/server.svelte';
	import { parseFilesToMessageExtras } from '$lib/utils/browser-only';
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
	import ChatScreenGreeting from './ChatScreenGreeting.svelte';
	import ChatScreenActionScrollDown from './ChatScreenActionScrollDown.svelte';
	import ChatScreenDialogsAndAlerts from './ChatScreenDialogsAndAlerts.svelte';

	let {
		composerDisabled = false,
		draftKey,
		greetingDescription,
		greetingTitle,
		hideComposer = false,
		initialMessage = '',
		messageAddons,
		onSend,
		onStop,
		placeholder,
		requireAttachmentToSubmit = false,
		resetKey = 'chat',
		showCenteredEmpty = false
	} = $props<{
		composerDisabled?: boolean;
		draftKey?: string;
		greetingDescription?: string;
		greetingTitle?: string;
		hideComposer?: boolean;
		initialMessage?: string;
		messageAddons?: Snippet<[DatabaseMessage]>;
		onSend?: (message: string, extras?: DatabaseMessageExtra[]) => Promise<void> | void;
		onStop?: () => Promise<void> | void;
		placeholder?: string;
		requireAttachmentToSubmit?: boolean;
		resetKey?: string;
		showCenteredEmpty?: boolean;
	}>();

	let disableAutoScroll = $derived(Boolean(config().disableAutoScroll) || isMobile.current);
	let isMobileUserScrolledUp = $state(false);
	let mobileScrollDownHint = $state(false);
	let mobileScrollDownHintLockedUntil = $state(0);
	let emptyFileNames = $state<string[]>([]);
	let formInitialMessage = $state('');
	let previousInitialMessage = $state('');
	let previousResetKey = $state('');
	let showDeleteDialog = $state(false);
	let showEmptyFileDialog = $state(false);
	let isEmpty = $derived(
		showCenteredEmpty && !activeConversation() && activeMessages().length === 0 && !isLoading()
	);
	let isCurrentConversationLoading = $derived(isLoading() || isChatStreaming());
	let activeErrorDialog = $derived(errorDialog());
	let isServerLoading = $derived(serverLoading());
	let hasPropsError = $derived(!!serverError());
	let chatFormBottomPosition = $derived.by(() => {
		if (!isMobile.current) return '1rem';
		if (device.isStandalone) return '1.5rem';
		if (device.isIOSSafari) return '0.25rem';
		return '0.5rem';
	});

	const autoScroll = createAutoScrollController();
	const scroll = useChatScreenScroll(autoScroll);
	const scrollPosition = useChatScrollPosition({
		autoScroll,
		getConversationId: () => activeConversation()?.id ?? null,
		getContainer: () => scroll.chatScrollContainer,
		getDisableAutoScroll: () => disableAutoScroll
	});
	const activeModel = useChatScreenActiveModel();
	const fileUpload = useChatScreenFileUpload({
		capabilities: () => ({
			hasVision: activeModel.hasVisionModality,
			hasAudio: activeModel.hasAudioModality,
			hasVideo: activeModel.hasVideoModality
		}),
		activeModelId: () => activeModel.activeModelId
	});
	const dragAndDrop = useChatScreenDragAndDrop({
		onDrop: fileUpload.handleFileUpload
	});
	const { handleKeydown } = useKeyboardShortcuts({
		deleteActiveConversation: () => {
			if (activeConversation()) {
				showDeleteDialog = true;
			}
		}
	});

	function handleMobileScroll() {
		if (!isMobile.current) return;

		const container = scroll.chatScrollContainer;
		if (!container) return;

		const distanceFromBottom =
			container.scrollHeight - container.clientHeight - container.scrollTop;
		isMobileUserScrolledUp = distanceFromBottom > 300;
	}

	async function handleDeleteConfirm() {
		const conversation = activeConversation();

		if (conversation) {
			await conversationsStore.deleteConversation(conversation.id);
		}

		showDeleteDialog = false;
	}

	async function handleSendMessage(message: string, files?: ChatUploadedFile[]): Promise<boolean> {
		const plainFiles = files ? $state.snapshot(files) : undefined;
		const result = plainFiles
			? await parseFilesToMessageExtras(plainFiles, activeModel.activeModelId ?? undefined)
			: undefined;

		if (result?.emptyFiles && result.emptyFiles.length > 0) {
			emptyFileNames = result.emptyFiles;
			showEmptyFileDialog = true;
			if (files) {
				const emptyFileNamesSet = new Set(result.emptyFiles);
				fileUpload.uploadedFiles = fileUpload.uploadedFiles.filter(
					(file) => !emptyFileNamesSet.has(file.name)
				);
			}
			return false;
		}

		handleSendLikeScroll();

		if (onSend) {
			await onSend(message, result?.extras);
		} else {
			await chatStore.sendMessage(message, result?.extras);
		}

		return true;
	}

	function handleSendLikeScroll() {
		if (!isMobile.current) {
			autoScroll.enable();
		}

		setTimeout(() => {
			const container = scroll.chatScrollContainer;
			if (!container) return;

			const lastUserBubble = container.querySelector(
				'.chat-message:nth-last-child(2) .chat-message-user .chat-message-user-bubble'
			) as HTMLElement | null;

			if (isMobile.current) {
				// Keep the last user message bubble just above the input on mobile
				const bubbleHeight = lastUserBubble?.scrollHeight ?? 0;
				const baseHeight = container.scrollHeight - innerHeight;

				container.scrollTo({
					top: bubbleHeight > 0 ? baseHeight - bubbleHeight : baseHeight,
					behavior: 'smooth'
				});
			} else if (lastUserBubble) {
				// On desktop, place the last user message near the top of the viewport
				const topPadding = 24;
				const bubbleRect = lastUserBubble.getBoundingClientRect();
				container.scrollTo({
					top: Math.max(0, container.scrollTop + bubbleRect.top - topPadding),
					behavior: 'smooth'
				});
			} else {
				autoScroll.scrollToBottom();
			}
		}, 100);

		if (isMobile.current) {
			autoScroll.setDisabled(disableAutoScroll);
			mobileScrollDownHint = true;
			mobileScrollDownHintLockedUntil = Date.now() + 500;
		}
	}

	function handleErrorDialogOpenChange(open: boolean) {
		if (!open) {
			chatStore.dismissErrorDialog();
		}
	}

	async function handleSystemPromptAdd(draft: { message: string; files: ChatUploadedFile[] }) {
		if (draft.message || draft.files.length > 0) {
			chatStore.savePendingDraft(draft.message, draft.files);
		}
		await chatStore.addSystemPrompt();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		handleKeydown(event);
		scrollPosition.handleKeyboardScrollIntent(event);
	}

	$effect(() => {
		const shouldDisableAutoScroll =
			config().disableAutoScroll || (isMobile.current && isCurrentConversationLoading);
		autoScroll.setDisabled(shouldDisableAutoScroll);
		if (!shouldDisableAutoScroll) {
			autoScroll.enable();
		}
	});

	$effect(() => {
		if (resetKey !== previousResetKey) {
			previousResetKey = resetKey;
			formInitialMessage = initialMessage;
			fileUpload.uploadedFiles = [];
		}
	});

	$effect(() => {
		if (initialMessage !== previousInitialMessage) {
			previousInitialMessage = initialMessage;
			formInitialMessage = initialMessage;
		}
	});

	onMount(() => {
		const pendingDraft = chatStore.consumePendingDraft();
		if (pendingDraft) {
			formInitialMessage = pendingDraft.message;
			fileUpload.uploadedFiles = pendingDraft.files;
		} else {
			formInitialMessage = initialMessage;
		}

		autoScroll.startObserving();

		if (!disableAutoScroll) {
			autoScroll.enable();
		}

		if (isMobile.current && isCurrentConversationLoading) {
			mobileScrollDownHint = true;
			mobileScrollDownHintLockedUntil = Date.now() + 500;
		}

		handleMobileScroll();
	});

	onDestroy(() => autoScroll.destroy());
</script>

{#if dragAndDrop.isDragOver}
	<ChatScreenDragOverlay />
{/if}

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={scrollPosition.handlePointerIntent}
	ontouchstart={scrollPosition.handlePointerIntent}
	onwheel={scrollPosition.markUserScrollIntent}
	onscroll={(e) => {
		scroll.handleScroll(e);
		scrollPosition.handleScroll();
		handleMobileScroll();
		if (e.isTrusted && Date.now() > mobileScrollDownHintLockedUntil) {
			mobileScrollDownHint = false;
		}
	}}
/>

{#if isServerLoading}
	<ServerLoadingSplash />
{:else}
	<div
		class="chat-screen flex grow flex-col min-h-[calc(100dvh-1rem)] md:min-h-full px-4 md:py-0 pt-12 pb-48 md:pb-4"
		style:--chat-form-bottom-position={chatFormBottomPosition}
		ondragenter={dragAndDrop.dragHandlers.dragenter}
		ondragleave={dragAndDrop.dragHandlers.dragleave}
		ondragover={dragAndDrop.dragHandlers.dragover}
		ondrop={dragAndDrop.dragHandlers.drop}
		role="main"
	>
		{#if !isEmpty}
			<ChatMessages
				messages={activeMessages()}
				onMessagesReady={scrollPosition.handleMessagesReady}
				onUserAction={() => {
					handleSendLikeScroll();
				}}
			>
				{#snippet afterMessage(message)}
					{#if messageAddons}
						{@render messageAddons(message)}
					{/if}
				{/snippet}
			</ChatMessages>
		{/if}

		<div
			class={[
				'pointer-events-none md:sticky fixed  mt-auto transition-all duration-200',
				device.isStandalone
					? 'bottom-6 right-4 left-4'
					: device.isIOSSafari
						? 'bottom-1 left-2 right-2'
						: 'bottom-2 right-2 left-2',
				isEmpty ? 'md:bottom-[calc(50dvh-7rem)] 2xl:bottom-[calc(50dvh-4rem)]' : 'md:bottom-4'
			]}
			style:padding-top={!isEmpty ? 'var(--chat-form-padding-top)' : undefined}
		>
			<ChatScreenGreeting {isEmpty} title={greetingTitle} description={greetingDescription} />

			<ChatScreenServerError />

			{#if page.params.id}
				<ChatScreenStreamResumeStatus />
			{/if}

			<div class="pointer-events-none flex flex-col gap-6 items-center w-full">
				{#if (isMobile.current ? mobileScrollDownHint || isMobileUserScrolledUp : autoScroll.userScrolledUp) && page.params.id}
					<ChatScreenActionScrollDown
						onclick={() => {
							mobileScrollDownHint = false;
							scroll.chatScrollContainer?.scrollTo({
								top: scroll.chatScrollContainer.scrollHeight,
								behavior: 'smooth'
							});
						}}
					/>
				{/if}
			</div>

			{#if !hideComposer}
				<ChatScreenForm
					class="pointer-events-auto conversation-chat-form"
					disabled={hasPropsError || isEditing() || composerDisabled}
					{draftKey}
					initialMessage={formInitialMessage}
					isLoading={isCurrentConversationLoading}
					onFileRemove={fileUpload.handleFileRemove}
					onFileUpload={fileUpload.handleFileUpload}
					onSend={handleSendMessage}
					onStop={() => (onStop ? onStop() : chatStore.stopGeneration())}
					onSystemPromptAdd={handleSystemPromptAdd}
					{placeholder}
					{requireAttachmentToSubmit}
					bind:uploadedFiles={fileUpload.uploadedFiles}
				/>
			{/if}
		</div>
	</div>
{/if}

<ChatScreenDialogsAndAlerts
	{showDeleteDialog}
	{handleDeleteConfirm}
	{showEmptyFileDialog}
	{emptyFileNames}
	{activeErrorDialog}
	{handleErrorDialogOpenChange}
	{fileUpload}
/>
