<script lang="ts">
	import ChatScreenActionScrollDown from './ChatScreenActionScrollDown.svelte';
	import ChatScreenDialogsAndAlerts from './ChatScreenDialogsAndAlerts.svelte';
	import ChatScreenGreeting from './ChatScreenGreeting.svelte';
	import { page } from '$app/state';
	import {
		ChatMessages,
		ChatScreenDragOverlay,
		ChatScreenForm,
		ChatScreenServerError,
		ChatScreenStreamResumeStatus,
		ServerLoadingSplash
	} from '$lib/components/app';
	import { createAutoScrollController } from '$lib/hooks/use-auto-scroll.svelte';
	import { useChatScreenActiveModel } from '$lib/hooks/use-chat-screen-active-model.svelte';
	import { useChatScreenDragAndDrop } from '$lib/hooks/use-chat-screen-drag-and-drop.svelte';
	import { useChatScreenFileUpload } from '$lib/hooks/use-chat-screen-file-upload.svelte';
	import { useChatScreenScroll } from '$lib/hooks/use-chat-screen-scroll.svelte';
	import { useChatScrollPosition } from '$lib/hooks/use-chat-scroll-position.svelte';
	import { useKeyboardShortcuts } from '$lib/hooks/use-keyboard-shortcuts.svelte';
	import {
		chatStore,
		conversationsStore,
		deviceStore,
		serverStore,
		settingsStore
	} from '$lib/stores';
	import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
	import { parseFilesToMessageExtras } from '$lib/utils/browser-only';
	import { onDestroy, onMount, type Snippet } from 'svelte';

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

	let disableAutoScroll = $derived(
		Boolean(settingsStore.config.disableAutoScroll) || deviceStore.isMobile
	);
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
		showCenteredEmpty && conversationsStore.activeMessages.length === 0 && !chatStore.isLoading
	);
	let activeErrorDialog = $derived(chatStore.errorDialogState);
	let isServerLoading = $derived(serverStore.loading);
	let hasPropsError = $derived(!!serverStore.error);
	let isCurrentConversationLoading = $derived(chatStore.isLoading || chatStore.isStreaming());
	let chatFormBottomPosition = $derived.by(() => {
		if (!deviceStore.isMobile) return '1rem';

		if (deviceStore.isStandalone) return '1.5rem';

		if (deviceStore.isIOSSafari) return '0.25rem';

		return '0.5rem';
	});

	const autoScroll = createAutoScrollController();
	const scroll = useChatScreenScroll(autoScroll);
	const scrollPosition = useChatScrollPosition({
		autoScroll,
		getConversationId: () => conversationsStore.activeConversation?.id ?? null,
		getContainer: () => scroll.chatScrollContainer,
		getDisableAutoScroll: () => disableAutoScroll
	});
	const activeModel = useChatScreenActiveModel();
	const fileUpload = useChatScreenFileUpload({
		activeModelId: () => activeModel.activeModelId,
		capabilities: () => ({
			hasAudio: activeModel.hasAudioModality,
			hasVideo: activeModel.hasVideoModality,
			hasVision: activeModel.hasVisionModality
		})
	});
	const dragAndDrop = useChatScreenDragAndDrop({
		onDrop: fileUpload.handleFileUpload
	});
	const { handleKeydown } = useKeyboardShortcuts({
		deleteActiveConversation: () => {
			if (conversationsStore.activeConversation) {
				showDeleteDialog = true;
			}
		}
	});

	function handleMobileScroll() {
		if (!deviceStore.isMobile) return;

		const container = scroll.chatScrollContainer;

		if (!container) return;

		const distanceFromBottom =
			container.scrollHeight - container.clientHeight - container.scrollTop;

		isMobileUserScrolledUp = distanceFromBottom > 300;
	}

	async function handleDeleteConfirm() {
		const conversation = conversationsStore.activeConversation;

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
		if (!deviceStore.isMobile) {
			autoScroll.enable();
		}

		setTimeout(() => {
			const container = scroll.chatScrollContainer;

			if (!container) return;

			const lastUserBubble = container.querySelector(
				'.chat-message:nth-last-child(2) .chat-message-user .chat-message-user-bubble'
			) as HTMLElement | null;

			if (deviceStore.isMobile) {
				// Keep the last user message bubble just above the input on mobile
				const bubbleHeight = lastUserBubble?.scrollHeight ?? 0;
				const baseHeight = container.scrollHeight - innerHeight;

				container.scrollTo({
					behavior: 'smooth',
					top: bubbleHeight > 0 ? baseHeight - bubbleHeight : baseHeight
				});
			} else if (lastUserBubble) {
				// On desktop, place the last user message near the top of the viewport
				const topPadding = 24;
				const bubbleRect = lastUserBubble.getBoundingClientRect();

				container.scrollTo({
					behavior: 'smooth',
					top: Math.max(0, container.scrollTop + bubbleRect.top - topPadding)
				});
			} else {
				autoScroll.scrollToBottom();
			}
		}, 100);

		if (deviceStore.isMobile) {
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
			settingsStore.config.disableAutoScroll ||
			(deviceStore.isMobile && isCurrentConversationLoading);

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

		if (deviceStore.isMobile && isCurrentConversationLoading) {
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
		style:--chat-form-bottom-position={chatFormBottomPosition}
		class="chat-screen flex grow flex-col min-h-[calc(100dvh-1rem)] md:min-h-[calc(100dvh-1rem-var(--chat-tabs-offset,0px))] px-4 md:py-0 pt-12 pb-48 md:pb-4"
		ondragenter={dragAndDrop.dragHandlers.dragenter}
		ondragleave={dragAndDrop.dragHandlers.dragleave}
		ondragover={dragAndDrop.dragHandlers.dragover}
		ondrop={dragAndDrop.dragHandlers.drop}
		role="main"
	>
		{#if !isEmpty}
			<ChatMessages
				messages={conversationsStore.activeMessages}
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
			style:padding-top={!isEmpty ? 'var(--chat-form-padding-top)' : undefined}
			class={[
				// animate the centered->bottomed move with transform, not bottom:
				// layout-property transitions need the main thread every frame and
				// stutter while a long conversation loads; transform transitions
				// run on the compositor and stay smooth
				'pointer-events-none md:sticky fixed  mt-auto transition-transform duration-200',
				deviceStore.isStandalone
					? 'bottom-6 right-4 left-4'
					: deviceStore.isIOSSafari
						? 'bottom-1 left-2 right-2'
						: 'bottom-2 right-2 left-2',
				'md:bottom-4',
				isEmpty ? 'md:translate-y-[calc(-50dvh+8rem)] 2xl:translate-y-[calc(-50dvh+5rem)]' : ''
			]}
		>
			<ChatScreenGreeting {isEmpty} title={greetingTitle} description={greetingDescription} />

			<ChatScreenServerError />

			{#if page.params.id}
				<ChatScreenStreamResumeStatus />
			{/if}

			<div class="pointer-events-none flex flex-col gap-6 items-center w-full">
				{#if (deviceStore.isMobile ? mobileScrollDownHint || isMobileUserScrolledUp : autoScroll.userScrolledUp) && page.params.id}
					<ChatScreenActionScrollDown
						onclick={() => {
							mobileScrollDownHint = false;
							scroll.chatScrollContainer?.scrollTo({
								behavior: 'smooth',
								top: scroll.chatScrollContainer.scrollHeight
							});
						}}
					/>
				{/if}
			</div>

			{#if !hideComposer}
				<ChatScreenForm
					bind:uploadedFiles={fileUpload.uploadedFiles}
					class="pointer-events-auto conversation-chat-form"
					disabled={hasPropsError || chatStore.isEditing() || composerDisabled}
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
				/>
			{/if}
		</div>
	</div>
{/if}

<ChatScreenDialogsAndAlerts
	{activeErrorDialog}
	{emptyFileNames}
	{fileUpload}
	{handleDeleteConfirm}
	{handleErrorDialogOpenChange}
	{showDeleteDialog}
	{showEmptyFileDialog}
/>
