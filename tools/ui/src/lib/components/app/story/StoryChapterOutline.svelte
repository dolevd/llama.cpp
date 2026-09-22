<script lang="ts">
	import { Check, Circle, Loader2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { StoryChapterOutlineItem } from '$lib/utils';

	interface Props {
		items: StoryChapterOutlineItem[];
		onNavigate?: (messageId: string) => void;
		title: string;
	}

	let { items, onNavigate, title }: Props = $props();

	let generatedCount = $derived(items.filter((item) => item.status === 'generated').length);

	function chapterLabel(item: StoryChapterOutlineItem): string {
		return `Chapter ${item.index + 1}: ${item.title}, ${item.status}`;
	}

	function itemClass(item: StoryChapterOutlineItem): string {
		const layout =
			'h-auto min-h-11 min-w-44 justify-start whitespace-normal px-2 py-2 text-left 2xl:min-w-0 2xl:w-full';

		if (item.status === 'generating') return `${layout} bg-muted text-foreground`;

		if (item.status === 'generated') return `${layout} text-foreground`;

		return `${layout} text-muted-foreground`;
	}
</script>

<aside
	class="fixed top-14 right-3 left-3 z-20 2xl:top-4 2xl:right-4 2xl:bottom-24 2xl:left-auto 2xl:w-64"
	data-testid="story-chapter-outline"
>
	<Card.Root
		class="gap-2 bg-background/95 py-2 shadow-md backdrop-blur-md 2xl:h-full 2xl:gap-4 2xl:py-4"
	>
		<Card.Header class="hidden px-4 2xl:grid">
			<Card.Title class="truncate text-sm">{title}</Card.Title>
			<Card.Description>
				{generatedCount} of {items.length} chapters generated
			</Card.Description>
		</Card.Header>

		<Card.Content class="min-h-0 px-2">
			<nav aria-label="Story chapter outline">
				<p class="sr-only" aria-live="polite">
					{generatedCount} of {items.length} chapters generated
				</p>

				<ol
					class="flex gap-1 overflow-x-auto pb-1 2xl:max-h-full 2xl:flex-col 2xl:overflow-x-hidden 2xl:overflow-y-auto 2xl:pb-0"
				>
					{#each items as item (item.index)}
						<li>
							{#snippet chapterContent()}
								<span class="flex min-w-0 items-center gap-2">
									{#if item.status === 'generated'}
										<Check class="text-primary" aria-hidden="true" />
									{:else if item.status === 'generating'}
										<Loader2
											class="animate-spin text-foreground motion-reduce:animate-none"
											aria-hidden="true"
										/>
									{:else}
										<Circle class="text-muted-foreground/50" aria-hidden="true" />
									{/if}

									<span class="min-w-0">
										<span class="block text-xs text-muted-foreground">Chapter {item.index + 1}</span
										>
										<span class="block truncate text-sm">{item.title}</span>
									</span>
									<span class="sr-only">{item.status}</span>
								</span>
							{/snippet}

							{#if item.messageId && item.status !== 'pending'}
								{@const messageId = item.messageId}
								<Button
									variant="ghost"
									class={itemClass(item)}
									aria-label={chapterLabel(item)}
									aria-current={item.status === 'generating' ? 'step' : undefined}
									title={item.title}
									onclick={() => onNavigate?.(messageId)}
								>
									{@render chapterContent()}
								</Button>
							{:else}
								<div class={itemClass(item)} title={item.title}>
									{@render chapterContent()}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
		</Card.Content>
	</Card.Root>
</aside>
