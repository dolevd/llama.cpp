import { expect, test, type Page } from '@playwright/test';

/**
 * E2E tests for the per-conversation scroll position memory feature
 * (see `src/lib/hooks/use-chat-scroll-position.svelte.ts`).
 *
 * The tests seed the IndexedDB directly with conversations of different
 * lengths (so the auto-scroll actually fires during a switch - identical
 * content would not trigger the bug being guarded against), then exercise
 * the sidebar to switch between them and assert the scroll position is
 * preserved across the switch.
 */

const SCROLL_CONTAINER = 'html';
const SIDEBAR_ROOT = '[data-slot="sidebar"]';
const DB_NAME = 'LlamaUi';
const CONV_STORE = 'conversations';
const MSG_STORE = 'messages';

interface SeededData {
	convA: string;
	convB: string;
	convC: string;
	convAName: string;
	convBName: string;
	convCName: string;
}

async function clearDatabase(page: Page) {
	await page.evaluate(
		(dbName) =>
			new Promise<void>((resolve, reject) => {
				const req = indexedDB.deleteDatabase(dbName);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
				req.onblocked = () => resolve();
			}),
		DB_NAME
	);
}

interface SeedInput {
	dbName: string;
	convStore: string;
	msgStore: string;
	convA: string;
	convB: string;
	convC: string;
	convAName: string;
	convBName: string;
	convCName: string;
	baseTimestamp: number;
	countA: number;
	countB: number;
	countC: number;
}

async function seedConversations(
	page: Page,
	countA: number,
	countB: number,
	countC: number
): Promise<SeededData> {
	return await page.evaluate(
		({
			dbName,
			convStore,
			msgStore,
			convA,
			convB,
			convC,
			convAName,
			convBName,
			convCName,
			baseTimestamp,
			countA,
			countB,
			countC
		}: SeedInput) => {
			return new Promise<SeededData>((resolve, reject) => {
				// Open without a version: if the DB already exists (e.g. from a
				// prior run), IndexedDB opens it at the current version; if it
				// doesn't, it is created at version 1. The schema (stores) is
				// the same in both cases, so seeding is unaffected.
				const open = indexedDB.open(dbName);
				open.onerror = () => reject(open.error);
				open.onupgradeneeded = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains(convStore)) {
						db.createObjectStore(convStore, { keyPath: 'id' });
					}
					if (!db.objectStoreNames.contains(msgStore)) {
						db.createObjectStore(msgStore, { keyPath: 'id' });
					}
				};
				open.onsuccess = () => {
					const db = open.result;
					const tx = db.transaction([convStore, msgStore], 'readwrite');
					const cStore = tx.objectStore(convStore);
					const mStore = tx.objectStore(msgStore);

					const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);

					function buildChain(convId: string, count: number, startTs: number) {
						const messages: unknown[] = [];
						const rootId = `${convId}-root`;
						messages.push({
							id: rootId,
							convId,
							type: 'root',
							role: 'system',
							timestamp: startTs,
							content: '',
							parent: null,
							toolCalls: '',
							children: [`${convId}-m0`]
						});

						let prevId = rootId;
						for (let i = 0; i < count; i++) {
							const id = `${convId}-m${i}`;
							messages.push({
								id,
								convId,
								type: 'text',
								role: i % 2 === 0 ? 'user' : 'assistant',
								timestamp: startTs + i + 1,
								content: longText,
								parent: prevId,
								toolCalls: '',
								children: i < count - 1 ? [`${convId}-m${i + 1}`] : []
							});
							prevId = id;
						}

						return { messages, lastId: prevId };
					}

					const chainA = buildChain(convA, countA, baseTimestamp);
					const chainB = buildChain(convB, countB, baseTimestamp + 1000);
					const chainC = buildChain(convC, countC, baseTimestamp + 2000);

					cStore.add({
						id: convA,
						name: convAName,
						lastModified: baseTimestamp,
						currNode: chainA.lastId,
						mode: 'chat'
					});
					cStore.add({
						id: convB,
						name: convBName,
						lastModified: baseTimestamp + 1000,
						currNode: chainB.lastId,
						mode: 'chat'
					});
					cStore.add({
						id: convC,
						name: convCName,
						lastModified: baseTimestamp + 2000,
						currNode: chainC.lastId,
						mode: 'chat'
					});

					for (const m of chainA.messages) mStore.add(m);
					for (const m of chainB.messages) mStore.add(m);
					for (const m of chainC.messages) mStore.add(m);

					tx.oncomplete = () => {
						db.close();
						resolve({ convA, convB, convC, convAName, convBName, convCName });
					};
					tx.onerror = () => reject(tx.error);
				};
			});
		},
		{
			dbName: DB_NAME,
			convStore: CONV_STORE,
			msgStore: MSG_STORE,
			convA: 'conv-A',
			convB: 'conv-B',
			convC: 'conv-C',
			convAName: `Scroll test conv A ${Date.now()}`,
			convBName: `Scroll test conv B ${Date.now() + 1}`,
			convCName: `Scroll test conv C ${Date.now() + 2}`,
			baseTimestamp: Date.now(),
			countA,
			countB,
			countC
		}
	);
}

/**
 * Scrolls the container with a real wheel event and waits until the
 * resulting position sticks. If the auto-scroll fires and snaps the
 * container back to the bottom, this helper surfaces that as a failure -
 * which is exactly the bug this feature guards against.
 */
async function scrollByWheelAndAssertSticks(
	page: Page,
	container: ReturnType<Page['locator']>,
	deltaY: number
) {
	const before = await container.evaluate((el) => el.scrollTop);
	await container.hover();
	await page.mouse.wheel(0, deltaY);
	await expect
		.poll(async () => await container.evaluate((el) => el.scrollTop), { timeout: 1000 })
		.not.toBe(before);
	await page.waitForTimeout(1000);
	const target = await container.evaluate((el) => el.scrollTop);
	// Sample again to make sure the auto-scroll doesn't snap us back to
	// the bottom a few frames after the wheel scroll.
	await page.waitForTimeout(300);
	await expect
		.poll(async () => await container.evaluate((el) => el.scrollTop), { timeout: 1000 })
		.toBe(target);

	return target;
}

async function expectAtBottom(container: ReturnType<Page['locator']>) {
	await expect
		.poll(
			async () =>
				await container.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
			{ timeout: 10000 }
		)
		.toBeLessThanOrEqual(64);
}

async function getScrollTop(container: ReturnType<Page['locator']>) {
	return await container.evaluate((el) => el.scrollTop);
}

test.describe('Chat scroll position memory', () => {
	test.beforeEach(async ({ page }) => {
		// The sidebar is hidden by default on desktop. Force it open so the
		// recent-conversations list is always reachable from the test.
		await page.addInitScript(() => {
			localStorage.setItem('LlamaUi.config', JSON.stringify({ alwaysShowSidebarOnDesktop: true }));
			localStorage.setItem('LlamaUi.mcpServersSetupDone', 'true');
		});
	});

	test('preserves the scroll position of a scrolled-up conversation across switches', async ({
		page
	}) => {
		// Start with a clean IndexedDB so seeded ids don't collide with stale data.
		await page.goto('/');
		await clearDatabase(page);
		await page.reload();

		// Wait for the chat screen to render - the greeting is only mounted
		// after `isServerLoading` flips to false.
		await expect(page.locator('h1', { hasText: /Hello there/ })).toBeVisible();

		// Seed several conversations with DIFFERENT lengths so a real switch
		// changes the container's `scrollHeight` and the auto-scroll would
		// fire if the new guard didn't hold it back.
		const seed = await seedConversations(page, 90, 75, 60);
		await page.reload();
		await expect(page.locator('h1', { hasText: /Hello there/ })).toBeVisible();

		const sidebar = page.locator(SIDEBAR_ROOT);
		const itemA = sidebar.locator('button', { hasText: seed.convAName });
		const itemB = sidebar.locator('button', { hasText: seed.convBName });
		const itemC = sidebar.locator('button', { hasText: seed.convCName });
		await expect(itemA).toBeVisible();
		await expect(itemB).toBeVisible();
		await expect(itemC).toBeVisible();

		const container = page.locator(SCROLL_CONTAINER);
		await expect(container).toBeVisible();

		// Open A and wait for the message list to be tall enough to scroll
		// to a meaningful position (well into the middle, not just the top).
		await itemA.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convA}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollHeight), { timeout: 10000 })
			.toBeGreaterThan(4000);
		await expectAtBottom(container);

		// Scroll A near the beginning of the conversation. This is the
		// position we expect to be restored on return.
		await scrollByWheelAndAssertSticks(page, container, -20000);
		const scrollTargetA = await getScrollTop(container);

		// Switch to B. B has no saved position yet, so it should start at
		// the bottom instead of inheriting A's scrollTop.
		await itemB.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convB}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollHeight), { timeout: 10000 })
			.toBeGreaterThan(2000);
		await expectAtBottom(container);

		// Scroll B up by a few messages. B should get its own saved
		// position, independent from A's.
		await scrollByWheelAndAssertSticks(page, container, -2500);
		const scrollTargetB = await getScrollTop(container);

		// Switch back to A - the saved early position must be restored,
		// not the bottom of A's content.
		await itemA.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convA}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollTop), { timeout: 10000 })
			.toBe(scrollTargetA);

		// And switching to B again should restore B's saved position.
		await itemB.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convB}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollTop), { timeout: 10000 })
			.toBe(scrollTargetB);

		// A third unsaved chat still starts at the bottom, proving saved
		// positions are keyed per conversation and not inherited globally.
		await itemC.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convC}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollHeight), { timeout: 10000 })
			.toBeGreaterThan(2000);
		await expectAtBottom(container);
	});

	test('saves the scroll position of the conversation being switched away from', async ({
		page
	}) => {
		await page.goto('/');
		await clearDatabase(page);
		await page.reload();

		await expect(page.locator('h1', { hasText: /Hello there/ })).toBeVisible();

		const seed = await seedConversations(page, 90, 75, 60);
		await page.reload();
		await expect(page.locator('h1', { hasText: /Hello there/ })).toBeVisible();

		const sidebar = page.locator(SIDEBAR_ROOT);
		const itemA = sidebar.locator('button', { hasText: seed.convAName });
		const itemB = sidebar.locator('button', { hasText: seed.convBName });
		const itemC = sidebar.locator('button', { hasText: seed.convCName });
		await expect(itemA).toBeVisible();
		await expect(itemB).toBeVisible();
		await expect(itemC).toBeVisible();

		const container = page.locator(SCROLL_CONTAINER);
		await expect(container).toBeVisible();

		// Open A, scroll it deep into the middle, then navigate to B without
		// scrolling B first.
		await itemA.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convA}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollHeight), { timeout: 10000 })
			.toBeGreaterThan(4000);

		await scrollByWheelAndAssertSticks(page, container, -8000);
		const scrollTargetA = await getScrollTop(container);

		// Move to B. A's position must persist across this switch.
		await itemB.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convB}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollHeight), { timeout: 10000 })
			.toBeGreaterThan(2000);
		await expectAtBottom(container);

		// Returning to A should restore the exact position we left at.
		await itemA.click();
		await expect(page).toHaveURL(new RegExp(`/chat/${seed.convA}$`));
		await expect
			.poll(async () => await container.evaluate((el) => el.scrollTop), { timeout: 10000 })
			.toBe(scrollTargetA);
	});
});
