<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { fmt } from '$lib/results';
	import { shrinkImage } from '$lib/image';
	import type { Layout } from '$lib/wall';

	let { data } = $props();

	const cats = $derived(data.results.categories);
	const finishers = $derived(cats.flatMap((c) => c.rows.filter((r) => r.time !== null).map((r) => ({ ...r, catId: c.id, catName: c.name }))));

	let query = $state('');
	const matches = $derived.by(() => {
		const s = query.trim().toLowerCase();
		if (!s) return [];
		const hit = (r: (typeof finishers)[number]) => r.bib.toLowerCase() === s || r.name.toLowerCase().includes(s) || !!r.members?.some((m) => m.name.toLowerCase().includes(s));
		return finishers.filter(hit).slice(0, 20);
	});

	let picked = $state<{ bib: string; catId: number } | null>(null);
	const runner = $derived(picked ? finishers.find((r) => r.bib === picked!.bib && r.catId === picked!.catId) : undefined);
	let catId = $state(data.results.categories[0]?.id ?? -1);
	const back = $derived(data.backdrops.find((b) => b.category_id === catId));

	// the layout being edited; reloads from the saved one only when the category or image changes,
	// so a live refresh (a new finish) does not throw away an unsaved drag
	const DEFAULT: Layout = { x: 50, y: 30, size: 12, color: '#ffffff' };
	let draft = $state<Layout>({ ...DEFAULT });
	const backKey = $derived(`${catId}:${back?.v ?? ''}`);
	$effect(() => {
		backKey;
		const b = untrack(() => back);
		draft = b ? { x: b.x, y: b.y, size: b.size, color: b.color } : { ...DEFAULT };
	});
	function nudge(e: KeyboardEvent) {
		const d = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
		if (!editing || !d) return;
		e.preventDefault();
		draft.x = Math.min(100, Math.max(0, draft.x + d[0]));
		draft.y = Math.min(100, Math.max(0, draft.y + d[1]));
	}
	let editing = $state(false);
	const timeText = $derived(runner && runner.catId === catId ? fmt(runner.time!) : editing ? '1:23:45' : '');

	function choose(r: (typeof finishers)[number]) {
		picked = { bib: r.bib, catId: r.catId };
		catId = r.catId;
		query = '';
	}

	let ratio = $state(16 / 9); // from the backdrop's own size, so it is never cropped or stretched
	let wall: HTMLDivElement;
	let stage = $state<HTMLDivElement>();
	const fullscreen = () => wall.requestFullscreen?.();

	// drag the time to place it (organizer, Edit layout on)
	let dragging = false;
	function move(e: PointerEvent) {
		if (!dragging || !stage) return;
		const r = stage.getBoundingClientRect();
		draft.x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10;
		draft.y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10;
	}

	let busy = $state(false);
	let msg = $state('');
	async function act(name: string, fields: Record<string, string | Blob>) {
		busy = true;
		msg = '';
		try {
			const fd = new FormData();
			fd.set('category', String(catId));
			for (const [k, v] of Object.entries(fields)) v instanceof Blob ? fd.set(k, v, 'backdrop.jpg') : fd.set(k, v);
			const r = await fetch(`?/${name}`, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const res = deserialize(await r.text());
			if (res.type !== 'success') throw new Error((res.type === 'failure' && (res.data as { error?: string })?.error) || 'Something went wrong. Try again.');
			await invalidateAll();
			msg = 'Saved.';
		} catch (err) {
			msg = err instanceof Error && err.message !== 'x' ? err.message : 'That file could not be read as an image.';
		} finally {
			busy = false;
		}
	}
	let fileInput = $state<HTMLInputElement>();
	async function upload(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		try {
			await act('upload', { image: await shrinkImage(file, 1920) });
		} catch {
			msg = 'That file could not be read as an image.';
		}
	}
	const save = () => act('layout', { x: String(draft.x), y: String(draft.y), size: String(draft.size), color: draft.color });

	// new finishes show up in the search without a reload
	onMount(() => {
		let t: ReturnType<typeof setTimeout>;
		const es = new EventSource(`/e/${data.slug}/stream`);
		es.onmessage = () => (clearTimeout(t), (t = setTimeout(() => invalidateAll(), 1000)));
		return () => (clearTimeout(t), es.close());
	});

	const btn = 'h-12 border-2 border-border px-4 font-bold uppercase disabled:opacity-40';
</script>

<svelte:head><title>{data.results.event} · Finish wall</title></svelte:head>

<div class="min-h-screen p-4 md:p-6">
	<header class="flex flex-wrap items-end justify-between gap-4 border-b-2 border-border pb-4">
		<div>
			<p class="text-sm font-bold tracking-widest uppercase">Finish wall</p>
			<h1 class="font-display text-5xl leading-[0.85] font-black uppercase md:text-7xl">{data.results.event}</h1>
		</div>
		<a href="/e/{data.slug}" class="flex h-12 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent">Live board</a>
	</header>

	<div class="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr]">
		<section class="flex flex-col gap-3">
			<label class="font-bold uppercase">
				Find a runner
				<input bind:value={query} placeholder="Bib or name" autocomplete="off" class="mt-1 block h-14 w-full border-2 border-border bg-background px-3 text-2xl font-normal normal-case" />
			</label>
			{#if query.trim()}
				<ul class="border-2 border-border bg-card">
					{#each matches as r (r.catId + ':' + r.bib)}
						<li>
							<button type="button" onclick={() => choose(r)} class="grid w-full grid-cols-[4rem_1fr_auto] items-baseline gap-2 border-b-2 border-border/15 px-3 py-2 text-left hover:bg-accent">
								<span class="font-display text-3xl leading-none font-black">{r.bib}</span>
								<span class="min-w-0 truncate font-bold uppercase">{r.name || 'Bib ' + r.bib}<span class="block text-sm font-normal text-muted-foreground">{r.catName}</span></span>
								<span class="font-display text-2xl leading-none font-black tabular-nums">{fmt(r.time!)}</span>
							</button>
						</li>
					{:else}
						<li class="p-3 text-muted-foreground">No finisher matches. Only runners with a finish time can be shown.</li>
					{/each}
				</ul>
			{/if}
			{#if runner}
				<p class="text-lg"><b class="uppercase">{runner.name || 'Bib ' + runner.bib}</b> · #{runner.bib} · {runner.catName}</p>
			{/if}
			<button type="button" onclick={fullscreen} disabled={!timeText} class="{btn} h-16 bg-primary text-2xl text-primary-foreground">Fullscreen</button>

			{#if data.admin}
				<div class="mt-2 flex flex-col gap-3 border-2 border-border bg-card p-3">
					<h2 class="font-display text-3xl font-black uppercase">Backdrops</h2>
					<label class="font-bold uppercase">
						Category
						<select bind:value={catId} class="mt-1 block h-12 w-full border-2 border-border bg-card px-2 font-bold">
							{#each cats as c (c.id)}<option value={c.id}>{c.name}{data.backdrops.some((b) => b.category_id === c.id) ? '' : ' (no backdrop)'}</option>{/each}
						</select>
					</label>
					<input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange={upload} aria-label="Choose a backdrop image" />
					<div class="flex flex-wrap gap-2">
						<button type="button" disabled={busy} onclick={() => fileInput?.click()} class="{btn} bg-card hover:bg-accent">{back ? 'Replace' : 'Upload'} image</button>
						{#if back}<button type="button" disabled={busy} onclick={() => confirm('Remove this backdrop?') && act('remove', {})} class="{btn} bg-card hover:bg-accent">Remove</button>{/if}
					</div>
					{#if back}
						<label class="flex items-center gap-2 font-bold uppercase"><input type="checkbox" bind:checked={editing} class="size-5" /> Edit time position</label>
						{#if editing}
							<p class="text-sm text-muted-foreground">Drag the time on the picture to place it.</p>
							<label class="font-bold uppercase">Size <input type="range" min="2" max="40" step="0.5" bind:value={draft.size} class="block w-full" /></label>
							<label class="flex items-center gap-2 font-bold uppercase">Color <input type="color" bind:value={draft.color} class="h-10 w-16 border-2 border-border" /></label>
							<button type="button" disabled={busy} onclick={save} class="{btn} bg-primary text-primary-foreground">Save position</button>
						{/if}
					{/if}
					{#if msg}<p class="font-bold" role="status">{msg}</p>{/if}
				</div>
			{/if}
		</section>

		<div bind:this={wall} class="wall">
			<div bind:this={stage} class="stage relative overflow-hidden border-2 border-border bg-[#14052b]" style="--r:{ratio}">
				{#if back}
					<img src="/e/{data.slug}/wall/backdrop/{catId}?v={back.v}" alt="" class="absolute inset-0 size-full" onload={(e) => { const i = e.currentTarget as HTMLImageElement; ratio = i.naturalWidth / i.naturalHeight || 16 / 9; }} />
				{/if}
				{#if timeText}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (it is a slider while editing; the role is set with it) -->
					<span
						role={editing ? 'slider' : undefined}
						aria-label={editing ? 'Time position, arrow keys move it' : undefined}
						aria-valuemin={editing ? 0 : undefined}
						aria-valuemax={editing ? 100 : undefined}
						aria-valuenow={editing ? draft.y : undefined}
						aria-valuetext={editing ? `${draft.x}% across, ${draft.y}% down` : undefined}
						tabindex={editing ? 0 : undefined}
						onkeydown={nudge}
						class="time absolute font-display leading-none font-black whitespace-nowrap tabular-nums {editing ? 'cursor-move outline-2 outline-dashed' : ''}"
						style="left:{draft.x}%; top:{draft.y}%; font-size:{draft.size}cqw; color:{draft.color}"
						onpointerdown={(e) => editing && ((dragging = true), e.currentTarget.setPointerCapture(e.pointerId))}
						onpointermove={move}
						onpointerup={() => (dragging = false)}>{timeText}</span
					>
				{:else}
					<p class="absolute inset-0 grid place-items-center p-6 text-center text-2xl text-white/70">Search a runner to show their finish time.</p>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.stage {
		width: 100%;
		max-width: calc((100vh - 9rem) * var(--r)); /* the whole picture fits on a laptop screen too */
		aspect-ratio: var(--r);
		container-type: inline-size; /* the time's size is a share of the picture's width, on every screen */
	}
	.time {
		transform: translate(-50%, -50%);
		touch-action: none;
	}
	.wall:fullscreen {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
	}
	.wall:fullscreen .stage {
		width: min(100vw, calc(100vh * var(--r)));
		max-width: none;
		border: 0;
	}
</style>
