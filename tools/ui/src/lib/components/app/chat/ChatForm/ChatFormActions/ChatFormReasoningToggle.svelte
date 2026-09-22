<script lang="ts">
	import { Check, Info, Lightbulb, LightbulbOff } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { REASONING_EFFORT_LABELS } from '$lib/constants';
	import { ReasoningEffort } from '$lib/enums';
	import { useReasoningMenu } from '$lib/hooks/use-reasoning-menu.svelte';
	import type { ReasoningEffortLevel } from '$lib/types';

	interface Props {
		align?: 'start' | 'center' | 'end';
		class?: string;
		label?: string;
		showLabel?: boolean;
	}

	let {
		align = 'start',
		class: className = '',
		label = 'Reasoning',
		showLabel = false
	}: Props = $props();

	const reasoning = useReasoningMenu();
	let isReasoningActive = $derived(reasoning.isReasoningActive);
	let currentEffort = $derived(reasoning.currentEffort);
	let effortLabel = $derived(REASONING_EFFORT_LABELS[currentEffort]);
	let tooltipText = $derived(
		currentEffort === ReasoningEffort.OFF ? 'Disabled Reasoning' : `${effortLabel} Reasoning`
	);
	let subOpen = $state(false);

	function isSelected(item: ReasoningEffortLevel): boolean {
		return reasoning.isSelected(item);
	}

	function handleSelection(item: ReasoningEffortLevel) {
		reasoning.select(item);
		subOpen = false;
	}
</script>

{#if reasoning.modelSupportsThinking}
	<DropdownMenu.Root bind:open={subOpen}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<DropdownMenu.Trigger
					aria-label={`${tooltipText}. Click to configure.`}
					class={[
						'flex cursor-pointer items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						showLabel ? 'h-8 w-auto gap-2 rounded-md px-2.5 text-sm' : 'h-6 w-6 rounded-full p-0',
						isReasoningActive ? 'bg-amber-400/10 hover:bg-amber-400/20' : 'bg-muted',
						className
					]}
				>
					{#if isReasoningActive}
						<Lightbulb class="h-3 w-3 text-amber-400" />
					{:else}
						<LightbulbOff class="h-3 w-3 text-muted-foreground" />
					{/if}

					{#if showLabel}
						<span>{label}</span>

						<span class="text-muted-foreground">{effortLabel}</span>
					{/if}
				</DropdownMenu.Trigger>
			</Tooltip.Trigger>

			<Tooltip.Content>
				<p class="capitalize">{tooltipText}</p>
			</Tooltip.Content>
		</Tooltip.Root>

		<DropdownMenu.Content
			{align}
			class="w-60 rounded-xl bg-popover p-3 text-popover-foreground shadow-md outline-none"
		>
			<div class="mb-2 px-2.5 text-sm font-medium">Reasoning effort</div>

			{#each reasoning.levels as level (level.value)}
				<button
					class:bg-accent={isSelected(level)}
					class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
					onclick={() => handleSelection(level)}
					type="button"
				>
					{#if isSelected(level)}
						<Check class="h-4 w-4 shrink-0 text-foreground" />
					{:else}
						<div class="h-4 w-4 shrink-0"></div>
					{/if}

					<span class="flex-1">{level.label}</span>

					{#if reasoning.tokenLabel(level)}
						<span class="text-[11px] text-muted-foreground opacity-60">
							{reasoning.tokenLabel(level)}
						</span>
					{/if}

					{#if level.hasInfo}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Info class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							</Tooltip.Trigger>

							<Tooltip.Content side="left">
								<p>Maximum reasoning effort with extended context usage</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{/if}
				</button>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
