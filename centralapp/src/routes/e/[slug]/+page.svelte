<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import Trophy from '@lucide/svelte/icons/trophy';
	import RouteMap from '$lib/components/RouteMap.svelte';
	import ProgressTable from '$lib/components/ProgressTable.svelte';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { fmt, type Cat, type Mode } from '$lib/results';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { deserialize } from '$app/forms';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { StartCat, StartRunner } from '$lib/server/batches';

	let { data } = $props();

	type Payload = { event: string; mode: Mode; serverMs: number; lastReadAgoMs: number | null; awardsHidden?: boolean; batches: { id: number; name: string; category_id: number }[]; batchOf: Record<string, number>; categories: Cat[] };

	let res = $state<Payload>(data.initial);
	let mode = $state<Mode>(data.initial.mode);
	// ?cat=<id>&batch=<id|none> keep the picked category and batch across a reload
	const urlCat = Number(page.url.searchParams.get('cat'));
	let active = $state(data.initial.categories.some((c) => c.id === urlCat) ? urlCat : (data.initial.categories[0]?.id ?? -1));
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
	let view = $state<'results' | 'awards' | 'progress' | 'map' | 'start'>(data.view); // what the board shows for the selected category

	const cat = $derived(res.categories.find((c) => c.id === active) ?? res.categories[0]);
	// race clock: the server's start time against the server's clock (this browser's own clock may be off)
	const clockMs = $derived(mode === 'gun' && cat?.gunManual && cat.gunMs ? Math.max(0, now + (res.serverMs - fetchedAt) - cat.gunMs) : null);
	const ago = $derived(res.lastReadAgoMs === null ? null : res.lastReadAgoMs + (now - fetchedAt));
	const agoText = $derived(
		ago === null ? 'No reads yet' : ago < 60000 ? `Last read ${Math.floor(ago / 1000)}s ago` : `Last read ${Math.floor(ago / 60000)} min ago`
	);

	// Progress view: the shown category's runners, narrowed to one batch when picked
	const urlBatch = page.url.searchParams.get('batch');
	let batchSel = $state<'all' | 'none' | number>(urlBatch === 'none' ? 'none' : urlBatch && Number.isInteger(Number(urlBatch)) ? Number(urlBatch) : 'all');
	const catBatches = $derived(res.batches.filter((b) => b.category_id === cat?.id));
	const progRows = $derived.by(() => {
		const rows = cat?.progress ?? [];
		if (batchSel === 'all' || !catBatches.length) return rows;
		return rows.filter((r) => (res.batchOf[r.bib] ?? null) === (batchSel === 'none' ? null : batchSel));
	});
	// with All batches picked, a Batch column says which batch each runner is in
	const batchCol = $derived(batchSel === 'all' && catBatches.length ? (bib: string) => catBatches.find((b) => b.id === res.batchOf[bib])?.name ?? null : undefined);

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

	let latest = 0; // two refreshes close together can answer out of order: only the newest one may land
	async function refresh() {
		void refreshStarts();
		const mine = ++latest;
		try {
			const r = await fetch(`/e/${data.slug}/results?mode=${mode}`);
			if (!r.ok || mine !== latest) return;
			const p: Payload = await r.json();
			if (mine !== latest) return;
			track(p);
			res = p;
			fetchedAt = Date.now();
		} catch {
			/* connection state shows the problem */
		}
	}

	// the address follows what is shown, so a reload (or a restarted big screen) comes back to the same place
	$effect(() => {
		const [cat, v, b] = [active, view, batchSel]; // the only things this follows; reading the address here would loop
		untrack(() => {
			const u = new URL(location.href);
			u.searchParams.set('cat', String(cat));
			u.searchParams.set('view', v);
			if (b === 'all') u.searchParams.delete('batch');
			else u.searchParams.set('batch', String(b));
			if (u.search !== location.search) void goto(u, { shallow: true, replace: true });
		});
	});

	// ---- Start view: roll random runners of a category into the next batch, then start it (organizer only) ----
	type Starts = { size: number; serverMs: number; categories: StartCat[] };
	let starts = $state<Starts | null>(data.starts);
	let startsAt = $state(Date.now());
	let latestStarts = 0;
	async function refreshStarts() {
		const mine = ++latestStarts;
		try {
			const r = await fetch(`/e/${data.slug}/starts`);
			const next = r.ok ? await r.json() : null; // 404 = the organizer turned the Start menu off
			if (mine !== latestStarts) return;
			starts = next;
			startsAt = Date.now();
			if (!starts && view === 'start') view = 'results';
		} catch {
			/* connection state shows the problem */
		}
	}
	const sc = $derived(starts?.categories.find((c) => c.id === cat?.id));
	let perGender = $state(false);
	const genderName = { M: 'Men', F: 'Women' } as const;
	const batchGender = (ms: StartRunner[]) => (ms.length && ms.every((m) => m.gender === ms[0].gender) && ms[0].gender in genderName ? genderName[ms[0].gender as 'M' | 'F'] : '');
	const poolOf = (c: StartCat, g: 'M' | 'F' | null) => c.free.filter((p) => !g || p.gender === g);
	const sinceStart = (gun: number) => fmt(Math.max(0, now + ((starts?.serverMs ?? 0) - startsAt) - gun));

	async function act(name: string, fields: Record<string, string>) {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		const r = await fetch(`?/${name}`, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
		const res = deserialize(await r.text());
		if (res.type !== 'success') throw new Error((res.type === 'failure' && (res.data as { error?: string })?.error) || 'Something went wrong. Try again.');
		return res.data;
	}

	// the roll dialog: N empty boxes, then each box spins and lands one at a time on the runner the server drew
	type Roll = { cat: StartCat; gender: 'M' | 'F' | null; boxes: { shown: StartRunner | null; landed: boolean }[]; phase: 'ready' | 'rolling' | 'done'; err: string; batch: { id: number; name: string } | null };
	let roll = $state<Roll | null>(null);
	let rollRun = 0; // closing the dialog stops a spin that is still going
	function openRoll(c: StartCat, gender: 'M' | 'F' | null) {
		const n = Math.min(starts?.size ?? 5, poolOf(c, gender).length);
		roll = { cat: c, gender, boxes: Array.from({ length: n }, () => ({ shown: null, landed: false })), phase: 'ready', err: '', batch: null };
	}
	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
	async function runRoll() {
		if (!roll || roll.phase !== 'ready') return;
		const run = ++rollRun;
		roll.phase = 'rolling';
		roll.err = '';
		let got: { batch: { id: number; name: string }; picks: StartRunner[] };
		try {
			got = (await act('roll', { category: String(roll.cat.id), ...(roll.gender ? { gender: roll.gender } : {}) })) as typeof got;
		} catch (err) {
			roll.phase = 'ready';
			roll.err = err instanceof Error ? err.message : 'Could not roll.';
			return;
		}
		// someone else may have rolled meanwhile: show as many boxes as the server actually drew
		roll.boxes = got.picks.map(() => ({ shown: null, landed: false }));
		roll.batch = got.batch;
		const pool = poolOf(roll.cat, roll.gender);
		const spinMs = reduceMotion ? 0 : 2200;
		for (let i = 0; i < got.picks.length; i++) {
			const t0 = Date.now();
			while (Date.now() - t0 < spinMs) {
				if (run !== rollRun || !roll) return;
				roll.boxes[i].shown = pool[Math.floor(Math.random() * pool.length)] ?? null; // display only; the draw is the server's
				const k = (Date.now() - t0) / spinMs;
				await wait(45 + 260 * k * k); // slows down before it lands
			}
			if (run !== rollRun || !roll) return;
			roll.boxes[i] = { shown: got.picks[i], landed: true };
			await wait(reduceMotion ? 150 : 600);
		}
		if (run === rollRun && roll) roll.phase = 'done';
		void refreshStarts();
	}
	function closeRoll() {
		rollRun++;
		roll = null;
	}

	// a batch card opens its runner list with the Start button
	let batchOpen = $state<number | null>(null);
	const openBatch = $derived(sc?.batches.find((b) => b.id === batchOpen) ?? null);
	let startErr = $state('');
	let starting = $state(false);
	async function startNow(id: number) {
		starting = true;
		startErr = '';
		try {
			await act('start', { id: String(id) });
			await refreshStarts();
		} catch (err) {
			startErr = err instanceof Error ? err.message : 'Could not start.';
		} finally {
			starting = false;
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
					{#each [['results', 'Results'], ['awards', 'Awards'], ['progress', 'Progress'], ...(data.hasRoute ? [['map', 'Map']] : []), ...(starts ? [['start', 'Start']] : [])] as [v, label]}
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
				<a href="/e/{data.slug}/wall" class="flex h-12 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent">Finish wall</a>
				<a href="?kiosk&mode={mode}&cycle={cycleSec}&view={view}" class="flex h-12 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent">Big screen</a>
			</div>
		{:else}
			<p class="ml-auto font-bold uppercase">{view === 'awards' ? 'Awards' : view === 'progress' ? 'Progress' : view === 'map' ? 'Map' : view === 'start' ? 'Start' : 'Results'}{auto && nextName ? ` · next: ${nextName} in ${remaining}s` : ''}</p>
		{/if}
	</div>

	<main class="mt-4 border-2 border-border bg-card">
		{#if view === 'map' && data.hasRoute}
			<!-- the full route map, for showing the course and the checkpoints live -->
			<div class="relative h-[calc(100vh-2rem)] min-h-[600px]"><RouteMap slug={data.slug} category={cat?.id ?? null} /></div>
		{:else if view === 'start' && sc}
			<!-- START: roll runners into the next batch, then start each batch from its card -->
			<div class="flex flex-wrap items-center justify-between gap-3 bg-primary px-4 py-2 text-primary-foreground">
				<h2 class="font-display text-4xl font-black uppercase md:text-6xl">{sc.name} start</h2>
				<p class="text-lg font-bold tracking-wide uppercase">{sc.freeCount} not yet in a batch · {sc.batches.length} batch{sc.batches.length === 1 ? '' : 'es'}</p>
			</div>
			{#if data.admin}
				<div class="flex flex-wrap items-center gap-3 border-b-2 border-border/15 px-4 py-3">
					<label class="flex h-12 items-center gap-2 border-2 border-border px-3 font-bold uppercase"><input type="checkbox" bind:checked={perGender} class="size-5" /> Roll per gender</label>
					{#each perGender ? (['M', 'F'] as const) : [null] as g}
						{@const n = poolOf(sc, g).length}
						<button type="button" disabled={!n} onclick={() => openRoll(sc, g)} class="h-12 border-2 border-border bg-primary px-5 text-lg font-bold text-primary-foreground uppercase disabled:opacity-40">
							Roll {g ? genderName[g] : 'runners'} <span class="opacity-70">({n} left)</span>
						</button>
					{/each}
					{#if perGender && sc.free.some((p) => !p.gender)}<p class="text-muted-foreground">{sc.free.filter((p) => !p.gender).length} runner(s) have no gender and are only rolled with Roll per gender off.</p>{/if}
				</div>
			{/if}
			<ul class="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each sc.batches as b (b.id)}
					{@const g = batchGender(b.members)}
					<li>
						<button type="button" onclick={() => ((batchOpen = b.id), (startErr = ''))} class="flex h-full w-full flex-col gap-1 border-2 border-border bg-card p-3 text-left hover:bg-accent">
							<span class="flex items-baseline justify-between gap-2">
								<span class="font-display text-4xl leading-none font-black uppercase">Batch {b.name}</span>
								<span class="border-2 border-border px-2 py-0.5 text-sm font-bold uppercase {b.gun_ms ? 'bg-primary text-primary-foreground' : ''}">{b.gun_ms ? 'Started' : 'Waiting'}</span>
							</span>
							<span class="font-bold uppercase">{b.members.length} runner{b.members.length === 1 ? '' : 's'}{g ? ` · ${g}` : ''}</span>
							{#if b.gun_ms}
								<span class="font-display text-3xl leading-none font-black tabular-nums">{sinceStart(b.gun_ms)}</span>
								<span class="font-bold uppercase">Started at {new Date(b.gun_ms).toLocaleTimeString()}</span>
							{/if}
							<span class="font-display text-2xl leading-tight font-black break-words text-start">{b.members.map((m) => m.bib).join(', ')}</span>
						</button>
					</li>
				{:else}
					<li class="col-span-full p-6 text-2xl text-muted-foreground">No batches yet in {sc.name}.{data.admin ? ' Press Roll to draw the first one.' : ''}</li>
				{/each}
			</ul>
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
				{#if cat.provisional && cat.rows.length}<span class="block font-bold">Finish times shown batch by batch. Places are final once every batch is released.</span>{/if}
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
						{#key batchSel}<ProgressTable course={cat.course} rows={progRows} big={data.kiosk} batchOf={batchCol} />{/key}
						<div class="relative h-[70vh] min-h-[520px] border-t-2 border-border xl:sticky xl:top-0 xl:order-first xl:h-[max(460px,calc(100vh-19.5rem))] xl:border-t-0 xl:border-r-2"><RouteMap slug={data.slug} category={cat.id} compact /></div>
					</div>
				{:else}
					{#key batchSel}<ProgressTable course={cat.course} rows={progRows} big={data.kiosk} batchOf={batchCol} />{/key}
				{/if}
			{:else}
			{#key cat.id}
			<ol>
				{#each cat.rows as r (r.bib)}
					{@const key = `${cat.id}:${r.bib}`}
					<!-- the first `places` rows (the prizes this category awards) are large; the rest are smaller -->
					{@const big = r.rank !== null && r.rank <= cat.places}
					<li animate:flip={slide} in:fly|local={enter} class="border-b-2 border-border/15 last:border-b-0 {fresh.has(key) ? 'fresh' : ''}">
						<button
							class="grid w-full items-center text-left {big ? 'grid-cols-[2.5rem_4rem_1fr_auto] gap-2 px-3 py-2 md:grid-cols-[8rem_10rem_1fr_auto] md:gap-6' : 'grid-cols-[2rem_3rem_1fr_auto] gap-2 px-3 py-1 md:grid-cols-[5rem_6.5rem_1fr_auto] md:gap-5'}"
							onclick={() => toggle(key)}
							aria-expanded={open.has(key)}
						>
							<span class="font-display leading-[0.85] font-black {big ? 'text-4xl md:text-8xl' : 'text-2xl md:text-5xl'}">{r.rank ?? '–'}</span>
							<span class="font-display leading-[0.85] font-black {big ? 'text-3xl md:text-7xl' : 'text-xl md:text-4xl'}">{r.bib}</span>
							<span class="flex min-w-0 items-center gap-2 md:gap-4">
								{#if big}{@render face(r.photo, r.bib, 'size-12 md:size-20')}{/if}
								<span class="min-w-0 truncate font-bold uppercase {big ? 'text-lg md:text-5xl' : 'text-base md:text-3xl'}">{r.name || 'Bib ' + r.bib}{#if r.members}<span class="block truncate text-sm font-normal normal-case md:text-2xl" data-testid="team-runners">{r.members.map((m) => m.name).join(', ')}</span>{/if}</span>
								{#if big && r.rank !== null && r.rank <= 3}{@render medal(r.rank!, 'size-6 md:size-14')}{/if}
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

<Dialog.Root open={roll !== null} onOpenChange={(o) => !o && closeRoll()}>
	{#if roll}
		<Dialog.Content class="max-h-[95vh] overflow-y-auto border-2 border-border sm:max-w-5xl" interactOutsideBehavior={roll.phase === 'rolling' ? 'ignore' : 'close'}>
			<Dialog.Header>
				<Dialog.Title class="font-display text-5xl leading-[0.85] font-black uppercase md:text-7xl">
					{roll.batch ? `Batch ${roll.batch.name}` : 'Roll'} · {roll.cat.name}{roll.gender ? ` · ${genderName[roll.gender]}` : ''}
				</Dialog.Title>
				<Dialog.Description class="text-lg">{roll.phase === 'done' ? `${roll.boxes.length} runner${roll.boxes.length === 1 ? '' : 's'} drawn. The batch is ready to start.` : `${roll.boxes.length} runner${roll.boxes.length === 1 ? '' : 's'} will be drawn at random, one at a time.`}</Dialog.Description>
			</Dialog.Header>
			<ol class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5" aria-live="polite">
				{#each roll.boxes as box, i}
					<li class="flex min-h-36 flex-col items-center justify-center gap-1 border-4 border-border p-3 text-center {box.landed ? 'landed bg-primary text-primary-foreground' : box.shown ? 'bg-accent' : 'bg-card'}">
						<span class="text-sm font-bold uppercase opacity-70">Box {i + 1}</span>
						{#if box.shown}
							<span class="font-display text-6xl leading-none font-black tabular-nums">{box.shown.bib}</span>
							<span class="line-clamp-2 font-bold uppercase">{box.shown.name}</span>
						{:else}
							<span class="font-display text-6xl leading-none font-black opacity-30">?</span>
						{/if}
					</li>
				{/each}
			</ol>
			{#if roll.err}<p class="font-bold text-destructive" role="alert">{roll.err}</p>{/if}
			<div class="flex flex-wrap gap-2">
				{#if roll.phase === 'ready'}
					<button type="button" onclick={runRoll} class="h-14 border-2 border-border bg-primary px-8 text-2xl font-bold text-primary-foreground uppercase">Start roll</button>
				{:else if roll.phase === 'rolling'}
					<p class="h-14 content-center text-2xl font-bold uppercase">Rolling…</p>
				{:else}
					{@const done = roll.batch}
					<button type="button" onclick={() => { closeRoll(); batchOpen = done?.id ?? null; startErr = ''; }} class="h-14 border-2 border-border bg-primary px-8 text-2xl font-bold text-primary-foreground uppercase">Open batch</button>
					<button type="button" onclick={closeRoll} class="h-14 border-2 border-border bg-card px-8 text-2xl font-bold uppercase">Close</button>
				{/if}
			</div>
		</Dialog.Content>
	{/if}
</Dialog.Root>

<Dialog.Root open={openBatch !== null} onOpenChange={(o) => !o && (batchOpen = null)}>
	{#if openBatch && sc}
		{@const g = batchGender(openBatch.members)}
		<Dialog.Content class="max-h-[95vh] overflow-y-auto border-2 border-border sm:max-w-3xl">
			<Dialog.Header>
				<Dialog.Title class="font-display text-5xl leading-[0.85] font-black uppercase md:text-6xl">{sc.name} · Batch {openBatch.name}{g ? ` · ${g}` : ''}</Dialog.Title>
				<Dialog.Description class="text-lg">
					{#if openBatch.gun_ms}Started at {new Date(openBatch.gun_ms).toLocaleTimeString()} · <b class="tabular-nums">{sinceStart(openBatch.gun_ms)}</b>{:else}{openBatch.members.length} runner{openBatch.members.length === 1 ? '' : 's'}, waiting for the start.{/if}
				</Dialog.Description>
			</Dialog.Header>
			<ol class="grid gap-1 sm:grid-cols-2">
				{#each openBatch.members as m (m.bib)}
					<li class="flex items-baseline gap-3 border-b-2 border-border/15 py-1.5"><span class="w-20 font-display text-3xl leading-none font-black">{m.bib}</span><span class="text-lg font-bold uppercase">{m.name}</span></li>
				{/each}
			</ol>
			{#if startErr}<p class="font-bold text-destructive" role="alert">{startErr}</p>{/if}
			{#if data.admin && !openBatch.gun_ms}
				{@const id = openBatch.id}
				<button type="button" disabled={starting} onclick={() => startNow(id)} class="h-16 border-2 border-border bg-primary px-8 text-3xl font-bold text-primary-foreground uppercase disabled:opacity-50">{starting ? 'Starting…' : 'Start race'}</button>
			{/if}
		</Dialog.Content>
	{/if}
</Dialog.Root>

<style>
	.landed {
		animation: land 0.45s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes land {
		from {
			transform: scale(1.12);
		}
		to {
			transform: scale(1);
		}
	}
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
		.landed {
			animation: none;
		}
		.countdown {
			transition: none;
		}
		.fresh {
			animation: none;
			background: var(--fresh);
		}
	}
</style>
