import StoryChapterOutline from '$lib/components/app/story/StoryChapterOutline.svelte';
import type { StoryChapterOutlineItem } from '$lib/utils';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const items: StoryChapterOutlineItem[] = [
	{
		index: 0,
		messageId: 'assistant-1',
		status: 'generated',
		summary: 'First summary.',
		title: 'The First Door'
	},
	{
		index: 1,
		messageId: 'assistant-2',
		status: 'generating',
		summary: 'Second summary.',
		title: 'The Turning Key'
	},
	{
		index: 2,
		status: 'pending',
		summary: 'Third summary.',
		title: 'The Quiet Room'
	}
];

describe('StoryChapterOutline', () => {
	it('renders chapter states and only links available responses', async () => {
		const onNavigate = vi.fn();

		await render(StoryChapterOutline, {
			props: { items, onNavigate, title: 'The Test Story' }
		});

		const generated = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Chapter 1: The First Door, generated"]'
		);
		const generating = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Chapter 2: The Turning Key, generating"]'
		);
		const pending = document.querySelector(
			'button[aria-label="Chapter 3: The Quiet Room, pending"]'
		);

		expect(generated).not.toBeNull();
		expect(generated?.querySelector('.lucide-check')).not.toBeNull();
		expect(generating).not.toBeNull();
		expect(generating?.querySelector('.animate-spin')).not.toBeNull();
		expect(generating?.getAttribute('aria-current')).toBe('step');
		expect(pending).toBeNull();
		expect(document.body.textContent).toContain('The Quiet Room');

		generated?.click();
		generating?.click();

		expect(onNavigate).toHaveBeenNthCalledWith(1, 'assistant-1');
		expect(onNavigate).toHaveBeenNthCalledWith(2, 'assistant-2');
	});
});
