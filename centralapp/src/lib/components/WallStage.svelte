<script lang="ts">
	import { ITEMS, type Backdrop, type Item, type Layout } from '$lib/wall';

	// The finish wall picture: a category backdrop with the time and the name drawn on it. Positions are shares of the
	// picture and sizes use container units, so it looks the same on a laptop preview, a TV or a projector.
	// `fill` = the display screen: the picture as large as the screen allows, never cropped.
	type Props = { slug: string; catId: number; back: Backdrop | undefined; draft: Record<Item, Layout>; texts: Record<Item, string>; editing?: boolean; fill?: boolean; empty?: string };
	let { slug, catId, back, draft = $bindable(), texts, editing = false, fill = false, empty = '' }: Props = $props();

	let ratio = $state(16 / 9); // from the backdrop's own size, so it is never cropped or stretched
	let stage = $state<HTMLDivElement>();

	// drag a text to place it (organizer, Edit positions on)
	let dragging: Item | null = null;
	function move(e: PointerEvent) {
		if (!dragging || !stage) return;
		const r = stage.getBoundingClientRect();
		draft[dragging].x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10;
		draft[dragging].y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10;
	}
	function nudge(e: KeyboardEvent, item: Item) {
		const d = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
		if (!editing || !d) return;
		e.preventDefault();
		draft[item].x = Math.min(100, Math.max(0, draft[item].x + d[0]));
		draft[item].y = Math.min(100, Math.max(0, draft[item].y + d[1]));
	}
</script>

<div bind:this={stage} class="stage relative overflow-hidden bg-[#14052b] {fill ? 'fill' : 'border-2 border-border'}" style="--r:{ratio}">
	{#if back}
		<img src="/e/{slug}/wall/backdrop/{catId}?v={back.v}" alt="" class="absolute inset-0 size-full" onload={(e) => { const i = e.currentTarget as HTMLImageElement; ratio = i.naturalWidth / i.naturalHeight || 16 / 9; }} />
	{/if}
	{#if texts.time}
		{#each ITEMS as [item, label] (item)}
			{@const l = draft[item]}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (it is a slider while editing; the role is set with it) -->
			<span
				role={editing ? 'slider' : undefined}
				aria-label={editing ? `${label} position, arrow keys move it` : undefined}
				aria-valuemin={editing ? 0 : undefined}
				aria-valuemax={editing ? 100 : undefined}
				aria-valuenow={editing ? l.y : undefined}
				aria-valuetext={editing ? `${l.x}% across, ${l.y}% down` : undefined}
				tabindex={editing ? 0 : undefined}
				onkeydown={(e) => nudge(e, item)}
				class="text chakra absolute font-display leading-none font-black whitespace-nowrap {item === 'time' ? 'tabular-nums' : 'uppercase'} {editing ? 'cursor-move outline-2 outline-dashed' : ''}"
				style="left:{l.x}%; top:{l.y}%; font-size:{l.size}cqw; color:{l.color}"
				onpointerdown={(e) => editing && ((dragging = item), e.currentTarget.setPointerCapture(e.pointerId))}
				onpointermove={move}
				onpointerup={() => (dragging = null)}>{texts[item]}</span
			>
		{/each}
	{:else if empty}
		<p class="absolute inset-0 grid place-items-center p-6 text-center text-2xl text-white/70">{empty}</p>
	{/if}
</div>

<style>
	.stage {
		width: 100%;
		max-width: calc((100vh - 9rem) * var(--r)); /* the whole picture fits on a laptop screen too */
		aspect-ratio: var(--r);
		container-type: inline-size; /* text sizes are a share of the picture's width, on every screen */
	}
	.stage.fill,
	:global(:fullscreen) .stage {
		width: min(100vw, calc(100vh * var(--r)));
		max-width: none;
		border: 0;
	}
	.text {
		transform: translate(-50%, -50%);
		touch-action: none;
	}
</style>
