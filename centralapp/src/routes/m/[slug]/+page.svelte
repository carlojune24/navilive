<script lang="ts">
	// Marshal tagging: a phone at a checkpoint taps runners as they arrive. Taps become ordinary reads
	// through the normal upload endpoint, so results, splits and the board need no special case.
	// shortcut: auth is the event's own API key, the same one the station laptops hold, so there is no
	// per-marshal revocation — rotating the key cuts off the laptops too. Add marshal keys if that bites.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { applyLocal, batchState, gunsOf, lastThrough, newlyStarted, runnerState, seenBy, taggedCount, type Batch, type Person, type Tag } from '$lib/marshal';
	import { hms, phTime } from '$lib/time';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	type Station = { id: number; name: string; kind: string; ord: number };
	type Category = { id: number; name: string; gun_ms: number | null };
	type Course = { category_id: number; station_id: number };
	type Board = { serverMs: number; stations: Station[]; categories: Category[]; batches: Batch[]; participants: Person[]; tagged: Tag[]; courses: Course[] };
	type Queued = { bib: string; tag: string; read_at_ms: number; station: string; voided: boolean; by?: string };

	const slug = page.params.slug;
	const K_KEY = `nv.m.key.${slug}`;
	const K_STATION = `nv.m.station.${slug}`;
	const K_QUEUE = `nv.m.q.${slug}`;
	const K_DEVICE = 'nv.m.device';
	const K_NAME = 'nv.m.name';
	const K_SOUND = `nv.m.sound.${slug}`;
	const K_MINE = `nv.m.mine.${slug}`;

	let key = $state('');
	let keyInput = $state('');
	let err = $state('');
	let board = $state<Board | null>(null);
	let stationId = $state<number | null>(null);
	let offset = $state(0); // server clock minus this device's clock; every tap is stamped with it
	let queue = $state<Queued[]>([]); // taps the server has not confirmed yet
	let mine = $state<Record<string, Queued>>({}); // what this device tagged, for instant feedback and undo
	let online = $state(true);
	let catSel = $state<number | null>(null);
	let batchSel = $state<'none' | number | null>(null);
	let qText = $state('');
	let sound = $state(true);
	let announced = $state<number[]>([]); // batches whose gun fired while this page was open
	let now = $state(Date.now());
	let prevGuns: Map<number, number | null> | null = null; // null until the first poll lands
	let deviceId = '';
	let name = $state(''); // the marshal's full name; it rides on every tap as the read's device id
	let nameInput = $state('');

	const station = $derived(board?.stations.find((s) => s.id === stationId) ?? null);
	const course = $derived(board?.stations.map((s) => s.id) ?? []); // the default: every station, in order
	// a category with its own course skips stations, so its runners must not read as missed at one
	const courseOf = $derived.by(() => {
		const m = new Map<number, number[]>();
		for (const r of board?.courses ?? []) {
			let ids = m.get(r.category_id);
			if (!ids) m.set(r.category_id, (ids = []));
			ids.push(r.station_id);
		}
		return m;
	});
	const cats = $derived(board?.categories ?? []);
	const catShown = $derived(cats.find((c) => c.id === catSel) ?? cats[0] ?? null);
	const batches = $derived(board?.batches.filter((b) => b.category_id === catShown?.id) ?? []);
	const batchShown = $derived<Batch | 'none'>(batchSel === 'none' ? 'none' : (batches.find((b) => b.id === batchSel) ?? batches[0] ?? 'none'));

	// the board's reads plus this device's own taps, so the UI never waits for the next poll
	const seen = $derived.by(() => {
		const m = seenBy(board?.tagged ?? []);
		if (stationId === null) return m;
		return applyLocal(m, Object.values(mine), stationId, station?.name ?? '');
	});

	const inCat = $derived(board?.participants.filter((p) => p.category_id === catShown?.id) ?? []);
	const membersOf = (b: Batch) => inCat.filter((p) => p.batch_id === b.id);
	const loose = $derived(inCat.filter((p) => !p.batch_id));

	const stateOf = (p: Person) =>
		stationId === null ? 'waiting' : runnerState(p.bib, seen, stationId, (p.category_id !== null ? courseOf.get(p.category_id) : null) ?? course);
	// one entry per runner per station: the same bib may be tagged at several stations from this device
	const mineKey = (p: Person) => `${station?.name ?? ''}|${p.bib}`;
	const rows = $derived.by(() => {
		const needle = qText.trim().toLowerCase();
		// a search spans the whole event: at a checkpoint you look up the bib in front of you, not a tab
		const base = needle
			? (board?.participants ?? []).filter((p) => p.bib.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
			: batchShown === 'none'
				? loose
				: membersOf(batchShown);
		// always by bib: a tap must never move the other cards, or the next tap lands on the wrong runner
		return [...base].sort((a, b) => a.bib.localeCompare(b.bib, undefined, { numeric: true }));
	});
	const doneHere = $derived(stationId === null ? 0 : taggedCount(rows, seen, stationId));

	// a gun banner stays up until the marshal dismisses it: once the whole batch is through here it
	// turns into a done notice rather than vanishing, so nobody is left wondering if the wave passed
	const alerts = $derived.by(() => {
		const bd = board;
		const st = stationId;
		if (!bd || st === null) return [];
		return announced.flatMap((id) => {
			const b = bd.batches.find((x) => x.id === id);
			if (!b || b.gun_ms === null || b.gun_ms === undefined) return []; // start retracted: the notice goes with it
			const members = bd.participants.filter((p) => p.batch_id === b.id);
			const done = batchState(b, members, seen, st) === 'done';
			return [{ b, cat: bd.categories.find((c) => c.id === b.category_id)?.name ?? '', done, n: members.length, last: done ? lastThrough(members, seen, st) : null }];
		});
	});

	function toggleSound() {
		sound = !sound;
		localStorage.setItem(K_SOUND, sound ? '1' : '0');
		if (sound) alarm(); // confirms out loud exactly what a gun start will sound like
	}

	// crypto.randomUUID() needs a secure context and marshals are on plain http over the venue LAN,
	// where it is undefined. getRandomValues has no such restriction.
	const newDeviceId = () => {
		const b = new Uint8Array(4);
		crypto.getRandomValues(b);
		return [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
	};

	// shortcut: a phone blocks audio until the page has had a user gesture, so a gun fired before the
	// marshal has touched anything is silent; they tap the key screen or the station picker first in
	// practice, and the banner carries the message either way. Revisit only if marshals report misses.
	let audio: AudioContext | null = null;
	/** Five alternating pulses over ~2.5s: one blip is lost in the noise at a checkpoint. */
	function alarm() {
		try {
			audio ??= new AudioContext();
			void audio.resume();
			const t0 = audio.currentTime;
			for (let i = 0; i < 5; i++) {
				const at = t0 + i * 0.5;
				const o = audio.createOscillator();
				const g = audio.createGain();
				o.frequency.value = i % 2 ? 660 : 990;
				g.gain.setValueAtTime(0.0001, at);
				g.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
				o.connect(g).connect(audio.destination);
				o.start(at);
				o.stop(at + 0.45);
			}
		} catch {
			/* audio unavailable */
		}
	}

	// shortcut: `mine` is kept for the whole event so Undo always works, and is re-serialised on every
	// tap. Past a few thousand taps on one phone, write the entries individually instead.
	const save = () => {
		localStorage.setItem(K_QUEUE, JSON.stringify(queue));
		localStorage.setItem(K_MINE, JSON.stringify(mine));
	};
	const clock = phTime;

	function pickStation(id: number) {
		stationId = id;
		if (sound) void audio?.resume();
		localStorage.setItem(K_STATION, String(id));
	}

	function tap(p: Person) {
		if (!station) return;
		// the device's own corrected clock, captured now: a tap that syncs an hour late keeps this time
		const qd: Queued = { bib: p.bib, tag: (p.tag || `BIB-${p.bib}`).toUpperCase(), read_at_ms: Math.round(Date.now() + offset), station: station.name, voided: false, by: name };
		mine = { ...mine, [mineKey(p)]: qd };
		queue = [...queue, qd];
		save();
		void flush();
	}

	function undo(p: Person) {
		const prev = mine[mineKey(p)];
		if (!prev || prev.voided) return;
		// the same tag+time+device re-sent as voided: the ingest upsert flips the existing row
		const qd = { ...prev, voided: true };
		mine = { ...mine, [mineKey(p)]: qd };
		queue = [...queue, qd];
		save();
		void flush();
	}

	function badKey(message: string) {
		err = message;
		key = '';
		board = null;
		localStorage.removeItem(K_KEY);
	}

	let pollSeq = 0;
	let flushing = false;
	async function flush() {
		if (flushing || !queue.length || !key) return;
		flushing = true;
		const batch = queue.slice(0, 2000); // the endpoint's own limit
		try {
			const res = await fetch(`/api/events/${slug}/reads`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
				body: JSON.stringify({ reads: batch.map((r) => ({ tag: r.tag, bib: r.bib, station: r.station, read_at_ms: r.read_at_ms, device_id: r.by || deviceId, voided: r.voided })) })
			});
			if (res.status === 401) return badKey('That link is no longer valid. Ask the organizer for a new one.');
			if (!res.ok) {
				online = false;
				return;
			}
			const out = await res.json();
			// drop only what the server counted, exactly as the station app does
			if (out.received === batch.length) {
				queue = queue.slice(batch.length);
				save();
			}
			online = true;
		} catch {
			online = false;
		} finally {
			flushing = false;
		}
	}

	async function load() {
		if (!key) return;
		const seq = ++pollSeq;
		try {
			const res = await fetch(`/api/events/${slug}/board`, { headers: { authorization: `Bearer ${key}` } });
			if (res.status === 401) return badKey('That link is no longer valid. Ask the organizer for a new one.');
			if (!res.ok) {
				online = false;
				return;
			}
			const b: Board = await res.json();
			// a slow answer that a newer poll already overtook: applying it would re-announce a gun
			// this page has handled, or hide one it has not
			if (seq !== pollSeq) return;
			offset = b.serverMs - Date.now(); // a phone with a wrong clock would otherwise stamp wrong times
			board = b;
			now = Date.now() + offset;
			const fired = newlyStarted(prevGuns, b.batches);
			prevGuns = gunsOf(b.batches);
			if (fired.length) {
				announced = [...new Set([...announced, ...fired.map((x) => x.id)])];
				if (sound) alarm(); // one alarm however many went at once
			}
			online = true;
			err = '';
		} catch {
			online = false;
		}
	}

	function saveName() {
		const n = nameInput.trim().replace(/\s+/g, ' ');
		if (n.split(' ').length < 2) return (err = 'Enter your full name, first and last.');
		name = n;
		err = '';
		localStorage.setItem(K_NAME, n);
	}

	function useKey(k: string) {
		const trimmed = k.trim();
		if (!trimmed) return;
		key = trimmed;
		localStorage.setItem(K_KEY, trimmed);
		err = '';
		void load();
	}

	onMount(() => {
		deviceId = localStorage.getItem(K_DEVICE) ?? `M-${newDeviceId()}`;
		localStorage.setItem(K_DEVICE, deviceId); // per device, so two marshals at one station never collide
		const fromUrl = page.url.searchParams.get('k');
		if (fromUrl) {
			localStorage.setItem(K_KEY, fromUrl);
			replaceState(`/m/${slug}`, {}); // keep the key out of the address bar
		}
		key = fromUrl ?? localStorage.getItem(K_KEY) ?? '';
		name = localStorage.getItem(K_NAME) ?? '';
		stationId = Number(localStorage.getItem(K_STATION)) || null;
		try {
			queue = JSON.parse(localStorage.getItem(K_QUEUE) ?? '[]');
		} catch {
			queue = [];
		}
		try {
			// the taps this device made earlier, so a reload still offers Undo on each of them
			mine = JSON.parse(localStorage.getItem(K_MINE) ?? '{}');
		} catch {
			mine = {};
		}
		sound = localStorage.getItem(K_SOUND) !== '0';
		online = navigator.onLine;
		void load();
		void flush();
		const poll = setInterval(load, 5000);
		const push = setInterval(flush, 4000);
		const tick = setInterval(() => (now = Date.now() + offset), 1000);
		const up = () => {
			online = true;
			void flush();
		};
		const down = () => (online = false);
		addEventListener('online', up);
		addEventListener('offline', down);
		return () => {
			clearInterval(poll);
			clearInterval(push);
			clearInterval(tick);
			removeEventListener('online', up);
			removeEventListener('offline', down);
		};
	});

	const tabCls = 'h-12 border-2 border-border px-4 font-bold uppercase';
	const cardCls = 'flex min-h-20 flex-col items-start justify-center border-2 border-border p-3 text-left';
</script>

<svelte:head><title>Tag runners</title></svelte:head>

<main class="min-h-dvh bg-background p-3">
	{#if err}<p class="mb-3 border-2 border-destructive p-3 font-bold text-destructive" role="alert">{err}</p>{/if}

	{#if !key}
		<!-- KEY: only shown when the link carried no key and none was stored -->
		<div class="mx-auto mt-10 max-w-md space-y-3 border-2 border-border bg-card p-4">
			<h1 class="font-display text-3xl font-black uppercase">Tag runners</h1>
			<p class="text-muted-foreground">Open the link the organizer sent you, or paste the event key below.</p>
			<Input bind:value={keyInput} placeholder="rk_..." class="h-12 border-2" aria-label="Event key" />
			<Button class="h-12 w-full font-bold uppercase" onclick={() => useKey(keyInput)}>Start</Button>
		</div>
	{:else if !board}
		<p class="mt-10 text-center text-lg font-bold uppercase">Loading…</p>
	{:else if !name}
		<!-- WHO: every tap is stamped with this name so the admin can see who tagged -->
		<div class="mx-auto mt-10 max-w-md space-y-3 border-2 border-border bg-card p-4">
			<h1 class="font-display text-3xl font-black uppercase">Who are you?</h1>
			<p class="text-muted-foreground">Enter your full name. The admin sees it on every runner you tag.</p>
			<Input bind:value={nameInput} placeholder="Full name" class="h-12 border-2" aria-label="Full name" onkeydown={(e) => e.key === 'Enter' && saveName()} />
			<Button class="h-12 w-full font-bold uppercase" onclick={saveName}>Continue</Button>
		</div>
	{:else if !station}
		<!-- STATION: remembered, so a reload goes straight back to work -->
		<div class="mx-auto max-w-2xl space-y-3">
			<h1 class="font-display text-3xl font-black uppercase">Which station are you at?</h1>
			{#if !board.stations.length}<p class="border-2 border-border bg-card p-3 font-bold">This event has no stations yet.</p>{/if}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each board.stations.filter((s) => s.kind !== 'start') as s (s.id)}
					<button type="button" onclick={() => pickStation(s.id)} class="{cardCls} bg-card">
						<span class="font-display text-2xl font-black uppercase">{s.name}</span>
						<span class="uppercase text-muted-foreground">{s.kind}</span>
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<!-- TAGGING -->
		<div class="space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-2 border-2 border-border bg-card p-3">
				<div>
					<span class="font-display text-3xl font-black uppercase">{station.name}</span>
					<span class="ml-2 uppercase text-muted-foreground">{station.kind}</span>
				</div>
				<div class="flex items-center gap-3">
					<span class="font-display text-2xl font-black" title="Philippine time">{clock(now)}</span>
					<span class="font-bold uppercase">{doneHere}/{rows.length} tagged</span>
					<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={toggleSound} aria-pressed={sound} title="Beep when a gun start fires">{sound ? 'Sound on' : 'Sound off'}</Button>
					<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (stationId = null)}>Change</Button>
				</div>
			</div>

			{#each alerts as a (a.b.id)}
				<div class="flex items-center justify-between gap-3 border-2 border-border p-3 {a.done ? 'bg-primary text-primary-foreground' : 'bg-start text-background'}" role="status">
					<span class="font-display text-2xl font-black uppercase">
						{#if a.done}
							&#10003; {a.cat} Batch {a.b.name} done &mdash; all {a.n} through {station.name}, last {clock(a.last ?? 0)}
						{:else}
							&#9679; {a.cat} Batch {a.b.name} is go &mdash; gun {clock(a.b.gun_ms ?? 0)} &middot; {hms(now - (a.b.gun_ms ?? now))}
						{/if}
					</span>
					<button type="button" aria-label="Dismiss" class="h-10 px-3 text-2xl font-black" onclick={() => (announced = announced.filter((id) => id !== a.b.id))}>&#10005;</button>
				</div>
			{/each}

			{#if !online || queue.length}
				<p class="border-2 border-border bg-accent/40 p-3 font-bold uppercase" role="status">
					{#if !online}Offline — taps are saved on this phone{:else}Sending{/if}{#if queue.length} · {queue.length} waiting{/if}
				</p>
			{/if}

			{#if cats.length > 1}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Category">
					{#each cats as c (c.id)}
						<button type="button" role="tab" aria-selected={c.id === catShown?.id} onclick={() => ((catSel = c.id), (batchSel = null), (qText = ''))} class="{tabCls} font-display text-2xl font-black {c.id === catShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">
							{c.name}{#if c.gun_ms}<span class="ml-1 text-start" title="Started">&#9679;</span>{/if}
						</button>
					{/each}
				</div>
			{/if}

			{#if batches.length}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Batch">
					{#each batches as b (b.id)}
						{@const bst = batchState(b, membersOf(b), seen, station.id)}
						{@const on = !qText && batchShown !== 'none' && b.id === batchShown.id}
						<button type="button" role="tab" aria-selected={on} onclick={() => ((batchSel = b.id), (qText = ''))} class="{tabCls} {on ? 'bg-primary text-primary-foreground' : bst === 'live' ? 'bg-start text-background' : 'bg-card'}">
							Batch {b.name}
							{#if bst === 'live'}<span class="ml-1">&#9679; Go</span>{:else if bst === 'done'}<span class="ml-1 text-muted-foreground">&#10003;</span>{/if}
						</button>
					{/each}
					<button type="button" role="tab" aria-selected={!qText && batchShown === 'none'} onclick={() => ((batchSel = 'none'), (qText = ''))} class="{tabCls} {!qText && batchShown === 'none' ? 'bg-primary text-primary-foreground' : 'bg-card'}">No batch ({loose.length})</button>
				</div>
			{/if}

			<Input bind:value={qText} placeholder="Search any bib or name" class="h-12 border-2" aria-label="Search runners" />

			{#if !rows.length}
				<p class="border-2 border-border bg-card p-3 font-bold">{qText ? 'No runner matches that.' : 'Nobody here yet.'}</p>
			{:else}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
					{#each rows as p (p.bib)}
						{@const st = stateOf(p)}
						{#if st === 'tagged'}
							{@const at = seen.get(p.bib)?.get(station.id)}
							<div class="{cardCls} bg-muted">
								<span class="font-display text-3xl font-black">{p.bib}</span>
								<span class="w-full truncate text-muted-foreground">{p.name}</span>
								<div class="mt-1 flex w-full items-center justify-between gap-2">
									<span class="font-bold">{at ? clock(at) : ''}</span>
									{#if mine[mineKey(p)] && !mine[mineKey(p)].voided}
										<Button variant="outline" size="sm" class="h-9 border-2 font-bold uppercase" onclick={() => undo(p)}>Undo</Button>
									{/if}
								</div>
							</div>
						{:else}
							<button type="button" onclick={() => tap(p)} class="{cardCls} {st === 'incoming' ? 'bg-checkpoint text-background' : st === 'missed' ? 'border-destructive bg-card' : 'bg-card'}">
								<span class="font-display text-3xl font-black">{p.bib}</span>
								<span class="w-full truncate {st === 'incoming' ? '' : 'text-muted-foreground'}">{p.name}</span>
								<span class="mt-1 text-sm font-bold uppercase {st === 'missed' ? 'text-destructive' : st === 'incoming' ? '' : 'text-muted-foreground'}">
									{st === 'incoming' ? '▶ Coming here' : st === 'missed' ? 'Missed here' : 'Tap to tag'}
								</span>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</main>
