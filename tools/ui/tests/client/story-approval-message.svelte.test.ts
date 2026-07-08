import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StoryOutlineCard from '$lib/components/app/story/StoryOutlineCard.svelte';
import type { StoryMetadata } from '$lib/types';

function story(): StoryMetadata {
	return {
		phase: 'awaiting_approval',
		updatedAt: 1,
		title: 'The Star-Glass Echo',
		summary: 'Elian must decide whether to follow the haunted road.',
		outlineText: `# The Star-Glass Echo

Elian must decide whether to follow the haunted road.

## Chapter 1: The Whispering Causeway

Elian hears his sister's name in the broken stones.

## Chapter 2: The Road Beyond Ash

Elian leaves the causeway to seek the source of the whispers.`,
		chapterSummaries: [
			{
				title: 'The Whispering Causeway',
				summary: "Elian hears his sister's name in the broken stones."
			},
			{
				title: 'The Road Beyond Ash',
				summary: 'Elian leaves the causeway to seek the source of the whispers.'
			}
		]
	};
}

describe('StoryOutlineCard', () => {
	it('renders the editable outline as a chat message with actionable story controls', async () => {
		await render(StoryOutlineCard, {
			props: {
				story: story(),
				isLoading: false,
				onApprove: () => {},
				onRegenerate: () => {}
			}
		});

		await expect.poll(() => document.body.textContent ?? '').toContain('The Star-Glass Echo');

		expect(document.body.textContent).toContain('Story outline');
		expect(document.body.textContent).toContain('Chapter 1: The Whispering Causeway');
		expect(document.body.textContent).toContain('Chapter 2: The Road Beyond Ash');

		const regenerate = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Regenerate story outline"]'
		);
		const approve = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Approve story outline"]'
		);

		expect(regenerate).not.toBeNull();
		expect(regenerate?.disabled).toBe(false);
		expect(approve).not.toBeNull();
		expect(approve?.disabled).toBe(false);
	});
});
