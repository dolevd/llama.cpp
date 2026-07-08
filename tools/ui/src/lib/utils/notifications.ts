const RESPONSE_READY_MESSAGE = 'Response ready';
const RESPONSE_FAILED_MESSAGE = 'Response failed';
const STORY_APPROVAL_NEEDED_MESSAGE = 'Story outline ready for approval';
const STORY_COMPLETE_MESSAGE = 'Final story chapter complete';

const NOTIFICATION_AUTO_CLOSE_MS = 5000;

let pageVisible = true;
let visibilityTrackingInitialized = false;

function getNotification(): typeof Notification | null {
	if (typeof window === 'undefined' || !('Notification' in window)) return null;
	return window.Notification;
}

function initVisibilityTracking(): void {
	if (visibilityTrackingInitialized || typeof document === 'undefined') return;

	const updatePageVisibility = () => {
		pageVisible = document.visibilityState === 'visible';
	};

	updatePageVisibility();
	document.addEventListener('visibilitychange', updatePageVisibility);
	visibilityTrackingInitialized = true;
}

export function requestResponseNotificationPermission(enabled: boolean): void {
	if (!enabled) return;

	const notification = getNotification();
	if (!notification || notification.permission !== 'default') return;

	notification.requestPermission().catch(() => {
		// Browsers may reject permission requests outside user gestures.
	});
}

function showNotification(message: string, enabled: boolean): void {
	if (!enabled) return;

	initVisibilityTracking();
	if (pageVisible) return;

	const notification = getNotification();
	if (!notification || notification.permission !== 'granted') return;

	const instance = new notification(message, {
		requireInteraction: false,
		silent: true
	});

	window.setTimeout(() => {
		instance.close();
	}, NOTIFICATION_AUTO_CLOSE_MS);
}

export function notifyResponseReady(enabled: boolean): void {
	showNotification(RESPONSE_READY_MESSAGE, enabled);
}

export function notifyResponseFailed(enabled: boolean): void {
	showNotification(RESPONSE_FAILED_MESSAGE, enabled);
}

export function notifyStoryApprovalNeeded(enabled: boolean): void {
	showNotification(STORY_APPROVAL_NEEDED_MESSAGE, enabled);
}

export function notifyStoryComplete(enabled: boolean): void {
	showNotification(STORY_COMPLETE_MESSAGE, enabled);
}
