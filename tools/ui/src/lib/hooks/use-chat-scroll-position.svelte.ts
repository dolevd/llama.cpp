import { beforeNavigate } from '$app/navigation';
import type { StickToBottom } from '$lib/hooks/use-stick-to-bottom.svelte';
import { onDestroy, untrack } from 'svelte';

interface ChatScrollPositionOptions {
	stick: StickToBottom;
	getConversationId: () => string | null;
	getContainer: () => HTMLElement | undefined;
	getDisableAutoScroll: () => boolean;
}

const SCROLL_SETTLE_DELAYS = [0, 50, 150, 350, 750];
const SCROLL_POSITION_BOTTOM_THRESHOLD = 64;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const scrollPositions = new Map<string, number>();
type ScrollTargetGetter = (container: HTMLElement) => number;

function saveScrollPosition(convId: string, scrollTop: number): void {
	scrollPositions.set(convId, scrollTop);
}

function getScrollPosition(convId: string): number | undefined {
	return scrollPositions.get(convId);
}

function pruneScrollPosition(convId: string): void {
	scrollPositions.delete(convId);
}

export function useChatScrollPosition({
	stick,
	getConversationId,
	getContainer,
	getDisableAutoScroll
}: ChatScrollPositionOptions) {
	let activeConversationId: string | null = $state(null);
	let initializingConversationId: string | null = null;
	let isRestoring = false;
	let userScrollIntent = false;
	let userScrollIntentTimeout: ReturnType<typeof setTimeout> | undefined;

	function isScrolledToBottom() {
		const container = getContainer();
		if (!container) return true;

		const { scrollTop, scrollHeight, clientHeight } = container;
		return scrollHeight - clientHeight - scrollTop < SCROLL_POSITION_BOTTOM_THRESHOLD;
	}

	function rememberScrollPosition(convId: string | null, overwrite = true) {
		const container = getContainer();
		if (!convId || !container) return;
		if (!overwrite && getScrollPosition(convId) !== undefined) return;

		if (isScrolledToBottom()) {
			pruneScrollPosition(convId);
			return;
		}

		saveScrollPosition(convId, container.scrollTop);
	}

	function markUserScrollIntent() {
		userScrollIntent = true;

		if (userScrollIntentTimeout) {
			clearTimeout(userScrollIntentTimeout);
		}

		requestAnimationFrame(() => {
			if (userScrollIntent) {
				stick.handleScroll();
			}
		});

		userScrollIntentTimeout = setTimeout(() => {
			userScrollIntent = false;
			userScrollIntentTimeout = undefined;
		}, 1000);
	}

	function clearUserScrollIntent() {
		userScrollIntent = false;

		if (userScrollIntentTimeout) {
			clearTimeout(userScrollIntentTimeout);
			userScrollIntentTimeout = undefined;
		}
	}

	function handleKeyboardScrollIntent(event: KeyboardEvent) {
		if (isEditableElement(event.target) || !SCROLL_KEYS.has(event.key)) return;

		markUserScrollIntent();
	}

	function handlePointerIntent(event: PointerEvent | TouchEvent) {
		if (isInsideContainer(event.target)) {
			markUserScrollIntent();
			return;
		}

		clearUserScrollIntent();
	}

	function isEditableElement(target: EventTarget | null) {
		const element = target instanceof HTMLElement ? target : null;
		return Boolean(element?.closest('input, textarea, [contenteditable="true"]'));
	}

	function isInsideContainer(target: EventTarget | null) {
		const container = getContainer();
		return Boolean(container && target instanceof Node && container.contains(target));
	}

	function handleScroll() {
		stick.handleScroll();

		if (userScrollIntent) {
			stick.handleScroll();
			markUserScrollIntent();
		}

		if (userScrollIntent) {
			rememberScrollPosition(activeConversationId);
		}
	}

	function settleScrollPosition(
		currentId: string,
		getTarget: ScrollTargetGetter,
		shouldStop?: () => boolean,
		attempt = 0
	) {
		window.setTimeout(() => {
			requestAnimationFrame(() => {
				const container = getContainer();
				if (!container || getConversationId() !== currentId) return;

				if (userScrollIntent) {
					finishRestore(currentId);
					return;
				}

				if (shouldStop?.()) {
					finishRestore(currentId);
					return;
				}

				container.scrollTop = getTarget(container);
				stick.handleScroll();

				if (attempt < SCROLL_SETTLE_DELAYS.length - 1) {
					settleScrollPosition(currentId, getTarget, shouldStop, attempt + 1);
					return;
				}

				finishRestore(currentId);
			});
		}, SCROLL_SETTLE_DELAYS[attempt]);
	}

	function finishRestore(currentId?: string) {
		if (!currentId || initializingConversationId === currentId) {
			initializingConversationId = null;
		}

		isRestoring = false;
		stick.handleScroll();
		stick.setEnabled(!getDisableAutoScroll());
	}

	function handleCurrentConversationMessagesReady(currentId: string) {
		if (getDisableAutoScroll() || userScrollIntent || !stick.stick) return;

		requestAnimationFrame(() => {
			const container = getContainer();
			if (
				!container ||
				getConversationId() !== currentId ||
				userScrollIntent ||
				!stick.stick
			) {
				return;
			}

			stick.setEnabled(!getDisableAutoScroll());
			container.scrollTop = container.scrollHeight;
			stick.handleScroll();
			stick.setEnabled(!getDisableAutoScroll());
		});
	}

	function handleMessagesReady() {
		const currentId = getConversationId();
		const container = getContainer();

		if (!currentId || !container) return;

		if (initializingConversationId !== currentId) {
			handleCurrentConversationMessagesReady(currentId);
			return;
		}

		requestAnimationFrame(() => {
			const container = getContainer();
			if (!container || getConversationId() !== currentId) return;

			const saved = getScrollPosition(currentId);
			if (saved !== undefined) {
				isRestoring = true;
				stick.setEnabled(false);
			stick.stick = false;
				container.scrollTop = saved;
				settleScrollPosition(currentId, () => saved);
				return;
			}

			if (getDisableAutoScroll()) {
				finishRestore(currentId);
				return;
			}

			isRestoring = true;
			stick.setEnabled(!getDisableAutoScroll());
			container.scrollTop = container.scrollHeight;
			settleScrollPosition(
				currentId,
				(container) => container.scrollHeight,
				() => getScrollPosition(currentId) !== undefined
			);
		});
	}

	beforeNavigate(() => {
		rememberScrollPosition(activeConversationId, false);
		clearUserScrollIntent();
		isRestoring = true;
	});

	$effect.pre(() => {
		const id = getConversationId();

		untrack(() => {
			if (id === activeConversationId) return;

			if (!isRestoring) {
				rememberScrollPosition(activeConversationId, false);
			}
			clearUserScrollIntent();
			isRestoring = true;
			activeConversationId = id;
			initializingConversationId = id;
			stick.setEnabled(false);
			stick.stick = false;
		});
	});

	onDestroy(clearUserScrollIntent);

	return {
		handlePointerIntent,
		handleKeyboardScrollIntent,
		handleMessagesReady,
		handleScroll,
		markUserScrollIntent
	};
}
