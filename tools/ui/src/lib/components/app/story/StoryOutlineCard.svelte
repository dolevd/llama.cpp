<script lang="ts">
	import { Check, Pencil, RefreshCw } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { MarkdownContent } from '$lib/components/app/content';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { StoryMetadata } from '$lib/types';

	interface Props {
		isLoading?: boolean;
		leftActions?: Snippet;
		onApprove?: (outlineText: string, story: StoryMetadata) => Promise<void> | void;
		onRegenerate?: (story: StoryMetadata) => Promise<void> | void;
		story?: StoryMetadata;
	}

	let { isLoading = false, leftActions, onApprove, onRegenerate, story }: Props = $props();

	let editMode = $state(false);
	let lastUpdatedAt = $state(0);
	let outlineText = $state('');

	let canAct = $derived(!isLoading && story?.phase === 'awaiting_approval');
	let isActionable = $derived(story?.phase === 'awaiting_approval' || story?.phase === 'error');
	let shouldRender = $derived(Boolean(story && (isActionable || story.outlineText)));

	function syncFromStory() {
		if (!story || story.updatedAt === lastUpdatedAt) return;

		lastUpdatedAt = story.updatedAt;
		outlineText = story.outlineText ?? '';
		editMode = story.phase === 'error' || !outlineText;
	}

	async function handleApprove() {
		if (!canAct || !story) return;

		await onApprove?.(outlineText, story);
	}

	async function handleRegenerate() {
		if (!story) return;

		await onRegenerate?.(story);
	}

	$effect(syncFromStory);
</script>

{#if shouldRender}
	<div class="mx-auto flex w-full max-w-[48rem] justify-start px-0 py-4">
		<div class="w-full rounded-2xl border bg-background/95 p-4 shadow-sm">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-sm font-medium">
						{story?.phase === 'error' ? 'Story outline needs regeneration' : 'Story outline'}
					</p>

					{#if story?.error}
						<p class="text-sm text-muted-foreground">{story.error}</p>
					{/if}
				</div>

				{#if story?.phase === 'awaiting_approval'}
					<Button
						type="button"
						variant="ghost"
						disabled={isLoading}
						onclick={() => (editMode = !editMode)}
					>
						<Pencil data-icon="inline-start" />
						{editMode ? 'Preview' : 'Edit'}
					</Button>
				{/if}
			</div>

			{#if editMode}
				<Textarea
					bind:value={outlineText}
					aria-label="Editable story outline"
					class="min-h-80 font-mono text-sm"
				/>
			{:else}
				<div class="rounded-xl bg-muted/20 p-4">
					<MarkdownContent content={outlineText} />
				</div>
			{/if}

			{#if isActionable}
				<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					{#if story?.phase === 'awaiting_approval' && leftActions}
						<div class="flex items-center">
							{@render leftActions()}
						</div>
					{:else}
						<div></div>
					{/if}

					<div class="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							aria-label="Regenerate story outline"
							disabled={isLoading}
							onclick={handleRegenerate}
						>
							<RefreshCw data-icon="inline-start" />
							Regenerate
						</Button>

						{#if story?.phase === 'awaiting_approval'}
							<Button
								type="button"
								aria-label="Approve story outline"
								disabled={!canAct}
								onclick={handleApprove}
							>
								<Check data-icon="inline-start" />
								Approve
							</Button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
