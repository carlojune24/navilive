<script lang="ts">
	import { onMount } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import Trophy from '@lucide/svelte/icons/trophy';
	import RouteMap from '$lib/components/RouteMap.svelte';
	import ProgressTable from '$lib/components/ProgressTable.svelte';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { fmt, type Cat, type Mode } from '$lib/results';

	let { data } = $props();

	type Payload = { event: string; mode: Mode; serverMs: number; lastReadAgoMs: number | null; awardsHidden?: boolean; batches: { id: number; name: string; category_id: number }[]; batchOf: Record<string, number>; categories: Cat[] };

	let res = $state<Payload>(data.initial);
	let mode = $state<Mode>(data.initial.mode);
	let active = $state(data.initial.categories[0]?.id ?? -1);
	let auto = $state(data.kiosk);
	let connected = $state(false);
	let fetchedAt = $state(Date.now());
	let now = $state(Date.now());
	let open = $state<Set<string>>(new Set());
	let fresh = $state<Set<string>>(new Set());
	// rows slide to their new place when the order changes; people who ask their system for less motion get none
	let reduceMotion = $state(false);
	const slide = $derived({ duration: reduceMotion ? 0 : 450 });
	const enter = $derived({ y: -24, duration: reduceMotion ? 0 : 350 });
	let seen: Set<string> | null = null; // null until the first load, so the initial list does not flash
	let cycleSec = $state(data.cycle); // seconds each category stays on screen while auto-cycling
	const CYCLE_CHOICES = [5, 8, 12, 20, 30, 60];
	let view = $state<'results' | 'awards' | 'progress' | 'map'>(data.view); // what the board shows for the selected category

	const cat = $derived(res.categories.find((c) => c.id === active) ?? res.categories[0]);
	// race clock: the server's start time against the server's clock (this browser's own clock may be off)
	const clockMs = $derived(mode === 'gun' && cat?.gunManual && cat.gunMs ? Math.max(0, now + (res.serverMs - fetchedAt) - cat.gunMs) : null);
	const ago = $derived(res.lastReadAgoMs === null ? null : res.lastReadAgoMs + (now - fetchedAt));
	const agoText = $derived(
		ago === null ? 'No reads yet' : ago < 60000 ? `Last read ${Math.floor(ago / 1000)}s ago` : `Last read ${Math.floor(ago / 60000)} min ago`
	);

	// Progress view: the shown category's runners, narrowed to one batch when picked
	let batchSel = $state<'all' | 'none' | number>('all');
	const catBatches = $derived(res.batches.filter((b) => b.category_id === cat?.id));
	const progRows = $derived.by(() => {
		const rows = cat?.progress ?? [];
		if (batchSel === 'all' || !catBatches.length) return rows;
		return rows.filter((r) => (res.batchOf[r.bib] ?? null) === (batchSel === 'none' ? null : batchSel));
	});

	function track(p: Payload) {
		const keys = p.categories.flatMap((c) => c.rows.map((r) => `${c.id}:${r.bib}`));
		if (seen) {
			const added = keys.filter((k) => !seen!.has(k));
			if (added.length) {
				fresh = new Set([...fresh, ...added]);
				setTimeout(() => (fresh = new Set([...fresh].filter((k) => !added.includes(k)))), 2600);
			}
		}
		seen = new Set(keys);
	}

	async function refresh() {
		try {
			const r = await fetch(`/e/${data.slug}/results?mode=${mode}`);
			if (!r.ok) return;
			const p: Payload = await r.json();
			track(p);
			res = p;
			fetchedAt = Date.now();
		} catch {
			/* connection state shows the problem */
		}
	}

	function pick(id: number) {
		active = id;
		batchSel = 'all';
		auto = false;
	}

	function toggle(key: string) {
		const s = new Set(open);
		s.has(key) ? s.delete(key) : s.add(key);
		open = s;
	}

	onMount(() => {
		reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		track(res);
		const tick = setInterval(() => (now = Date.now()), 1000);
		let t: ReturnType<typeof setTimeout>;
		const es = new EventSource(`/e/${data.slug}/stream`);
		es.onopen = () => {
			connected = true;
			refresh(); // catch up on anything missed while disconnected
		};
		es.onerror = () => (connected = false);
		es.onmessage = () => (clearTimeout(t), (t = setTimeout(refresh, 250)));
		return () => (clearInterval(tick), clearTimeout(t), es.close());
	});

	// Categories the cycle visits: those with finishers (or all, when none have any yet).
	const cycleIds = $derived.by(() => {
		const list = res.categories.filter((c) => c.rows.length || res.categories.length === 1);
		return (list.length ? list : res.categories).map((c) => c.id);
	});
	const nextId = $derived(cycleIds.length ? cycleIds[(cycleIds.indexOf(active) + 1) % cycleIds.length] : -1);
	const nextName = $derived(res.categories.find((c) => c.id === nextId)?.name ?? '');

	let remaining = $state(0); // seconds until the next switch
	$effect(() => {
		if (!auto) return;
		const total = cycleSec; // read here so changing the setting restarts the countdown
		remaining = total;
		const id = setInterval(() => {
			remaining -= 1;
			if (remaining <= 0) {
				if (nextId !== -1) (active = nextId), (batchSel = 'all');
				remaining = total;
			}
		}, 1000);
		return () => clearInterval(id);
	});
</script>

{#snippet medal(place: number, size: string)}
	<Trophy
		class="shrink-0 {size}"
		strokeWidth={2.5}
		role="img"
		aria-label={place === 1 ? 'Gold, first place' : place === 2 ? 'Silver, second place' : 'Bronze, third place'}
		style="fill: var(--{place === 1 ? 'gold' : place === 2 ? 'silver' : 'bronze'})"
	/>
{/snippet}

{#snippet face(stamp: number | null | undefined, bib: string, size: string)}
	{#if stamp}<img src="/e/{data.slug}/photo/{bib}?v={stamp}" alt="" class="shrink-0 border-2 border-border object-cover {size}" loading="lazy" />{/if}
{/snippet}

<svelte:head><title>{res.event} · Live results</title></svelte:head>
<Toaster position="top-center" />

<div class="min-h-screen p-4 md:p-6">
	<header class="flex flex-wrap items-end justify-between gap-4 border-b-2 border-border pb-4">
		<div>
			<p class="text-sm font-bold tracking-widest uppercase">Live results</p>
			<h1 class="font-display text-5xl leading-[0.85] font-black uppercase md:text-8xl">{res.event}</h1>
		</div>
		<div class="text-right">
			<p class="flex items-center justify-end gap-2 text-xl font-bold uppercase" role="status">
				<span class="inline-block size-4 border-2 border-border" style="background:{connected ? 'var(--start)' : 'var(--finish)'}"></span>
				{connected ? 'Live' : 'Reconnecting…'}
			</p>
			<p class="text-lg text-muted-foreground">{agoText}</p>
		</div>
	</header>

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<div class="flex flex-wrap gap-2" role="tablist" aria-label="Categories">
			{#each res.categories as c (c.id)}
				<button
					role="tab"
					aria-selected={c.id === cat?.id}
					onclick={() => pick(c.id)}
					class="h-12 border-2 border-border px-4 text-lg font-bold uppercase {c.id === cat?.id ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}"
				>
					{c.name} <span class="opacity-70">{c.rows.length}</span>
				</button>
			{/each}
		</div>
		{#if !data.kiosk}
			<div class="ml-auto flex flex-wrap gap-2">
				<div class="flex" role="group" aria-label="Show">
					{#each [['results', 'Results'], ['awards', 'Awards'], ['progress', 'Progress'], ...(data.hasRoute ? [['map', 'Map']] : [])] as [v, label]}
						<button
							aria-pressed={view === v}
							onclick={() => (view = v as typeof view)}
							class="h-12 border-2 border-border px-4 font-bold uppercase {view === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}"
							>{label}</button
						>
					{/each}
				</div>
				<button
					aria-pressed={auto}
					onclick={() => (auto = !auto)}
					class="h-12 border-2 border-border px-4 font-bold uppercase {auto ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}"
					>Auto-cycle {auto ? `on · ${remaining}s` : 'off'}</button
				>
				<label class="flex h-12 items-center gap-2 border-2 border-border bg-card px-3 font-bold uppercase">
					Switch every
					<select bind:value={cycleSec} class="h-8 border-2 border-border bg-card px-1 font-bold" aria-label="Seconds per category">
						{#each CYCLE_CHOICES as s}<option value={s}>{s}s</option>{/each}
					</select>
				</label>
				<a href="?kiosk&mode={mode}&cycle={cycleSec}&view={view}" class="flex h-12 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent">Big screen</a>
			</div>
		{:else}
			<p class="ml-auto font-bold uppercase">{view === 'awards' ? 'Awards' : view === 'progress' ? 'Progress' : view === 'map' ? 'Map' : 'Results'}{auto && nextName ? ` · next: ${nextName} in ${remaining}s` : ''}</p>
		{/if}
	</div>

	<main class="mt-4 border-2 border-border bg-card">
		{#if view === 'map' && data.hasRoute}
			<!-- the full route map, for showing the course and the checkpoints live -->
			<div class="relative h-[calc(100vh-2rem)] min-h-[600px]"><RouteMap slug={data.slug} category={cat?.id ?? null} /></div>
		{:else if !cat}
			<p class="p-10 text-2xl text-muted-foreground">No participants registered for this event yet.</p>
		{:else}
			<div class="relative flex items-center justify-between bg-primary px-4 py-2 text-primary-foreground">
				{#if auto}
					<div class="countdown absolute bottom-0 left-0 h-1.5 bg-primary-foreground" style="width:{(remaining / cycleSec) * 100}%" aria-hidden="true"></div>
				{/if}
				<h2 class="font-display text-4xl font-black uppercase md:text-6xl">{cat.name}</h2>
				<div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
					{#if clockMs !== null}<span class="font-display text-4xl leading-none font-black tabular-nums md:text-6xl" title="Race clock, from the gun start">{fmt(clockMs)}</span>{/if}
					<p class="text-lg font-bold tracking-wide uppercase">{cat.rows.length} finished{cat.held ? ` (+${cat.held} being verified)` : ''} · {cat.started} started · {cat.total} registered</p>
				</div>
			</div>
			<p class="border-b-2 border-border/15 bg-card px-4 py-2 text-lg">
				<span class="font-bold tracking-wide uppercase">Ranked by:</span>
				{cat.rankBy === 'finish' ? 'first across the finish line (clock time)' : cat.rankBy === 'chip' || mode === 'own' ? "shortest time from each runner's own start read" : 'shortest time from the category or batch start'}
			</p>
			{#if cat.noStart}
				<p class="border-b-2 border-border/15 bg-card px-4 py-2 text-lg font-bold text-destructive" role="alert">
					{cat.noStart} {cat.noStart === 1 ? 'runner has' : 'runners have'} crossed the finish but {cat.noStart === 1 ? 'has' : 'have'} no start time — press Start for this category, or add their start read on the Reads page.
				</p>
			{/if}
			{#if view === 'awards' && res.awardsHidden}
				<div class="p-10">
					<p class="font-display text-5xl leading-[0.85] font-black uppercase md:text-7xl">Awards coming soon</p>
					<p class="mt-3 text-2xl text-muted-foreground">The winners will be announced at the ceremony. Results are on the Results view.</p>
				</div>
			{:else if view === 'awards'}
				<div class="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
					{#each cat.awards as a (a.key)}
						<section class="border-2 border-border">
							<h3 class="bg-primary px-3 py-1 font-display text-3xl font-black text-primary-foreground uppercase md:text-4xl">{a.name}</h3>
							<ol>
								{#each a.winners as w (w.bib)}
									<li animate:flip={slide} class="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b-2 border-border/15 px-3 py-2 last:border-b-0 md:grid-cols-[3.5rem_1fr_auto]">
										<span class="font-display text-5xl leading-[0.85] font-black">{w.place}</span>
										<span class="flex min-w-0 items-center gap-2">
											{@render face(w.photo, w.bib, 'size-10 md:size-14')}
											<span class="truncate text-xl font-bold uppercase md:text-2xl">{w.name || 'Bib ' + w.bib}<span class="ml-2 font-normal text-muted-foreground">#{w.bib}{w.detail ? ` · ${w.detail}` : ''}</span></span>
											{#if w.place <= 3}{@render medal(w.place, 'size-6 md:size-8')}{/if}
										</span>
										<span class="font-display text-3xl leading-[0.85] font-black md:text-4xl">{fmt(w.time)}</span>
									</li>
								{/each}
							</ol>
						</section>
					{:else}
						<p class="p-6 text-2xl text-muted-foreground md:col-span-2 xl:col-span-3">No finishers yet in {cat.name}, so no awards to show.</p>
					{/each}
				</div>
			{:else if view === 'progress'}
				{#if catBatches.length && !data.kiosk}
					<div class="flex flex-wrap gap-2 border-b-2 border-border/15 px-4 py-3" role="tablist" aria-label="Batch">
						{#each [['all', 'All batches'], ...catBatches.map((b) => [b.id, b.name]), ['none', 'No batch']] as [id, label]}
							<button type="button" role="tab" aria-selected={id === batchSel} onclick={() => (batchSel = id as typeof batchSel)} class="h-11 border-2 border-border px-4 text-lg font-bold uppercase {id === batchSel ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">{label}</button>
						{/each}
					</div>
				{/if}
				{#if data.routeCats.includes(cat.id)}
					<!-- the route map sits beside the table; its pins count who has passed each checkpoint, live -->
					<div class="grid xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						{#key batchSel}<ProgressTable course={cat.course} rows={progRows} big={data.kiosk} />{/key}
						<div class="relative h-[70vh] min-h-[520px] border-t-2 border-border xl:sticky xl:top-0 xl:order-first xl:h-[max(460px,calc(100vh-19.5rem))] xl:border-t-0 xl:border-r-2"><RouteMap slug={data.slug} category={cat.id} compact /></div>
					</div>
				{:else}
					{#key batchSel}<ProgressTable course={cat.course} rows={progRows} big={data.kiosk} />{/key}
				{/if}
			{:else}
			{#key cat.id}
			<ol>
				{#each cat.rows as r (r.bib)}
					{@const key = `${cat.id}:${r.bib}`}
					<!-- the first `places` rows (the prizes this category awards) are large; the rest are smaller -->
					{@const big = r.rank! <= cat.places}
					<li animate:flip={slide} in:fly|local={enter} class="border-b-2 border-border/15 last:border-b-0 {fresh.has(key) ? 'fresh' : ''}">
						<button
							class="grid w-full items-center text-left {big ? 'grid-cols-[2.5rem_4rem_1fr_auto] gap-2 px-3 py-2 md:grid-cols-[8rem_10rem_1fr_auto] md:gap-6' : 'grid-cols-[2rem_3rem_1fr_auto] gap-2 px-3 py-1 md:grid-cols-[5rem_6.5rem_1fr_auto] md:gap-5'}"
							onclick={() => toggle(key)}
							aria-expanded={open.has(key)}
						>
							<span class="font-display leading-[0.85] font-black {big ? 'text-4xl md:text-8xl' : 'text-2xl md:text-5xl'}">{r.rank}</span>
							<span class="font-display leading-[0.85] font-black {big ? 'text-3xl md:text-7xl' : 'text-xl md:text-4xl'}">{r.bib}</span>
							<span class="flex min-w-0 items-center gap-2 md:gap-4">
								{#if big}{@render face(r.photo, r.bib, 'size-12 md:size-20')}{/if}
								<span class="truncate font-bold uppercase {big ? 'text-lg md:text-5xl' : 'text-base md:text-3xl'}">{r.name || 'Bib ' + r.bib}</span>
								{#if big && r.rank! <= 3}{@render medal(r.rank!, 'size-6 md:size-14')}{/if}
							</span>
							<span class="font-display leading-[0.85] font-black {big ? 'text-4xl md:text-8xl' : 'text-2xl md:text-5xl'}">{fmt(r.time!)}</span>
						</button>
						{#if open.has(key)}
							<p class="px-4 pb-3 text-xl md:pl-[10.5rem]">
								{#each r.splits as sp}<span class="mr-6 font-bold uppercase">{sp.station} <span class="font-normal">{fmt(sp.elapsed)}</span></span>{:else}<span class="text-muted-foreground">No checkpoint splits.</span>{/each}
							</p>
						{/if}
					</li>
				{:else}
					<li class="p-10 text-2xl text-muted-foreground">{cat.held ? `${cat.held} finisher${cat.held === 1 ? '' : 's'} in ${cat.name}: results are being verified.` : `No finishers yet in ${cat.name}.`} {cat.started} runner{cat.started === 1 ? '' : 's'} on course.</li>
				{/each}
			</ol>
			{/key}
			{/if}
		{/if}
	</main>
</div>

<style>
	.countdown {
		transition: width 1s linear;
	}
	.fresh {
		animation: flash 2.4s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes flash {
		from {
			background: var(--fresh);
		}
		to {
			background: transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.countdown {
			transition: none;
		}
		.fresh {
			animation: none;
			background: var(--fresh);
		}
	}
</style>
