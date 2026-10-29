<script lang="ts">
	import ChatScreenActionScrollDown from './ChatScreenActionScrollDown.svelte';
	import ChatScreenDialogsAndAlerts from './ChatScreenDialogsAndAlerts.svelte';
	import ChatScreenGreeting from './ChatScreenGreeting.svelte';
	import { disableScrollHandling, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		ChatMessages,
		ChatScreenDragOverlay,
		ChatScreenForm,
		ChatScreenServerError,
		ChatScreenStreamResumeStatus,
		ServerLoadingSplash
	} from '$lib/components/app';
	import {
		CHAT_FORM_MOVE_IN_EASING,
		CHAT_FORM_MOVE_IN_MS,
		CHAT_FORM_MOVE_OUT_EASING,
		CHAT_FORM_MOVE_OUT_MS,
		CHAT_FORM_MOVE_SHIFT_PX,
		CHAT_FORM_MOVE_TO_BOTTOM_IN_MS,
		CHAT_FORM_MOVE_TO_BOTTOM_OUT_MS,
		ROUTES
	} from '$lib/constants';
	import { useChatScreenActiveModel } from '$lib/hooks/use-chat-screen-active-model.svelte';
	import { useChatScreenDragAndDrop } from '$lib/hooks/use-chat-screen-drag-and-drop.svelte';
	import { useChatScreenFileUpload } from '$lib/hooks/use-chat-screen-file-upload.svelte';
	import { useChatScrollPosition } from '$lib/hooks/use-chat-scroll-position.svelte';
	import { useKeyboardShortcuts } from '$lib/hooks/use-keyboard-shortcuts.svelte';
	import { createStickToBottom } from '$lib/hooks/use-stick-to-bottom.svelte';
	import {
		chatStore,
		conversationsStore,
		deviceStore,
		serverStore,
		settingsStore
	} from '$lib/stores';
	import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
	import { parseFilesToMessageExtras } from '$lib/utils/browser-only';
	import { type Snippet, tick, untrack } from 'svelte';

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
		showCenteredEmpty?: boolean;
	}>();

	let emptyFileNames = $state<string[]>([]);
	let showDeleteDialog = $state(false);
	let showEmptyFileDialog = $state(false);
	let isEmpty = $derived(
		showCenteredEmpty && conversationsStore.activeMessages.length === 0 && !chatStore.isLoading
	);
	// where the form is drawn: follows `isEmpty` once the form has faded out
	let isFormCentered = $state(untrack(() => isEmpty));
	let isFormMoving = false;
	let formWrapper: HTMLElement | undefined = $state();
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

	// The page is the scroller: it follows new content while the reader sits at
	// the bottom, and otherwise leaves their position alone.
	const stick = createStickToBottom();
	const scrollPosition = useChatScrollPosition({
		getContainer: () => document.documentElement,
		getConversationId: () => conversationsStore.activeConversation?.id ?? null,
		getDisableAutoScroll: () => settingsStore.config.disableAutoScroll,
		stick
	});
	let stickPin: HTMLDivElement | undefined = $state();
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

		// Sending re-arms following: the reply streams in under the message.
		stick.scrollToBottom();

		if (onSend) {
			await onSend(message, result?.extras);
		} else {
			await chatStore.sendMessage(message, result?.extras);
		}

		return true;
	}

	// Saved positions own chat scrolling; skip SvelteKit's scroll reset.
	onNavigate((navigation) => {
		if (navigation.to?.params?.id) disableScrollHandling();
	});

	async function handleMessagesReady(messageCount: number) {
		if (messageCount === 0) return;

		await tick();
		scrollPosition.handleMessagesReady();
	}

	/**
	 * Moves the form between its centered and bottom positions: it fades out
	 * where it is, drifting toward where it goes, and fades
	 * back in from the other side once it is there. Reduced motion keeps only
	 * the fade. Re-reads `isEmpty` after each move, so a flip back mid-move
	 * ends where the screen is.
	 */
	async function moveForm() {
		if (isFormMoving) return;

		isFormMoving = true;

		while (formWrapper && isFormCentered !== isEmpty) {
			const toCenter = isEmpty;
			const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
			const shift = reduceMotion ? 0 : (toCenter ? -1 : 1) * CHAT_FORM_MOVE_SHIFT_PX;
			const shown = { opacity: 1, transform: 'translateY(0)' };
			// `transform` composes with the `translate` that centers the form
			const leave = formWrapper.animate(
				[shown, { opacity: 0, transform: `translateY(${shift}px)` }],
				{
					duration: toCenter ? CHAT_FORM_MOVE_OUT_MS : CHAT_FORM_MOVE_TO_BOTTOM_OUT_MS,
					easing: CHAT_FORM_MOVE_OUT_EASING,
					fill: 'forwards'
				}
			);

			await leave.finished.catch(() => {});

			isFormCentered = toCenter;
			await tick();

			// cancelled in the same frame the entry starts, so it never flashes
			leave.cancel();
			formWrapper?.animate([{ opacity: 0, transform: `translateY(${-shift}px)` }, shown], {
				duration: toCenter ? CHAT_FORM_MOVE_IN_MS : CHAT_FORM_MOVE_TO_BOTTOM_IN_MS,
				easing: CHAT_FORM_MOVE_IN_EASING
			});
		}

		isFormCentered = isEmpty;
		isFormMoving = false;
	}

	$effect(() => {
		if (isEmpty !== isFormCentered) untrack(() => void moveForm());
	});

	function handleErrorDialogOpenChange(open: boolean) {
		if (!open) {
			chatStore.dismissErrorDialog();
		}
	}

	async function handleSystemPromptAdd(draft: { message: string; files: ChatUploadedFile[] }) {
		await chatStore.addSystemPrompt(draft);
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		handleKeydown(event);
		scrollPosition.handleKeyboardScrollIntent(event);
	}

	$effect(() => {
		stick.setEnabled(!settingsStore.config.disableAutoScroll);
	});

	$effect(() => {
		stick.attach(document.documentElement, document.body, stickPin);

		return () => stick.detach();
	});
</script>

{#if dragAndDrop.isDragOver}
	<ChatScreenDragOverlay />
{/if}

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={scrollPosition.handlePointerIntent}
	onscroll={scrollPosition.handleScroll}
	ontouchstart={scrollPosition.handlePointerIntent}
	onwheel={scrollPosition.markUserScrollIntent}
/>

{#if isServerLoading}
	<ServerLoadingSplash />
{:else}
	<div
		style:--chat-form-bottom-position={chatFormBottomPosition}
		class="chat-screen flex grow flex-col min-h-[calc(100dvh-1rem)] md:min-h-[calc(100dvh-var(--chat-tabs-offset,0px))] px-4 md:py-0 pt-12 pb-48 md:pb-4"
		ondragenter={dragAndDrop.dragHandlers.dragenter}
		ondragleave={dragAndDrop.dragHandlers.dragleave}
		ondragover={dragAndDrop.dragHandlers.dragover}
		ondrop={dragAndDrop.dragHandlers.drop}
		role="main"
	>
		{#if !isEmpty}
			<ChatMessages
				messages={conversationsStore.activeMessages}
				onMessagesReady={handleMessagesReady}
			>
				{#snippet afterMessage(message)}
					{#if messageAddons}
						{@render messageAddons(message)}
					{/if}
				{/snippet}
			</ChatMessages>
		{/if}

		<!-- the scroll anchor that keeps the page at its bottom, see createStickToBottom -->
		<div bind:this={stickPin} aria-hidden="true" class="stick-to-bottom-pin"></div>

		<div
			bind:this={formWrapper}
			style:padding-top="var(--chat-form-padding-top)"
			class={[
				// moves between the centered (empty chat) and bottomed positions with
				// a fade, see moveForm. Its height in the page is the same in both
				// (the padding stays, the desktop greeting floats above the form),
				// so the messages never shift while it moves
				'pointer-events-none md:sticky fixed mt-auto',
				deviceStore.isStandalone
					? 'bottom-6 right-4 left-4'
					: deviceStore.isIOSSafari
						? 'bottom-1 left-2 right-2'
						: 'bottom-2 right-2 left-2',
				'md:bottom-4',
				isFormCentered
					? 'md:translate-y-[calc(-50dvh+7rem)] 2xl:translate-y-[calc(-50dvh+4rem)]'
					: ''
			]}
		>
			<ChatScreenGreeting
				description={greetingDescription}
				isEmpty={isFormCentered}
				title={greetingTitle}
			/>

			<ChatScreenServerError />

			{#if page.params.id}
				<ChatScreenStreamResumeStatus />
			{/if}

			<div class="pointer-events-none flex flex-col gap-6 items-center w-full">
				{#if !stick.atBottom && page.url.hash.includes(ROUTES.CHAT) && page.params.id}
					<ChatScreenActionScrollDown onclick={() => stick.scrollToBottom('smooth')} />
				{/if}
			</div>

			{#if !hideComposer}
				<ChatScreenForm
					bind:uploadedFiles={fileUpload.uploadedFiles}
					class="pointer-events-auto conversation-chat-form"
					disabled={hasPropsError || chatStore.isEditing() || composerDisabled}
					{draftKey}
					{initialMessage}
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
