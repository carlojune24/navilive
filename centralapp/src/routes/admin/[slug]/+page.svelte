<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import AwardsEditor from '$lib/components/AwardsEditor.svelte';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import CourseEditor from '$lib/components/CourseEditor.svelte';
	import RouteEditor from '$lib/components/RouteEditor.svelte';
	import ProgressTable from '$lib/components/ProgressTable.svelte';
	import { groupTally, byCategory } from '$lib/tally';
	import { onMount, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { invalidateAll } from '$app/navigation';
	import { ago } from '$lib/time';
	import { fmt, genderLabel } from '$lib/results';
	import { countRunners } from '$lib/runners';
	import { sourceLabel } from '$lib/readtrail';
	import { finishAt, localDay } from '$lib/time';
	import { shrinkImage } from '$lib/image';
	import { deserialize } from '$app/forms';
	import { monitor } from '$lib/monitor.svelte';
	import { bestLink, clockWarning, linkState, type Link } from '$lib/heartbeat';

	let { data, form } = $props();
	// the left menu picks the section with ?tab=...
	const sections = ['participants', 'categories', 'starts', 'stations', 'route', 'progress', 'results', 'awards', 'reads', 'tally', 'bibs', 'release', 'data', 'connect'];
	const titles: Record<string, string> = { participants: 'Participants', categories: 'Categories', starts: 'Starts', stations: 'Stations', route: 'Route & map', progress: 'Progress', results: 'Results', awards: 'Awards', reads: 'Reads', tally: 'Tally sheets', bibs: 'Bib list', release: 'Batch release tally', data: 'Station data', connect: 'Connect stations' };
	// Results page: the finish-time override panel for one runner
	let ovr = $state<{ bib: string; name: string; at: string; day: string; start: number | null } | null>(null);
	let ovrBy = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem('nv.admin.name') ?? ''));
	let ovrReason = $state('');
	let ovrFile = $state<File | null>(null);
	let ovrErr = $state('');
	let ovrBusy = $state(false);
	const overrideOf = (bib: string) => data.overrides.find((o) => o.bib === bib);
	// Progress page: the time penalty for one runner or team
	let pen = $state<{ bib: string; name: string; minutes: string; note: string } | null>(null);
	let penErr = $state('');
	let penBusy = $state(false);
	function openPenalty(r: { bib: string; name: string }) {
		const p = data.participants.find((x) => x.bib === r.bib);
		const ms = Number(p?.penalty_ms ?? 0);
		pen = { bib: r.bib, name: r.name, minutes: ms ? String(Math.round((ms / 60000) * 100) / 100) : '', note: p?.penalty_note ?? '' };
		penErr = '';
	}
	async function savePenalty(clear = false) {
		if (!pen) return;
		penBusy = true;
		penErr = '';
		try {
			const fd = new FormData();
			fd.set('bib', pen.bib);
			fd.set('minutes', clear ? '0' : String(pen.minutes ?? '').trim() || '0');
			fd.set('note', clear ? '' : pen.note);
			const r = await fetch('?tab=progress&/setPenalty', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const res = deserialize(await r.text());
			if (res.type !== 'success') return (penErr = (res.type === 'failure' && (res.data as { error?: string })?.error) || 'Could not save the penalty.');
			pen = null;
			await invalidateAll();
		} finally {
			penBusy = false;
		}
	}
	// the runner's start (gun or own), so a finish after midnight lands on the right day
	const startOfBib = (bib: string) => data.progressData.flatMap((c) => c.progress).find((r) => r.bib === bib)?.start ?? null;
	function openOverride(r: { bib: string; name: string; finishAt: number | null }) {
		const start = startOfBib(r.bib);
		// the day: the runner's own finish, else their start day, else today; the date field shows it and can be changed
		const ref = r.finishAt ?? start ?? Date.now();
		const local = new Date(ref - new Date(ref).getTimezoneOffset() * 60000).toISOString();
		ovr = { bib: r.bib, name: r.name, day: local.slice(0, 10), at: r.finishAt ? local.slice(11, 23) : '', start };
		ovrReason = '';
		ovrFile = null;
		ovrErr = '';
	}
	// what will be saved: a time at or before the start moves to the next day
	const ovrMs = $derived(ovr && ovr.at && ovr.day ? finishAt(ovr.day, ovr.at, ovr.start) : NaN);
	async function saveOverride() {
		if (!ovr) return;
		const ms = ovrMs;
		if (!Number.isFinite(ms)) return (ovrErr = 'Enter the finish date and time.');
		ovrBusy = true;
		ovrErr = '';
		try {
			const fd = new FormData();
			fd.set('bib', ovr.bib);
			fd.set('finish_ms', String(ms));
			fd.set('reason', ovrReason);
			fd.set('by', ovrBy);
			if (ovrFile) fd.set('photo', await shrinkImage(ovrFile), 'proof.jpg');
			const r = await fetch('?tab=results&/setFinishOverride', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const res = deserialize(await r.text());
			if (res.type !== 'success') return (ovrErr = (res.type === 'failure' && (res.data as { error?: string })?.error) || 'Could not save the override.');
			try { localStorage.setItem('nv.admin.name', ovrBy.trim()); } catch { /* private mode */ }
			ovr = null;
			await invalidateAll();
		} catch {
			ovrErr = 'That file could not be read as a photo.';
		} finally {
			ovrBusy = false;
		}
	}
	const levelName = { checkpoints: 'Results pending', released: 'Released' } as const;
	// The live-board buttons answer at once: the new level shows immediately and is saved in the background,
	// then the real value from the server replaces it (or the change is rolled back with a message).
	let relOpt = $state<Record<string, string | null>>({}); // `c<id>` / `b<id>` -> level, pending
	let relMsg = $state('');
	const catLevel = (id: number) => relOpt[`c${id}`] ?? data.categories.find((c) => c.id === id)?.release ?? 'checkpoints';
	const batchLevel = (b: { id: number; release: string | null }) => (`b${b.id}` in relOpt ? relOpt[`b${b.id}`] : b.release);
	const runnerLevel = (p: { id: number; release: string | null }) => (`p${p.id}` in relOpt ? relOpt[`p${p.id}`] : p.release);
	const allLevel = $derived.by(() => {
		const lv = new Set(data.categories.map((c) => catLevel(c.id)));
		const overridden = data.batches.some((b) => batchLevel(b) !== null);
		return lv.size === 1 && !overridden ? [...lv][0] : null;
	});
	// Another reload (the live push) can finish with the old value before ours lands; dropping the clicked level then
	// flashed the old one back for a moment. So each clicked level is dropped only once the page data agrees with it.
	$effect(() => {
		const keep = Object.entries(relOpt).filter(([k, v]) =>
			k[0] === 'c'
				? data.categories.find((c) => c.id === Number(k.slice(1)))?.release !== v
				: ((k[0] === 'p' ? data.participants : data.batches).find((x: { id: number }) => x.id === Number(k.slice(1)))?.release ?? null) !== v
		);
		if (keep.length !== Object.keys(relOpt).length) relOpt = Object.fromEntries(keep);
	});
	// in-page replacement for the browser's confirm(): `run` happens only when the organizer presses the button
	let ask = $state<{ title: string; text: string; ok: string; run: () => void } | null>(null);
	// a single runner's Release is one deliberate click on their row, so it does not ask
	const setRelease = (scope: 'all' | 'category' | 'batch' | 'runner', id: number, level: string) =>
		level === 'released' && scope !== 'runner'
			? (ask = { title: 'Release results?', text: 'Show these results on the public live board?', ok: 'Release', run: () => void saveRelease(scope, id, level) })
			: void saveRelease(scope, id, level);
	async function saveRelease(scope: 'all' | 'category' | 'batch' | 'runner', id: number, level: string) {
		const before = relOpt;
		if (scope === 'all') {
			relOpt = {
				...Object.fromEntries(data.categories.map((c) => [`c${c.id}`, level])),
				...Object.fromEntries(data.batches.map((b) => [`b${b.id}`, null])),
				...Object.fromEntries(data.participants.filter((p) => p.release !== null).map((p) => [`p${p.id}`, null]))
			};
		} else relOpt = { ...relOpt, [`${scope === 'batch' ? 'b' : scope === 'runner' ? 'p' : 'c'}${id}`]: level === 'inherit' ? null : level };
		relMsg = 'Saving…';
		try {
			const fd = new FormData();
			fd.set('scope', scope);
			fd.set('id', String(id));
			fd.set('level', level);
			const r = await fetch('?tab=progress&/setRelease', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const res = deserialize(await r.text());
			if (res.type !== 'success') throw new Error((res.type === 'failure' && (res.data as { error?: string })?.error) || 'Could not save');
			await invalidateAll(); // the clicked level stays shown until the reloaded data carries it (see the effect below)
			relMsg = 'Live board updated ✓';
		} catch (err) {
			relOpt = before;
			relMsg = `Not saved: ${err instanceof Error ? err.message : 'try again'}`;
		}
	}
	let progCat = $state<number | null>(null); // Progress page: which category is shown
	let catSel = $state<number | null>(null); // Categories page: which category is shown
	const catShown = $derived(data.categories.find((c) => c.id === catSel) ?? data.categories[0]);
	let catBatch = $state<'none' | number | null>(null); // Categories page: which batch of that category ('none' = the runners in no batch)
	const catBatches = $derived(data.batches.filter((b) => b.category_id === catShown?.id));
	let catQ = $state(''); // Categories page: search inside the shown category
	// the panel's rows: the search looks across the whole category, otherwise it is the picked batch
	const catRows = $derived.by(() => {
		const all = data.participants.filter((p) => p.category_id === catShown?.id);
		const words = catQ.toLowerCase().split(' ').filter(Boolean);
		if (words.length) return all.filter((p) => words.every((w) => `${p.bib} ${p.name}`.toLowerCase().includes(w)));
		return batchShown ? all.filter((p) => p.batch_id === batchShown.id) : all.filter((p) => !p.batch_id);
	});
	const catLoose = $derived(data.participants.filter((p) => p.category_id === catShown?.id && !p.batch_id));
	const batchShown = $derived(catBatch === 'none' ? null : (catBatches.find((b) => b.id === catBatch) ?? catBatches[0]));
	// Starts page: tick runners of one category -> next batch; each batch is started and released on its own
	let stCat = $state<number | null>(null);
	const stShown = $derived(data.categories.find((c) => c.id === stCat) ?? data.categories[0]);
	let stQ = $state('');
	let picked = $state<number[]>([]);
	const stFree = $derived.by(() => {
		const words = stQ.toLowerCase().split(/\s+/).filter(Boolean);
		return data.participants.filter((p) => p.category_id === stShown?.id && !p.batch_id && words.every((w) => `${p.bib} ${p.name}`.toLowerCase().includes(w)));
	});
	let rmTarget = $state<{ id: number; bib: string; name: string; batch: string } | null>(null); // runner waiting for "remove from batch?" confirmation
	let stBatch = $state<number | null>(null); // which batch tab is open
	const stBatches = $derived(data.batches.filter((b) => b.category_id === stShown?.id));
	const stBatchShown = $derived(stBatches.find((b) => b.id === stBatch) ?? stBatches[0]);
	const stNext = $derived(Math.max(0, ...data.batches.filter((b) => b.category_id === stShown?.id).map((b) => Number(b.name) || 0)) + 1);
	const stateOf = $derived(new Map(data.progressData.flatMap((c) => c.progress.map((r) => [r.bib, r.state] as const))));
	const countStates = (bibs: string[]) => {
		const s = bibs.map((b) => stateOf.get(b));
		return { finished: s.filter((x) => x === 'finished').length, course: s.filter((x) => x === 'on-course').length, waiting: s.filter((x) => x !== 'finished' && x !== 'on-course').length };
	};
	let awardsView = $state<'list' | 'settings'>('list'); // Awards page: the winners list or the settings
	let resSel = $state<number | 'all' | null>(null); // Results / Award list: which category is shown
	const resShown = $derived(resSel === 'all' ? data.resultsData : data.resultsData.filter((c) => c.id === (resSel ?? data.resultsData[0]?.id)));
	let progBatch = $state<'all' | 'none' | number>('all'); // Progress page: which batch of that category
	let printing = $state(false); // Progress print: show every row, not the 20 on screen
	async function printProgress() {
		printing = true;
		await tick();
		window.print();
		printing = false;
	}
	const progBatches = $derived(data.batches.filter((b) => b.category_id === progShown?.id));
	// the shown category's runners, narrowed to one batch when picked
	const progRows = $derived.by(() => {
		const rows = progShown?.progress ?? [];
		if (progBatch === 'all' || !progBatches.length) return rows;
		const batchOf = new Map(data.participants.map((p) => [p.bib, p.batch_id]));
		return rows.filter((r) => (batchOf.get(r.bib) ?? null) === (progBatch === 'none' ? null : progBatch));
	});
	// with All batches picked, a Batch column says which batch each runner is in
	const progBatchCol = $derived.by(() => {
		if (progBatch !== 'all' || !progBatches.length) return undefined;
		const name = new Map(data.participants.filter((p) => p.category_id === progShown?.id).map((p) => [p.bib, progBatches.find((b) => b.id === p.batch_id)?.name ?? null]));
		return (bib: string) => name.get(bib) ?? null;
	});
	const progShown = $derived(data.progressData.find((c) => c.id === progCat) ?? data.progressData[0]);
	const tab = $derived(sections.includes(page.url.searchParams.get('tab') ?? '') ? page.url.searchParams.get('tab')! : 'participants');
	let now = $state(Date.now());
	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	// Starts and Categories follow batches rolled and started from the live board's Start view without a reload
	$effect(() => {
		if (tab !== 'starts' && tab !== 'categories') return;
		let t: ReturnType<typeof setTimeout>;
		const es = new EventSource(`/e/${data.event.slug}/stream`);
		es.onmessage = () => (clearTimeout(t), (t = setTimeout(() => void invalidateAll(), 500)));
		return () => (clearTimeout(t), es.close());
	});

	// what the page loaded, unless a live push has something newer
	const laptops = $derived(monitor.laptops ?? data.laptops);
	const sd = $derived(monitor.stationData ?? data.stationData);
	$effect(() => {
		data; // a reload (after any form) replaces the live snapshot so nothing stale lingers
		monitor.laptops = null;
		monitor.stationData = null;
	});

	// the live monitor feed itself runs in admin/+layout.svelte, so every event page (and the sidebar) stays current

	// which laptops serve a station (by name), and the best link among them
	const linkOf = (stationName: string): Link =>
		bestLink(laptops.filter((l: any) => l.payload?.stations?.some((x: any) => x.name.toLowerCase() === stationName.toLowerCase())).map((l: any) => linkState(l.last_seen_ms, now)));
	const linkWho = (stationName: string) =>
		laptops.filter((l: any) => l.payload?.stations?.some((x: any) => x.name.toLowerCase() === stationName.toLowerCase())).map((l: any) => l.laptop_name).join(', ');
	const linkColor = (l: Link) => (l === 'online' ? 'var(--start)' : l === 'late' ? 'var(--checkpoint)' : l === 'offline' ? 'var(--finish)' : 'transparent');
	const linkWords: Record<Link, string> = { online: 'Online', late: 'Late', offline: 'Offline', never: 'No laptop yet' };
	// search + category filter for the Participants list
	let search = $state('');
	let catFilter = $state(''); // '' = all, 'none' = no category, else a category id
	const filtered = $derived.by(() => {
		const words = search.toLowerCase().split(/\s+/).filter(Boolean);
		return data.participants.filter((p) => {
			if (catFilter === 'none' ? p.category_id !== null : catFilter !== '' && String(p.category_id) !== catFilter) return false;
			const hay = `${p.bib} ${p.name} ${p.members?.map((m: { name: string; tag: string }) => `${m.name} ${m.tag}`).join(' ') ?? ''} ${p.tag} ${p.category ?? ''} ${p.gender === 'M' ? 'male men' : p.gender === 'F' ? 'female women' : ''} ${p.age ?? ''}`.toLowerCase();
			return words.every((w) => hay.includes(w)); // every word must match somewhere, so "maria 10k" narrows
		});
	});
	const filtering = $derived(search.trim() !== '' || catFilter !== '');
	let importMode = $state<'bibs' | 'csv' | 'one' | 'tags'>('bibs');
	let importOpen = $state(false);
	let batchDlg = $state<{ kind: 'add' | 'assign' | 'find'; cat: number } | null>(null); // which category's batch dialog is open
	const dlgCat = $derived(batchDlg ? data.categories.find((c) => c.id === batchDlg!.cat) : null);
	let findQ = $state('');
	const found = $derived.by(() => {
		const words = findQ.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length || batchDlg?.kind !== 'find') return [];
		return data.participants.filter((p) => p.category_id === batchDlg!.cat && words.every((w) => `${p.bib} ${p.name}`.toLowerCase().includes(w))).slice(0, 30);
	});
	const dlgBatches = $derived(data.batches.filter((b) => b.category_id === batchDlg?.cat));
	const batchEnhance = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		await update();
		if (result.type === 'success') batchDlg = null; // a failure stays open with its message
	};
	let importError = $state('');
	// success closes the dialog (the page shows the result banner); a failure stays open with its message inside
	const importEnhance = () => async ({ result, update }: { result: { type: string; data?: { error?: string } }; update: () => Promise<void> }) => {
		await update();
		importError = result.type === 'failure' ? (result.data?.error ?? 'Import failed') : '';
		if (result.type === 'success') importOpen = false;
	};
	let editing = $state<number | null>(null);
	let addrIdx = $state(0);
	let copied = $state('');

	const field = 'h-11 w-full border-2 border-border bg-card px-3';
	const lbl = 'font-bold tracking-wide uppercase';
	const small = 'border-2 border-border bg-card font-bold uppercase hover:bg-accent';
	// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:MM:SS"
	const localInput = (ms: number | string | null) => {
		const d = new Date(ms ? Number(ms) : Date.now());
		return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
	};
	const whenText = (ms: number | string) => new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
	// the typed time travels as epoch ms, so the server never guesses a timezone
	const typedTime = ({ formData, cancel }: { formData: FormData; cancel: () => void }) => {
		const t = new Date(String(formData.get('at'))).getTime();
		if (!Number.isFinite(t)) return cancel();
		formData.set('ms', String(t));
		return ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false }); // keep the typed time in the field
	};
	// the Reset button asks first, then submits its own form
	const confirmReset = (label: string, e: MouseEvent) => {
		const form = (e.currentTarget as HTMLElement).closest('form');
		ask = { title: 'Reset start?', text: `Reset the start of ${label}? It goes back to Not started. Reads are kept.`, ok: 'Reset', run: () => form?.requestSubmit() };
	};
	// Delete batch asks first too; a started batch's runners lose its start time and fall back to the category's
	const confirmDeleteBatch = (label: string, n: number, started: boolean, e: MouseEvent) => {
		const form = (e.currentTarget as HTMLElement).closest('form');
		const who = n ? `Its ${n} runner${n === 1 ? '' : 's'} go back to no batch.` : 'It has no runners.';
		ask = { title: 'Delete batch?', text: `Delete ${label}? ${who}${started ? ' It has started: its runners will be timed from the category start instead.' : ''}`, ok: 'Delete', run: () => form?.requestSubmit() };
	};
	// any one-click action that is hard to undo asks first, then submits its own form
	const confirmSubmit = (title: string, text: string, ok: string, e: MouseEvent) => {
		const form = (e.currentTarget as HTMLElement).closest('form');
		ask = { title, text, ok, run: () => form?.requestSubmit() };
	};
	// the typed read time travels as epoch ms, so the server never guesses a timezone; empty = now
	const manualTime = ({ formData, cancel }: { formData: FormData; cancel: () => void }) => {
		const typed = String(formData.get('time') ?? '');
		if (typed) {
			const t = new Date(typed).getTime();
			if (!Number.isFinite(t)) return cancel();
			formData.set('ms', String(t));
		}
		formData.delete('time');
	};
	// a duplicate name is not an error, but nothing was added: say so
	$effect(() => {
		if (form?.warning) toast.warning(form.warning);
	});
	// Batch release tally: 0.45in rows on A4 (0.5in margins). Chrome fits 22 on one page; 21 leaves room for other browsers' margins
	const RELEASE_ROWS_A4 = 21;
	let releaseRows = $state(RELEASE_ROWS_A4);
	let bibView = $state<'batch' | 'category'>('batch');
	// categories left out of the Tally sheets / Bib list printout (empty = print all)
	let printCats = $state<string[]>([]);
	const printable = $derived(data.categories.filter((c) => !printCats.includes(c.name)));
	const kindColor = (k: string) => (k === 'start' ? 'var(--start)' : k === 'finish' ? 'var(--finish)' : 'var(--checkpoint)');

	const addr = $derived(data.addresses[addrIdx]);
	const baseUrl = $derived(data.publicUrl ?? (addr ? `http://${addr.ip}:${data.port}` : `http://<this laptop's IP>:${data.port}`));
	const code = $derived(data.apiKey ? `RC1|${baseUrl}|${data.event.slug}|${data.apiKey}` : '');
	const marshalUrl = $derived(data.apiKey ? `${baseUrl}/m/${data.event.slug}?k=${data.apiKey}` : '');

	async function copy(label: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = label;
			setTimeout(() => (copied = ''), 1800);
		} catch {
			copied = 'Select the text and press Ctrl+C';
		}
	}

	const closeOnSave = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		await update();
		if (result.type === 'success') editing = null;
	};
</script>

{#snippet gunControls(kind: 'category' | 'batch', id: number, gun: number | string | null, label: string)}
	<span class="text-sm font-bold uppercase {gun ? '' : 'text-muted-foreground'}">{gun ? `Started ${whenText(gun)}` : 'Not started'}</span>
	{#if gun}
		<form method="POST" action="?tab={tab}&/clearGun" use:enhance>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="id" value={id} />
			<Button type="button" onclick={(e) => confirmReset(label, e)} variant="outline" size="sm" class={small} title="Back to not started, so Start can be pressed again" aria-label="Reset start of {label}">Reset</Button>
		</form>
	{:else}
		<form method="POST" action="?tab={tab}&/startGun" use:enhance>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="id" value={id} />
			<Button type="submit" size="sm" class="font-bold uppercase" aria-label="Start {label} now">Start</Button>
		</form>
	{/if}
	<form method="POST" action="?tab={tab}&/startGun" use:enhance={typedTime} class="flex items-center gap-1">
		<input type="hidden" name="kind" value={kind} />
		<input type="hidden" name="id" value={id} />
		<input type="datetime-local" step="1" name="at" value={localInput(gun)} class="h-9 border-2 border-border bg-card px-2 text-sm" aria-label="Start time for {label}" required />
		<Button type="submit" variant="outline" size="sm" class={small}>{gun ? 'Correct time' : 'Set time'}</Button>
	</form>
{/snippet}

{#snippet releaseButtons(scope: 'all' | 'category' | 'batch', id: number, current: string | null, follow = false, grid = false)}
	<!-- grid: the batch cards on Progress, two buttons per row so they fit a narrow card -->
	<div class={grid ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-2'}>
		{#each ['checkpoints', 'released'] as lv}
			<button type="button" aria-pressed={current === lv} onclick={() => setRelease(scope, id, lv)} class="h-10 border-2 border-border px-3 font-bold uppercase {grid ? 'text-sm' : ''} {current === lv ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">{levelName[lv as keyof typeof levelName]}</button>
		{/each}
		{#if follow}<button type="button" aria-pressed={current === null} onclick={() => setRelease(scope, id, 'inherit')} class="h-10 border-2 border-border px-3 font-bold uppercase {grid ? 'text-sm' : ''} {current === null ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">Follow category</button>{/if}
	</div>
{/snippet}

<!-- Progress table: release one runner or team as soon as they cross the finish, ahead of their batch -->
{#snippet runnerRelease(r: { bib: string; state: string })}
	{@const p = data.participants.find((x) => x.bib === r.bib && x.category_id === progShown?.id)}
	{#if p}
		{@const own = runnerLevel(p)}
		{@const b = data.batches.find((x) => x.id === p.batch_id)}
		{@const group = (b ? batchLevel(b) : null) ?? catLevel(p.category_id)}
		{#if own === 'released'}
			<span class="font-bold text-start uppercase">Released ✓</span>
			<button type="button" class="ml-2 underline" onclick={() => setRelease('runner', p.id, 'inherit')} title="Back to what their {b ? 'batch' : 'category'} shows">Undo</button>
		{:else if group === 'released'}
			<span class="text-muted-foreground uppercase">Released ({b ? 'batch' : 'category'})</span>
		{:else if r.state === 'finished'}
			<button type="button" class="h-9 border-2 border-border bg-card px-3 font-bold uppercase hover:bg-accent" onclick={() => setRelease('runner', p.id, 'released')}>Release</button>
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	{/if}
{/snippet}

{#snippet overridePanel()}
<Dialog.Root open={pen !== null} onOpenChange={(o) => !o && (pen = null)}>
	{#if pen}
		<Dialog.Content class="border-2 border-border sm:max-w-lg">
			<div class="space-y-3">
				<Dialog.Header>
					<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Penalty — {pen.bib} {pen.name}</Dialog.Title>
					<Dialog.Description>Minutes added to this runner's or team's total time. It changes their place and awards, and shows as a penalty under the time.</Dialog.Description>
				</Dialog.Header>
				{#if penErr}<p class="font-bold text-destructive" role="alert">{penErr}</p>{/if}
				<label class="block font-bold uppercase">Penalty (minutes)<input type="number" min="0" max="600" step="0.5" inputmode="decimal" bind:value={pen.minutes} placeholder="e.g. 2" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal" /></label>
				<label class="block font-bold uppercase">Reason <span class="font-normal normal-case text-muted-foreground">(optional)</span><input bind:value={pen.note} maxlength="300" placeholder="e.g. Missed a station" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
				<div class="flex flex-wrap gap-2">
					<Button class="h-11 font-bold uppercase" disabled={penBusy} onclick={() => savePenalty()}>{penBusy ? 'Saving…' : 'Save penalty'}</Button>
					{#if Number(data.participants.find((x) => x.bib === pen?.bib)?.penalty_ms ?? 0) > 0}<Button variant="outline" class="h-11 border-2 font-bold uppercase" disabled={penBusy} onclick={() => savePenalty(true)}>Remove penalty</Button>{/if}
					<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (pen = null)}>Cancel</Button>
				</div>
			</div>
		</Dialog.Content>
	{/if}
</Dialog.Root>

<Dialog.Root open={ovr !== null} onOpenChange={(o) => !o && (ovr = null)}>
{#if ovr}
	<Dialog.Content class="max-h-[90vh] overflow-y-auto border-2 border-border sm:max-w-md">
				<div class="space-y-3">
					<Dialog.Header>
						<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Override finish — {ovr.bib} {ovr.name}</Dialog.Title>
						<Dialog.Description>Replaces this runner's finish time in the ranking. The original reads are kept. Needs a reason; a proof photo is optional.</Dialog.Description>
					</Dialog.Header>
					{#if ovrErr}<p class="font-bold text-destructive" role="alert">{ovrErr}</p>{/if}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block font-bold uppercase">Finish date<input type="date" bind:value={ovr.day} class="mt-1 block h-12 w-full border-2 border-border bg-background px-3" /></label>
						<label class="block font-bold uppercase">Finish time (time of day)<input type="time" step="0.001" bind:value={ovr.at} class="mt-1 block h-12 w-full border-2 border-border bg-background px-3" /></label>
					</div>
					{#if Number.isFinite(ovrMs)}
						{@const moved = localDay(ovrMs) !== ovr.day}
						<p class="text-sm" role="status">
							Saves as <b>{new Date(ovrMs).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>{#if ovr.start !== null}, total time <b>{fmt(ovrMs - ovr.start)}</b>{/if}{#if moved} — the next day, because that time is before the start ({new Date(ovr.start!).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}){/if}.
						</p>
					{/if}
					<label class="block font-bold uppercase">Reason<input bind:value={ovrReason} maxlength="300" placeholder="e.g. Read delayed; photo shows runner first" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
					<label class="block font-bold uppercase">Your name<input bind:value={ovrBy} maxlength="80" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
					<label class="block font-bold uppercase">Proof photo <span class="font-normal normal-case text-muted-foreground">(optional)</span><input type="file" accept="image/*" onchange={(e) => (ovrFile = e.currentTarget.files?.[0] ?? null)} class="mt-1 block" /></label>
					<div class="flex gap-2">
						<Button class="h-11 font-bold uppercase" disabled={ovrBusy} onclick={saveOverride}>{ovrBusy ? 'Saving…' : 'Save override'}</Button>
						<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (ovr = null)}>Cancel</Button>
					</div>
				</div>
	</Dialog.Content>
{/if}
</Dialog.Root>
{/snippet}

{#snippet catPicker()}
	<div class="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Categories to print">
		<span class="text-sm font-bold uppercase">Print:</span>
		{#each data.categories as c (c.id)}
			<button type="button" aria-pressed={!printCats.includes(c.name)} class="h-9 border-2 border-border px-3 text-sm font-bold uppercase {printCats.includes(c.name) ? 'bg-card text-muted-foreground line-through hover:bg-accent' : 'bg-primary text-primary-foreground'}" onclick={() => (printCats = printCats.includes(c.name) ? printCats.filter((n) => n !== c.name) : [...printCats, c.name])}>{c.name}</button>
		{/each}
		<button type="button" class="h-9 px-2 text-sm font-bold uppercase underline" onclick={() => (printCats = [])}>All</button>
		<button type="button" class="h-9 px-2 text-sm font-bold uppercase underline" onclick={() => (printCats = data.categories.map((c) => c.name))}>None</button>
	</div>
{/snippet}
<svelte:head>{#if tab === 'tally' || tab === 'bibs'}{@html '<style>@page{size:8.5in 13in;margin:0.5in}</style>'}{:else if tab === 'release'}{@html '<style>@page{size:A4;margin:0.5in}</style>'}{:else if tab === 'progress'}{@html '<style>@page{size:A4 landscape;margin:0.4in}</style>'}{/if}</svelte:head>

<Toaster position="top-center" />
<main class="space-y-5 p-5 print:p-0">
	<header class={tab === 'tally' || tab === 'bibs' || tab === 'release' || tab === 'progress' ? 'print:hidden' : ''}>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">{tab === 'tally' || tab === 'bibs' || tab === 'release' ? 'Printables' : titles[tab]}</h1>
		<p class="mt-1 text-muted-foreground">{data.event.name} &middot; {countRunners(data.participants)} runners{#if countRunners(data.participants) !== data.participants.length}&nbsp;({data.participants.length} entries){/if} &middot; {data.categories.length} categories</p>
	</header>

	{#if tab === 'tally' || tab === 'bibs' || tab === 'release'}
		<!-- Printables: one menu item, one tab per sheet -->
		<div class="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Printables">
			{#each [['tally', 'Tally sheets'], ['bibs', 'Bib list'], ['release', 'Batch release tally']] as [id, label]}
				<a href="?tab={id}" role="tab" aria-selected={tab === id} class="flex h-11 items-center border-2 border-border px-4 text-lg font-bold uppercase {tab === id ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">{label}</a>
			{/each}
		</div>
	{/if}
	{#if form?.error && !importOpen && !batchDlg}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}
	{#if form?.imported}
		<p class="border-2 border-border bg-card p-3 font-bold">
			Imported {form.imported} {form.teamsImported ? `teams (${form.teamsImported.members} runners)` : 'participants'}.
			{#if form.skipped?.length}Notes: {form.skipped.join('; ')}{/if}
		</p>
	{/if}
	{#if form?.tagReport}
		{@const t = form.tagReport}
		<div class="space-y-1 border-2 border-border bg-card p-3 font-bold" role="status">
			<p>{t.tags} tags for {t.participants} participants (a team counts once).</p>
			<p class={t.missing.length ? 'text-destructive' : ''}>{t.missing.length ? `${t.missing.length} participants without a tag: ${t.missing.join(', ')}` : 'Everyone has a tag.'}</p>
			{#if t.tags > t.participants}<p class="text-destructive">More tags than participants.</p>{/if}
			{#if t.notes.length}<p class="text-destructive">Skipped: {t.notes.join('; ')}</p>{/if}
		</div>
	{/if}
	{#if form?.awardsSaved}<p class="border-2 border-border bg-card p-3 font-bold">Awards settings saved.</p>{/if}
	{#if form?.revealSet !== undefined}<p class="border-2 border-border bg-card p-3 font-bold">{form.revealSet ? 'Awards are now visible on the live board.' : 'Awards are now hidden from the public board.'}</p>{/if}
	{#if form?.saved}<p class="border-2 border-border bg-card p-3 font-bold">Participant saved.</p>{/if}
	{#if form?.manualAdded}<p class="border-2 border-border bg-card p-3 font-bold">Manual read added.</p>{/if}
	{#if form?.readsUploaded}<p class="border-2 border-border bg-card p-3 font-bold">File read: {form.readsUploaded.received} reads. {form.readsUploaded.inserted} new, {form.readsUploaded.duplicates} already here (skipped){form.readsUploaded.updated ? `, ${form.readsUploaded.updated} void changes applied` : ''}.</p>{/if}
	{#if form?.cleared !== undefined}<p class="border-2 border-border bg-card p-3 font-bold">Cleared {form.cleared} reads.</p>{/if}


		<!-- one confirmation dialog for Reset start, Delete batch and Release results, on every tab -->
		<Dialog.Root open={ask !== null} onOpenChange={(o) => !o && (ask = null)}>
			{#if ask}
				<Dialog.Content class="border-2 border-border sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">{ask.title}</Dialog.Title>
						<Dialog.Description>{ask.text}</Dialog.Description>
					</Dialog.Header>
					<div class="flex gap-2">
						<Button class="h-11 font-bold uppercase" onclick={() => { const go = ask?.run; ask = null; go?.(); }}>{ask.ok}</Button>
						<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (ask = null)}>Cancel</Button>
					</div>
				</Dialog.Content>
			{/if}
		</Dialog.Root>

		<!-- PARTICIPANTS -->
		{#if tab === 'participants'}
		<div class="space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-lg" role="status">
					{#if filtering}Showing <b>{countRunners(filtered)}</b> of <b>{countRunners(data.participants)}</b> runners{:else}<b>{countRunners(data.participants)}</b> runners{#if countRunners(data.participants) !== data.participants.length}&nbsp;({data.participants.length} entries){/if} in <b>{data.categories.length}</b> categories{/if}
				</p>
				<Button class="h-11 font-bold uppercase" onclick={() => ((importError = ''), (importOpen = true))}>Import participants</Button>
			</div>
			<div class="flex flex-wrap items-end gap-3">
				<div class="min-w-64 flex-1">
					<Label class={lbl} for="psearch">Search</Label>
					<Input id="psearch" type="search" bind:value={search} placeholder="Bib, name, tag, gender, age…" autocomplete="off" class="h-11 border-2" />
				</div>
				<div class="w-60">
					<Label class={lbl} for="pcat">Category</Label>
					<select id="pcat" bind:value={catFilter} class={field}>
						<option value="">All categories</option>
						{#each data.categories as c}<option value={String(c.id)}>{c.name} ({countRunners(data.participants.filter((p) => p.category_id === c.id))})</option>{/each}
						<option value="none">No category ({countRunners(data.participants.filter((p) => p.category_id === null))})</option>
					</select>
				</div>
				{#if filtering}<Button type="button" variant="outline" class="h-11 border-2 border-border bg-card font-bold uppercase hover:bg-accent" onclick={() => ((search = ''), (catFilter = ''))}>Clear</Button>{/if}
			</div>
			<div class="border-2 border-border bg-card">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-primary hover:bg-primary">
							{#each ['Bib', 'Name', 'Team name', 'Category', 'Gender', 'Age', 'Tag', ''] as h}
								<Table.Head class="font-bold tracking-wide text-primary-foreground uppercase">{h}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filtered as p (p.id)}
							{#if editing === p.id}
								<Table.Row class="bg-accent">
									<Table.Cell colspan={8}>
										<form method="POST" action="?tab={tab}&/updateParticipant" use:enhance={closeOnSave} class="flex flex-wrap items-end gap-2">
											<input type="hidden" name="id" value={p.id} />
											<div class="w-28"><Label class={lbl} for="eb{p.id}">Bib</Label><Input id="eb{p.id}" name="bib" value={p.bib} class="h-11 border-2" required /></div>
											<div class="min-w-48 flex-1"><Label class={lbl} for="en{p.id}">Name</Label><Input id="en{p.id}" name="name" value={p.name} class="h-11 border-2" /></div>
											<div class="w-48">
												<Label class={lbl} for="ec{p.id}">Category</Label>
												<select id="ec{p.id}" name="category" class={field}>
													<option value="">None</option>
													{#each data.categories as c}<option value={c.id} selected={c.id === p.category_id}>{c.name}</option>{/each}
												</select>
											</div>
											{#if data.batches.some((b) => b.category_id === p.category_id)}
												<div class="w-40">
													<Label class={lbl} for="eba{p.id}">Batch</Label>
													<select id="eba{p.id}" name="batch" class={field}>
														<option value="">None</option>
														{#each data.batches.filter((b) => b.category_id === p.category_id) as b}<option value={b.id} selected={b.id === p.batch_id}>{b.name}</option>{/each}
													</select>
												</div>
											{/if}
											{#if !p.members?.length}
												<div class="w-32">
													<Label class={lbl} for="eg{p.id}">Gender</Label>
													<select id="eg{p.id}" name="gender" class={field}>
														<option value="">—</option>
														<option value="M" selected={p.gender === 'M'}>Male</option>
														<option value="F" selected={p.gender === 'F'}>Female</option>
													</select>
												</div>
												<div class="w-24"><Label class={lbl} for="ea{p.id}">Age</Label><Input id="ea{p.id}" name="age" inputmode="numeric" value={p.age ?? ''} class="h-11 border-2" /></div>
												<div class="w-44"><Label class={lbl} for="et{p.id}">Tag</Label><Input id="et{p.id}" name="tag" value={p.tag} class="h-11 border-2" /></div>
											{/if}
											{#each p.members ?? [] as m, mi (m.id)}
												<!-- a relay/duo runner: change the name here when a substitute takes their place -->
												<div class="flex w-full flex-wrap items-end gap-2 border-t-2 border-border/20 pt-2">
													<input type="hidden" name="mid" value={m.id} />
													<div class="min-w-48 flex-1"><Label class={lbl} for="mn{m.id}">Runner {mi + 1} name</Label><Input id="mn{m.id}" name="mname" value={m.name} class="h-11 border-2" required /></div>
													<div class="w-32">
														<Label class={lbl} for="mg{m.id}">Gender</Label>
														<select id="mg{m.id}" name="mgender" class={field}>
															<option value="">—</option>
															<option value="M" selected={m.gender === 'M'}>Male</option>
															<option value="F" selected={m.gender === 'F'}>Female</option>
														</select>
													</div>
													<div class="w-24"><Label class={lbl} for="ma{m.id}">Age</Label><Input id="ma{m.id}" name="mage" inputmode="numeric" value={m.age ?? ''} class="h-11 border-2" /></div>
													<div class="w-44"><Label class={lbl} for="mt{m.id}">Tag</Label><Input id="mt{m.id}" name="mtag" value={m.tag} class="h-11 border-2" /></div>
												</div>
											{/each}
											<Button type="submit" class="h-11 font-bold uppercase">Save</Button>
											<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (editing = null)}>Cancel</Button>
										</form>
										<div class="mt-3 border-t-2 border-border/20 pt-3"><span class="mr-3 font-bold tracking-wide uppercase">Winner photo</span><PhotoUpload slug={data.event.slug} id={p.id} bib={p.bib} photo={p.photo} tab={tab} /></div>
									</Table.Cell>
								</Table.Row>
							{:else}
								<!-- a relay/duo team shows one row per runner (team name beside them); Edit/Delete act on the whole team from its first row -->
								{#each p.members?.length ? p.members : [p] as m, mi}
								<Table.Row>
									<Table.Cell class="font-display text-3xl font-black">{p.bib}</Table.Cell>
									<Table.Cell class="text-lg">{m.name || '—'}</Table.Cell>
									<Table.Cell class="text-lg">{p.members?.length ? p.name : '—'}</Table.Cell>
									<Table.Cell>{p.category ?? '—'}</Table.Cell>
									<Table.Cell>{m.gender === 'M' ? 'Male' : m.gender === 'F' ? 'Female' : '—'}</Table.Cell>
									<Table.Cell>{m.age ?? '—'}</Table.Cell>
									<Table.Cell>{m.tag || '—'}</Table.Cell>
									<Table.Cell class="text-right whitespace-nowrap">
										{#if mi === 0}
										<Button variant="outline" size="sm" class={small} onclick={() => (editing = p.id)}>Edit</Button>
										<form method="POST" action="?tab={tab}&/deleteParticipant" use:enhance class="inline">
											<input type="hidden" name="id" value={p.id} />
											<Button type="button" onclick={(e) => confirmSubmit('Delete runner?', `Delete ${p.bib} ${p.name || ''} for good? Their photo, finish override and team members go too. Their reads are kept.`, 'Delete', e)} variant="outline" size="sm" class={small}>Delete</Button>
										</form>
										{/if}
									</Table.Cell>
								</Table.Row>
								{/each}
							{/if}
						{:else}
							<Table.Row>
								<Table.Cell colspan={8} class="p-6 text-muted-foreground">{filtering ? 'No participants match this search.' : 'No participants yet. Press Import participants.'}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
		{/if}

		<!-- CATEGORIES -->
		{#if tab === 'categories'}
		<div class="space-y-4">
			<form method="POST" action="?tab={tab}&/addCategory" use:enhance class="flex gap-2 border-2 border-border bg-card p-4">
				<Input name="name" placeholder="e.g. 10K Women 18-29" class="h-11 border-2" required />
				<Button type="submit" class="h-11 font-bold uppercase">Add</Button>
			</form>
			{#if form?.batchAssigned !== undefined}<p class="border-2 border-border bg-card p-3 font-bold">{form.batchAssigned} runner(s) assigned.</p>{/if}
			{#if data.categories.length > 1}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Category">
					{#each data.categories as c (c.id)}
						<button type="button" role="tab" aria-selected={c.id === catShown?.id} onclick={() => ((catSel = c.id), (catBatch = null), (catQ = ''))} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {c.id === catShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">{c.name} ({c.n})</button>
					{/each}
				</div>
			{/if}
			<ul class="divide-y-2 divide-border border-2 border-border bg-card">
				{#each catShown ? [catShown] : [] as c (c.id)}
					{@const bs = data.batches.filter((b) => b.category_id === c.id)}
					<li class="p-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<span class="text-xl font-bold uppercase">{c.name} <span class="font-normal text-muted-foreground">({c.n})</span></span>
							<div class="flex flex-wrap items-center gap-3">
								{@render gunControls('category', c.id, c.gun_ms, c.name)}
								<form method="POST" action="?tab={tab}&/archiveCategory" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<Button type="button" onclick={(e) => confirmSubmit('Archive category?', `Hide ${c.name} from the boards? Results and reads are kept; Restore brings it back.`, 'Archive', e)} variant="outline" size="sm" class={small} title="Hide this category from the boards. Results and reads are kept; Restore brings it back.">Archive</Button>
								</form>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
							<form method="POST" action="?tab={tab}&/setRankBy" use:enhance={() => ({ update }) => update({ reset: false })} class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="id" value={c.id} />
								<Label class={lbl} for="rb{c.id}">Winner decided by</Label>
								<select id="rb{c.id}" name="rank_by" class="h-11 border-2 border-border bg-card px-3" value={c.rank_by} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
									<option value="elapsed">Shortest time from the start</option>
									<option value="chip">Shortest time from own start read</option>
									<option value="finish">First across the finish line</option>
								</select>
							</form>
							<div class="flex flex-wrap gap-2">
								<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (batchDlg = { kind: 'add', cat: c.id })}>Add batch</Button>
								{#if bs.length}<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (batchDlg = { kind: 'assign', cat: c.id })}>Assign runners</Button>{/if}
								{#if bs.length}<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => ((findQ = ''), (batchDlg = { kind: 'find', cat: c.id }))}>Find runner</Button>{/if}
							</div>
						</div>
						<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
							{#if bs.length}
								<div class="flex flex-wrap gap-2" role="tablist" aria-label="Batch">
									{#each bs as b (b.id)}
										<button type="button" role="tab" aria-selected={!catQ && b.id === batchShown?.id} onclick={() => ((catBatch = b.id), (catQ = ''))} class="h-11 border-2 border-border px-4 text-lg font-bold uppercase {!catQ && b.id === batchShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">
											Batch {b.name} ({b.n})
											{#if b.gun_ms}<span class="ml-1 text-start" title="Started">&#9679;</span>{/if}
										</button>
									{/each}
									<button type="button" role="tab" aria-selected={!catQ && catBatch === 'none'} onclick={() => ((catBatch = 'none'), (catQ = ''))} class="h-11 border-2 border-border px-4 text-lg font-bold uppercase {!catQ && catBatch === 'none' ? 'bg-primary text-primary-foreground' : 'bg-card'}">Not in a batch ({catLoose.length})</button>
								</div>
							{:else}
								<p class="text-muted-foreground">No batches. Everyone in this category starts together.</p>
							{/if}
							<Input bind:value={catQ} placeholder="Search {c.name} by bib or name" class="h-11 w-full border-2 sm:w-72" aria-label="Search runners in {c.name}" />
						</div>
						<div class="mt-3 border-2 border-border/15">
							{#if catQ}
								<p class="bg-accent/40 px-3 py-2 font-bold uppercase">{catRows.length} match{catRows.length === 1 ? '' : 'es'} in {c.name}</p>
							{:else if batchShown}
								{@const b = batchShown}
								<div class="flex flex-wrap items-center justify-between gap-3 bg-accent/40 px-3 py-2">
									<span class="font-bold uppercase">Batch {b.name} <span class="font-normal text-muted-foreground">({b.n})</span></span>
									<div class="flex flex-wrap items-center gap-3">
										{@render gunControls('batch', b.id, b.gun_ms, `${c.name} ${b.name}`)}
										<form method="POST" action="?tab={tab}&/deleteBatch" use:enhance>
											<input type="hidden" name="id" value={b.id} />
											<Button type="button" onclick={(e) => confirmDeleteBatch(`${c.name} Batch ${b.name}`, b.n, !!b.gun_ms, e)} variant="outline" size="sm" class={small} title="Its runners go back to no batch">Delete</Button>
										</form>
									</div>
								</div>
							{/if}
							<ul class="divide-y divide-border/15 px-3">
								{#each catRows as p (p.id)}
									{@const mine = bs.find((b) => b.id === p.batch_id)}
									<li class="flex flex-wrap items-center justify-between gap-2 py-1">
										<span>
											<span class="font-bold">{p.bib}</span>
											{p.name}
											{#if catQ}<span class="ml-2 text-sm font-bold uppercase {mine ? '' : 'text-muted-foreground'}">{mine ? `Batch ${mine.name}` : 'Not in a batch'}</span>{/if}
										</span>
										{#if p.batch_id}
											<form method="POST" action="?tab={tab}&/removeFromBatch" use:enhance>
												<input type="hidden" name="id" value={p.id} />
												<Button type="submit" variant="outline" size="sm" class={small} aria-label="Remove {p.bib} from their batch">Remove</Button>
											</form>
										{:else if bs.length}
											<form method="POST" action="?tab={tab}&/assignBatch" use:enhance class="flex items-center gap-1">
												<input type="hidden" name="category" value={c.id} />
												<input type="hidden" name="bibs" value={p.bib} />
												<select name="batch" class="h-9 border-2 border-border bg-card px-2 text-sm" aria-label="Batch for {p.bib}">
													{#each bs as b}<option value={b.id}>{b.name}</option>{/each}
												</select>
												<Button type="submit" size="sm" class="font-bold uppercase">Assign</Button>
											</form>
										{/if}
									</li>
								{:else}
									<li class="py-2 text-muted-foreground">{catQ ? 'No runner matches that.' : batchShown ? 'No runners assigned yet.' : 'Everyone is in a batch.'}</li>
								{/each}
							</ul>
						</div>
					</li>
				{:else}
					<li class="p-3 text-muted-foreground">No categories yet.</li>
				{/each}
			</ul>
			{#if data.archived.length}
				<div class="border-2 border-border bg-card p-3">
					<h2 class="font-bold tracking-wide uppercase">Archived</h2>
					<ul class="mt-2 divide-y-2 divide-border/15">
						{#each data.archived as c (c.id)}
							<li class="flex items-center justify-between py-2">
								<span class="font-bold uppercase text-muted-foreground">{c.name}</span>
								<form method="POST" action="?tab={tab}&/restoreCategory" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<Button type="submit" variant="outline" size="sm" class={small}>Restore</Button>
								</form>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
		{/if}

		<!-- STARTS: tick runners -> batch; start and release each batch; watch every category -->
		{#if tab === 'starts'}
		<div class="space-y-5">
			{#if form?.batchCreated}<p class="border-2 border-border bg-card p-3 font-bold" role="status">Batch {form.batchCreated.name} created with {form.batchCreated.n} runner(s). It is queued until you press Start.</p>{/if}
			{#if relMsg}<p class="font-bold {relMsg.startsWith('Not') ? 'text-destructive' : 'text-muted-foreground'}" role="status">{relMsg}</p>{/if}
			<!-- the live board's Start view: roll random runners into the next batch and start it from the board -->
			<form method="POST" action="?tab=starts&/setLiveStart" use:enhance={() => async ({ update }) => update({ reset: false })} class="flex flex-wrap items-center gap-3 border-2 border-border bg-card p-3">
				<label class="flex items-center gap-2 font-bold uppercase"><input type="checkbox" name="on" checked={data.liveStart.on} class="size-5" /> Start menu on the live board</label>
				<label class="flex items-center gap-2 font-bold uppercase">Runners per roll <input type="number" name="size" min="1" max="500" value={data.liveStart.size} class="h-10 w-20 border-2 border-border bg-card px-2" required /></label>
				<Button type="submit" variant="outline" class="h-10 border-2 font-bold uppercase">Save</Button>
				{#if data.liveStart.on}<a href="/e/{data.event.slug}?view=start" target="_blank" class="font-bold underline">Open the live Start view</a>{/if}
				{#if form?.liveStartSaved}<span class="text-muted-foreground" role="status">Saved ✓</span>{/if}
			</form>
			<!-- one card per category: what has started and what the public board shows. Click one to work on it -->
			<div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				{#each data.categories as c (c.id)}
					{@const bs = data.batches.filter((b) => b.category_id === c.id)}
					{@const st = countStates(data.participants.filter((p) => p.category_id === c.id).map((p) => p.bib))}
					{@const on = c.id === stShown?.id}
					<button type="button" aria-pressed={on} onclick={() => ((stCat = c.id), (stBatch = null), (picked = []), (stQ = ''))} class="space-y-0.5 border-2 border-border p-2.5 text-left text-sm {on ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">
						<span class="flex items-baseline justify-between gap-2 font-display text-2xl leading-none font-black uppercase"><span>{c.name}</span><span>{c.n}</span></span>
						<span class="block font-bold uppercase">{bs.length ? `${bs.filter((b) => b.gun_ms).length} of ${bs.length} batches started` : 'No batches yet'} · {data.participants.filter((p) => p.category_id === c.id && !p.batch_id).length} not batched</span>
						<span class="block">{st.finished} finished · {st.course} on course · {st.waiting} not started</span>
						<span class="block">Live board: {levelName[catLevel(c.id) as keyof typeof levelName]}</span>
					</button>
				{:else}
					<p class="border-2 border-border bg-card p-4 text-muted-foreground">No categories yet. Import participants first.</p>
				{/each}
			</div>

			{#if stShown}
				<section class="border-2 border-border bg-card">
					<h2 class="bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">New batch from {stShown.name}</h2>
					<form method="POST" action="?tab=starts&/createBatch" use:enhance={() => async ({ result, update }) => {
						await update();
						if (result.type !== 'success') return;
						picked = [];
						// open the tab of the batch just created
						const made = (result.data as { batchCreated?: { name: string } } | undefined)?.batchCreated?.name;
						stBatch = data.batches.find((b) => b.category_id === stShown?.id && b.name === made)?.id ?? null;
					}} class="space-y-3 p-4">
						<input type="hidden" name="category" value={stShown.id} />
						<!-- the selection lives in `picked`, so it survives searching; hidden ticked runners are still submitted -->
						{#each picked as id (id)}<input type="hidden" name="ids" value={id} />{/each}
						<div class="flex flex-wrap items-center gap-2">
							<Input bind:value={stQ} placeholder="Search by bib or name" class="h-11 w-full border-2 sm:w-72" aria-label="Search runners in {stShown.name}" />
							<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (picked = [...new Set([...picked, ...stFree.map((p) => p.id)])])}>Tick all shown ({stFree.length})</Button>
							<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (picked = [])}>Clear</Button>
							<Button type="submit" class="h-11 font-bold uppercase" disabled={!picked.length}>Create Batch {stNext} with {picked.length} runner{picked.length === 1 ? '' : 's'}</Button>
						</div>
						<ul class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
							{#each stFree as p (p.id)}
								{@const on = picked.includes(p.id)}
								<li><label class="flex h-full cursor-pointer items-center gap-2 border-2 border-border px-2.5 py-1.5 text-sm {on ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}"><input type="checkbox" checked={on} onchange={() => (picked = on ? picked.filter((x) => x !== p.id) : [...picked, p.id])} class="size-4 shrink-0" /><span class="min-w-0 leading-tight"><span class="block font-bold">{p.bib}</span><span class="block break-words">{p.name}</span></span></label></li>
							{:else}
								<li class="col-span-full py-2 text-muted-foreground">{stQ ? 'No free runner matches that.' : 'Everyone in this category is already in a batch.'}</li>
							{/each}
						</ul>
					</form>
				</section>

				<section class="border-2 border-border bg-card">
					<div class="flex flex-wrap items-center justify-between gap-2 bg-primary px-4 py-2 text-primary-foreground">
						<h2 class="font-display text-3xl font-black uppercase">{stShown.name} batches</h2>
						{#if stBatches.length}
							<Button type="button" variant="outline" size="sm" class="text-foreground" onclick={() => copy('batches', stBatches.map((b) => `BATCH ${b.name} ${stShown.name.slice(0, 3).toUpperCase()}\n${data.participants.filter((p) => p.batch_id === b.id).map((p) => p.bib).join('\n')}`).join('\n\n'))}>{copied === 'batches' ? 'Copied' : 'Copy batches as text'}</Button>
						{/if}
					</div>
					{#if stBatches.length}
						<div class="flex flex-wrap gap-2 border-b-2 border-border/15 p-3" role="tablist" aria-label="Batch">
							{#each stBatches as b (b.id)}
								<!-- a card per batch: its bibs show under the name, so a runner's batch is found at a glance -->
								<button type="button" role="tab" aria-selected={b.id === stBatchShown?.id} onclick={() => (stBatch = b.id)} class="flex w-56 flex-col gap-1 border-2 border-border p-3 text-left {b.id === stBatchShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}">
									<span class="flex items-baseline justify-between gap-2">
										<span class="font-display text-2xl leading-none font-black uppercase">Batch {b.name} <span class="text-lg">({b.n})</span></span>
										<span class="text-xs font-bold uppercase">{b.gun_ms ? '● Started' : 'Queued'}</span>
									</span>
									{#each data.participants.filter((p) => p.batch_id === b.id) as p (p.id)}
											<span class="border-t border-current/20 pt-1 leading-tight first:border-t-0 first:pt-0">
												<span class="flex items-baseline gap-2"><span class="text-base font-bold">{p.bib}</span><span class="min-w-0 text-sm font-bold break-words">{p.name}</span></span>
											</span>
										{:else}
											<span class="text-base font-bold">No runners</span>
										{/each}
								</button>
							{/each}
						</div>
					{/if}
					{#each stBatchShown ? [stBatchShown] : [] as b (b.id)}
						{@const members = data.participants.filter((p) => p.batch_id === b.id)}
						{@const st = countStates(members.map((p) => p.bib))}
						{@const own = batchLevel(b)}
						<div class="space-y-2 border-t-2 border-border/15 p-4 first:border-t-0">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div>
									<span class="text-xl font-bold uppercase">Batch {b.name} <span class="font-normal text-muted-foreground">({members.length} runner{members.length === 1 ? '' : 's'})</span></span>
									{#if members.length}<p class="font-bold break-words">{members.map((p) => p.bib).join(', ')}</p>{/if}
								</div>
								<span class="border-2 border-border px-2 py-1 font-bold uppercase {b.gun_ms ? 'bg-primary text-primary-foreground' : ''}">{b.gun_ms ? 'Started' : 'Queued'}</span>
							</div>
							<div class="flex flex-wrap items-center gap-3">{@render gunControls('batch', b.id, b.gun_ms, `${stShown.name} Batch ${b.name}`)}</div>
							<div class="space-y-1">
								<span class="font-bold uppercase">Live board: {levelName[(own ?? catLevel(stShown.id)) as keyof typeof levelName]}{own === null ? ' (follows category)' : ''}</span>
								{@render releaseButtons('batch', b.id, own, true)}
							</div>
							<p>{st.finished} finished · {st.course} on course · {st.waiting} not started</p>
							<ul class="flex flex-wrap gap-2" aria-label="Runners in Batch {b.name}">
								{#each members as p (p.id)}
									<li class="flex items-center gap-2 border-2 border-border/30 py-1 pr-1 pl-2" title={stateOf.get(p.bib) ?? ''}>
										<span class="font-bold">{p.bib}</span>
										<span class="leading-tight">{p.name}{#if p.members?.length}<span class="block text-xs text-muted-foreground">{p.members.map((m: { name: string }) => m.name).join(' · ')}</span>{/if}</span>
										{#if !b.gun_ms}
											<button type="button" onclick={() => (rmTarget = { id: p.id, bib: p.bib, name: p.name, batch: b.name })} class="size-7 font-bold hover:bg-accent" aria-label="Remove {p.bib} from Batch {b.name}">&times;</button>
										{/if}
									</li>
								{:else}
									<li class="text-muted-foreground">No runners in this batch.</li>
								{/each}
							</ul>
							<!-- add or force-move runners by bib, also into a started batch (they take its start time); several bibs separated by commas -->
								<form method="POST" action="?tab={tab}&/assignBatch" use:enhance={() => async ({ result, update }) => {
									await update();
									// say it where the click happened: the page-top error banner is off-screen here
									if (result.type === 'failure') toast.error(String(result.data?.error ?? 'Nothing moved'));
									else if (result.type === 'success') toast.success(result.data?.batchMoved ? `Moved to Batch ${b.name}` : `Added to Batch ${b.name}`);
								}} class="flex flex-wrap items-center gap-2">
									<input type="hidden" name="category" value={stShown.id} />
									<input type="hidden" name="batch" value={b.id} />
									<input type="hidden" name="move" value="1" />
									<Input name="bibs" list="free-{b.id}" placeholder="Add or move runner: bib (D12, D40…)" class="h-10 w-72 border-2" aria-label="Add or move runners to Batch {b.name}" required />
									<datalist id="free-{b.id}">{#each data.participants.filter((p) => p.category_id === stShown?.id && p.batch_id !== b.id) as p (p.id)}<option value={p.bib}>{p.name}{p.batch_id ? ` · now in Batch ${data.batches.find((x) => x.id === p.batch_id)?.name}` : ''}</option>{/each}</datalist>
									<Button type="submit" variant="outline" size="sm" class={small}>Add / move to Batch {b.name}</Button>
								</form>
							{#if !b.gun_ms}
								<form method="POST" action="?tab={tab}&/deleteBatch" use:enhance>
									<input type="hidden" name="id" value={b.id} />
									<Button type="button" onclick={(e) => confirmDeleteBatch(`${stShown.name} Batch ${b.name}`, members.length, false, e)} variant="outline" size="sm" class={small} title="Its runners go back to the list above">Delete batch</Button>
								</form>
							{/if}
						</div>
					{:else}
						<p class="p-4 text-muted-foreground">No batches yet. Tick runners above and create one.</p>
					{/each}
				</section>
			{/if}
		</div>
		{/if}

		{#if tab === 'starts'}
		<Dialog.Root open={rmTarget !== null} onOpenChange={(o) => !o && (rmTarget = null)}>
			{#if rmTarget}
				<Dialog.Content class="border-2 border-border sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Remove runner?</Dialog.Title>
						<Dialog.Description><b>{rmTarget.bib} {rmTarget.name}</b> will be taken out of Batch {rmTarget.batch} and go back to the free list.</Dialog.Description>
					</Dialog.Header>
					<form method="POST" action="?tab=starts&/removeFromBatch" use:enhance={() => async ({ update }) => { await update(); rmTarget = null; }} class="flex gap-2">
						<input type="hidden" name="id" value={rmTarget.id} />
						<Button type="submit" class="h-11 font-bold uppercase">Remove</Button>
						<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (rmTarget = null)}>Cancel</Button>
					</form>
				</Dialog.Content>
			{/if}
		</Dialog.Root>
		{/if}

		<!-- STATIONS -->
		{#if tab === 'stations'}
		<div class="space-y-4">
			<form method="POST" action="?tab={tab}&/addStation" use:enhance class="flex flex-wrap gap-2 border-2 border-border bg-card p-4">
				<Input name="name" placeholder="Station name (must match the name in the station app)" class="h-11 min-w-56 flex-1 border-2" required />
				<select name="kind" class="h-11 border-2 border-border bg-card px-3">
					<option value="start">Start</option>
					<option value="checkpoint">Checkpoint</option>
					<option value="finish">Finish</option>
				</select>
				<Button type="submit" class="h-11 font-bold uppercase">Add</Button>
			</form>
			<ul class="divide-y-2 divide-border border-2 border-border bg-card">
				{#each data.stations as s (s.id)}
					{@const lk = linkOf(s.name)}
					<li class="flex items-center justify-between p-3">
						<span class="flex items-center gap-3">
							<span class="border-2 border-border px-2 font-bold text-white uppercase" style="background:{kindColor(s.kind)}">{s.kind}</span>
							<span class="text-xl font-bold uppercase">{s.name}</span>
							<span class="ml-2 inline-flex items-center gap-2 font-bold uppercase" title={linkWho(s.name)}><span class="inline-block size-4 border-2 border-border" style="background:{linkColor(lk)}"></span>{linkWords[lk]}{linkWho(s.name) ? ` · ${linkWho(s.name)}` : ''}</span>
						</span>
						<div class="flex items-center gap-2">
							{#if s.kind === 'checkpoint'}
								{#each [['up', 'Up'], ['down', 'Down']] as [dir, label]}
									<form method="POST" action="?tab={tab}&/moveStation" use:enhance>
										<input type="hidden" name="id" value={s.id} />
										<input type="hidden" name="dir" value={dir} />
										<Button type="submit" variant="outline" size="sm" class={small}>{label}</Button>
									</form>
								{/each}
							{/if}
							<form method="POST" action="?tab={tab}&/deleteStation" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<Button type="button" onclick={(e) => confirmSubmit('Delete station?', `Delete ${s.name}? It is taken out of every category's course.`, 'Delete', e)} variant="outline" size="sm" class={small}>Delete</Button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
			{#if form?.coursesSaved}<p class="border-2 border-border bg-card p-3 font-bold">Courses saved.</p>{/if}
			<CourseEditor categories={data.categories} stations={data.stations} courses={data.courses} />
		</div>
		{/if}

		<!-- ROUTE -->
		{#if tab === 'route'}
			{#if form?.routeSaved}<p class="border-2 border-border bg-card p-3 font-bold">Route saved.</p>{/if}
			{#if form?.stationRouteSaved}<p class="border-2 border-border bg-card p-3 font-bold">Station saved.</p>{/if}
			<RouteEditor slug={data.event.slug} categories={data.categories} routes={data.routes} stationKm={data.stationKm} stations={data.stations} courses={data.courses} {tab} />
		{/if}

		<!-- AWARDS -->
		{#if tab === 'awards'}
		<div class="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Awards">
			{#each [['list', 'Awards'], ['settings', 'Settings']] as [id, label]}
				<button type="button" role="tab" aria-selected={awardsView === id} onclick={() => (awardsView = id as 'list' | 'settings')} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {awardsView === id ? 'bg-primary text-primary-foreground' : 'bg-card'}">{label}</button>
			{/each}
		</div>
		{#if awardsView === 'settings'}
		<AwardsEditor categories={data.categories} awards={data.awards} extraFields={data.extraFields} preview={data.awardPreview} people={data.participants} slug={data.event.slug} />
		{/if}
		{/if}

		<!-- PROGRESS: who has reached which station -->
		{#if tab === 'progress'}
		<div class="space-y-5">
			<div class="space-y-2 border-2 border-border bg-card p-4 print:hidden">
				<h2 class="flex flex-wrap items-baseline gap-3 font-display text-2xl font-black uppercase">What the public live board shows {#if relMsg}<span class="text-base font-bold tracking-wide {relMsg.startsWith('Not') ? 'text-destructive' : 'text-muted-foreground'}" role="status">{relMsg}</span>{/if}</h2>
				<p class="text-muted-foreground">Finishes stay off the live board until you release them. <b>Results pending</b> shows live progress and marks finishers as FINISHED with their start time, but holds back finish times, ranks and awards.</p>
				<div class="flex flex-wrap items-center gap-3 border-b-2 border-border/15 pb-3"><span class="w-40 font-bold uppercase">All categories</span>{@render releaseButtons('all', 0, allLevel)}</div>
				{#if progShown}
					{#each data.categories.filter((c) => c.id === progShown.id) as cat (cat.id)}
						<div class="flex flex-wrap items-center gap-3"><span class="w-40 font-display text-2xl leading-none font-black uppercase">{cat.name}</span>{@render releaseButtons('category', cat.id, catLevel(cat.id))}</div>
					{/each}
					{#if progBatches.length}
						<!-- one card per batch: its bibs, how many finished, what the board shows, and its own buttons -->
						<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
							{#each progBatches as b (b.id)}
								{@const own = batchLevel(b)}
								{@const shows = own ?? catLevel(b.category_id)}
								{@const bibs = data.participants.filter((p) => p.batch_id === b.id).map((p) => p.bib)}
								{@const st = countStates(bibs)}
								<li class="flex flex-col gap-2 border-2 p-3 {shows === 'released' ? 'border-start' : 'border-border'}">
									<button type="button" onclick={() => (progBatch = b.id)} class="text-left" title="Show only this batch in the table below">
										<span class="flex items-baseline justify-between gap-2">
											<span class="font-display text-2xl leading-none font-black uppercase">Batch {b.name} <span class="text-lg">({bibs.length})</span></span>
											<span class="text-xs font-bold uppercase">{b.gun_ms ? '● Started' : 'Queued'}</span>
										</span>
										<span class="mt-1 block font-bold break-words">{bibs.join(', ') || 'No runners'}</span>
										<span class="block text-sm text-muted-foreground">{st.finished} of {bibs.length} finished · {st.course} on course</span>
									</button>
									<span class="text-sm font-bold uppercase">Live board: <span class={shows === 'released' ? 'text-start' : ''}>{levelName[shows as keyof typeof levelName]}</span>{own === null ? ' (follows category)' : ''}</span>
									{@render releaseButtons('batch', b.id, own, true, true)}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
			<p class="text-muted-foreground print:hidden">Live: who has reached which station in each category. Times are the race time at that station (the start shows the clock time). A runner who has a later read but none at an earlier station on their course is flagged, so the missed read can be added on the Reads page. Their result is kept.</p>
			{#if data.progressData.length > 1}
				<div class="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Category">
					{#each data.progressData as c (c.id)}
						<button type="button" role="tab" aria-selected={c.id === progShown?.id} onclick={() => ((progCat = c.id), (progBatch = 'all'))} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {c.id === progShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">{c.name}</button>
					{/each}
				</div>
			{/if}
			{#if progBatches.length}
				<div class="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Batch">
					{#each [['all', 'All batches'], ...progBatches.map((b) => [b.id, b.name]), ['none', 'No batch']] as [id, label]}
						<button type="button" role="tab" aria-selected={id === progBatch} onclick={() => (progBatch = id as typeof progBatch)} class="h-11 border-2 border-border px-4 text-lg font-bold uppercase {id === progBatch ? 'bg-primary text-primary-foreground' : 'bg-card'}">{label}</button>
					{/each}
				</div>
			{/if}
			{#each progShown ? [progShown] : [] as c (c.id)}
				{@const flagged = progRows.filter((r) => r.missed.length).length}
				{@const byHand = progRows.reduce((n, r) => n + r.src.filter((k) => k && k !== 'rfid').length, 0)}
				{@const penalised = progRows.filter((r) => r.penalty)}
				{@const missedReads = progRows.reduce((n, r) => n + r.missed.length, 0)}
				{@const corrected = progRows.filter((r) => overrideOf(r.bib)).length}
				{@const pmin = (ms: number) => Math.round((ms / 60000) * 100) / 100}
				<h2 class="hidden font-display text-3xl font-black uppercase print:block">{data.event.name} · Progress · {c.name}{progBatch === 'all' || !progBatches.length ? '' : progBatch === 'none' ? ' · No batch' : ` · Batch ${progBatches.find((b) => b.id === progBatch)?.name ?? ''}`} <span class="text-base font-normal">printed {new Date(now).toLocaleString()}</span></h2>
				<section class="border-2 border-border bg-card print:border-0 print:[print-color-adjust:exact] print:[zoom:0.65]">
					<h3 class="flex flex-wrap items-baseline justify-between gap-2 bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">
						<span>{c.name}</span>
						<span class="text-base font-normal tracking-wide">{progRows.filter((r) => r.state === 'finished').length} finished · {progRows.filter((r) => r.start !== null).length} started · {progRows.length} registered{flagged ? ` · ${flagged} to check` : ''}</span>
						<button type="button" class="border-2 border-primary-foreground px-3 py-1 text-sm font-bold tracking-wide uppercase print:hidden" onclick={printProgress}>Print</button>
					</h3>
					<p class="border-b-2 border-border px-4 py-2 text-sm">Under each time: <b>RFID</b> = the reader, <b>Marshal tap</b> = a marshal's phone, <b>Station tap</b> = tapped on the station laptop, <b>Admin entry</b> = typed in the Reads tab, <b>Override</b> = finish time corrected by the admin. <b>{byHand}</b> read{byHand === 1 ? '' : 's'} here {byHand === 1 ? 'was' : 'were'} not from the reader.</p>
					{#key `${c.id}-${progBatch}`}<ProgressTable course={c.course} rows={progRows} category={c.name} flags pageSize={printing ? 0 : 20} still={printing} onOverride={(r) => openOverride({ bib: r.bib, name: r.name, finishAt: null })} onPenalty={(r) => openPenalty(r)} overridden={(bib) => !!overrideOf(bib)} release={runnerRelease} batchOf={progBatchCol} />{/key}
				</section>
				<!-- print only: the summary that closes the printed sheet -->
				<section class="hidden space-y-3 border-2 border-black p-4 text-black print:block print:break-inside-avoid">
					<h3 class="font-display text-2xl font-black uppercase">Summary · {c.name}</h3>
					<p><b>{progRows.length}</b> registered · <b>{progRows.filter((r) => r.start !== null).length}</b> started · <b>{progRows.filter((r) => r.state === 'on-course').length}</b> on course · <b>{progRows.filter((r) => r.state === 'not-started').length}</b> not started · <b>{progRows.filter((r) => r.state === 'finished').length}</b> finished · <b>{flagged}</b> to check</p>
					<table class="w-full border-collapse text-sm">
						<thead><tr class="border-b-2 border-black text-left"><th class="py-1">Station</th><th>Read</th><th>Missed</th><th>Hand-entered</th></tr></thead>
						<tbody>
							{#each c.course as s, i (s.id)}
								<tr class="border-b border-black/30">
									<td class="py-1 font-bold uppercase">{s.name}</td>
									<td>{progRows.filter((r) => (s.kind === 'start' ? r.start !== null || r.at[i] !== null : r.at[i] !== null)).length}</td>
									<td>{progRows.filter((r) => r.missed.includes(s.name)).length}</td>
									<td>{progRows.filter((r) => r.src[i] && r.src[i] !== 'rfid').length}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p><b>{flagged}</b> runner{flagged === 1 ? '' : 's'} missed at least one checkpoint · <b>{missedReads}</b> missed read{missedReads === 1 ? '' : 's'} in total · <b>{byHand}</b> read{byHand === 1 ? '' : 's'} not from the reader</p>
					{#if penalised.length}
						<div>
							<p><b>{penalised.length}</b> runner{penalised.length === 1 ? '' : 's'} with a penalty · <b>{pmin(penalised.reduce((n, r) => n + (r.penalty ?? 0), 0))} min</b> in total</p>
							<ul class="list-disc pl-5">
								{#each penalised as r (r.bib)}<li>{r.bib} {r.name} · +{pmin(r.penalty ?? 0)} min{data.participants.find((p) => p.bib === r.bib)?.penalty_note ? ` · ${data.participants.find((p) => p.bib === r.bib)?.penalty_note}` : ''}</li>{/each}
							</ul>
						</div>
					{/if}
					{#if corrected}<p><b>{corrected}</b> finish time{corrected === 1 ? '' : 's'} corrected by the admin</p>{/if}
					<div class="grid grid-cols-3 gap-6 pt-8 text-sm"><span class="border-t border-black pt-1">Prepared by</span><span class="border-t border-black pt-1">Checked by</span><span class="border-t border-black pt-1">Date and time: {new Date(now).toLocaleString()}</span></div>
				</section>
				<!-- per checkpoint: who has passed and who has not yet (the start counts a gun start too, like the table) -->
				<section class="border-2 border-border bg-card print:hidden">
					<h3 class="bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">By checkpoint</h3>
					<div class="grid gap-4 p-4 md:grid-cols-2">
						{#each c.course as s, i (s.id)}
							{@const passed = progRows.filter((r) => (s.kind === 'start' ? r.start !== null || r.at[i] !== null : r.at[i] !== null))}
							{@const waiting = progRows.filter((r) => !passed.includes(r))}
							<div class="border-2 border-border/15 p-3">
								<h4 class="font-display text-2xl font-black uppercase">{s.name} <span class="text-base font-normal text-muted-foreground">{passed.length} passed · {waiting.length} not yet</span></h4>
								<p class="mt-2 text-sm font-bold uppercase">Passed</p>
								<p class="break-words">{passed.length ? passed.map((r) => r.bib).join(', ') : '—'}</p>
								<p class="mt-2 text-sm font-bold uppercase">Not yet</p>
								<p class="break-words text-muted-foreground">{waiting.length ? waiting.map((r) => r.bib).join(', ') : '—'}</p>
							</div>
						{/each}
					</div>
				</section>
			{:else}
				<p class="border-2 border-border bg-card p-4 text-muted-foreground">No participants yet.</p>
			{/each}
		</div>
		{/if}

		<!-- RESULTS: ranked list per category, to read, print or export -->
		{#if tab === 'results' || (tab === 'awards' && awardsView === 'list')}
		{@const isRes = tab === 'results'}
		<div class="space-y-5">
			<div class="flex flex-wrap items-center gap-2 print:hidden">
				<a class="inline-flex h-11 items-center border-2 border-border bg-card px-5 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind={isRes ? 'results' : 'winners'}&mode=gun" download>Download CSV</a>
				{#if resSel === 'all'}<Button class="h-11 font-bold uppercase" onclick={() => window.print()}>Print all</Button>{/if}
				<p class="text-muted-foreground">{isRes ? 'Ranked as set under Categories.' : 'The podium for every award.'}</p>
			</div>
			{#if data.resultsData.length > 1}
				<div class="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Category">
					{#each [...data.resultsData.map((c) => [c.id, c.name] as const), ['all', 'All'] as const] as [id, label]}
						<button type="button" role="tab" aria-selected={id === (resSel ?? data.resultsData[0]?.id)} onclick={() => (resSel = id)} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {id === (resSel ?? data.resultsData[0]?.id) ? 'bg-primary text-primary-foreground' : 'bg-card'}">{label}</button>
					{/each}
				</div>
			{/if}
			<h2 class="hidden font-display text-4xl font-black uppercase print:block">{data.event.name} · {isRes ? 'Results' : 'Award list'}</h2>
			{#each resShown as c, i (c.id)}
				<section class="border-2 border-border bg-card print:break-inside-avoid-page {i ? 'print:break-before-page' : ''}">
					<h3 class="flex flex-wrap items-baseline justify-between gap-2 bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase print:text-black">
						<span>{c.name}</span>
						<span class="flex items-center gap-3">
							<span class="text-base font-normal tracking-wide">{c.rows.length} finished · {c.total} registered</span>
							{#if resSel !== 'all'}<button type="button" class="border-2 border-primary-foreground px-3 py-1 text-sm font-bold tracking-wide uppercase print:hidden" onclick={() => window.print()}>Print</button>{/if}
						</span>
					</h3>
					<p class="border-b-2 border-border/15 px-4 py-2 text-muted-foreground">Ranked by: {c.rankBy === 'finish' ? 'first across the finish line' : c.rankBy === 'chip' ? "shortest time from each runner's own start read" : 'shortest time from the category or batch start'}</p>
					{#if c.badStart}
						<p class="border-b-2 border-border/15 px-4 py-2 font-bold text-destructive" role="alert">{c.badStart} {c.badStart === 1 ? 'runner has' : 'runners have'} a finish at or before the start time, so no time — the start was probably set too late. Correct it on the Categories page; no reads were lost.</p>
					{/if}
					{#if c.noStart}
						<p class="border-b-2 border-border/15 px-4 py-2 font-bold text-destructive" role="alert">{c.noStart} {c.noStart === 1 ? 'runner has' : 'runners have'} crossed the finish but {c.noStart === 1 ? 'has' : 'have'} no start time — press Start for this category, or add their start read on the Reads page.</p>
					{/if}
					{#if isRes}
						<Table.Root>
							<Table.Header>
								<Table.Row>{#each ['Rank', 'Bib', 'Name', 'Gender', 'Age', 'Time', ''] as h}<Table.Head class="font-bold tracking-wide uppercase">{h}</Table.Head>{/each}</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each c.rows as r (r.bib)}
									<Table.Row class="print:break-inside-avoid">
										<Table.Cell class="font-display text-2xl font-black">{r.rank}</Table.Cell>
										<Table.Cell class="font-bold">{r.bib}</Table.Cell>
										<Table.Cell>{r.name || '—'}</Table.Cell>
										<Table.Cell>{genderLabel(r.gender) || '—'}</Table.Cell>
										<Table.Cell>{r.age ?? '—'}</Table.Cell>
										<Table.Cell class="font-bold tabular-nums">{fmt(r.time!)}</Table.Cell>
										<Table.Cell class="print:hidden">
											{#if r.overridden}
												{@const o = overrideOf(r.bib)}
												<span class="mr-2 border-2 border-destructive px-1 text-sm font-bold text-destructive uppercase" title={o ? `${o.reason} — ${o.by}` : ''}>Override</span>
												{#if o?.has_photo}<a class="mr-2 underline" href="/admin/{data.event.slug}/override-photo/{r.bib}" target="_blank" rel="noopener">Photo</a>{/if}
												<form method="POST" action="?tab={tab}&/clearFinishOverride" use:enhance class="inline"><input type="hidden" name="bib" value={r.bib} /><button class="underline">Remove</button></form>
											{:else}
												<button type="button" class="underline" onclick={() => openOverride(r)}>Override</button>
											{/if}
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row><Table.Cell colspan={7} class="p-4 text-muted-foreground">No finishers yet.</Table.Cell></Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{:else}
						<div class="grid gap-4 p-4 md:grid-cols-2 print:grid-cols-2">
							{#each c.awards as a (a.key)}
								<div class="border-2 border-border/15 p-3 print:break-inside-avoid">
									<h4 class="font-display text-2xl font-black uppercase">{a.name}</h4>
									<ol class="mt-1 divide-y divide-border/15">
										{#each a.winners as w (w.place + w.bib)}
											<li class="flex items-baseline gap-3 py-1"><span class="w-6 font-display text-xl font-black">{w.place}</span><span class="font-bold">{w.bib}</span><span class="flex-1">{w.name || '—'}</span><span class="font-bold tabular-nums">{fmt(w.time)}</span></li>
										{/each}
									</ol>
								</div>
							{:else}
								<p class="text-muted-foreground">No awards yet.</p>
							{/each}
						</div>
					{/if}
				</section>
			{:else}
				<p class="border-2 border-border bg-card p-4 text-muted-foreground">No categories with runners yet.</p>
			{/each}
		</div>
		{/if}

		<!-- TALLY: printable sheets to write finish times by hand, one batch per long bond page -->
		{#if tab === 'tally'}
		{@const sheets = groupTally(printable, data.batches, data.participants)}
		<div class="space-y-5">
			<div class="flex flex-wrap items-center gap-3 print:hidden">
				<Button class="h-11 font-bold uppercase" onclick={() => window.print()} disabled={!sheets.length}>Print tally sheets</Button>
				<p class="text-muted-foreground">One sheet per category and batch, runners by bib, packed onto each page (a batch is never split across pages unless it is longer than a page). Prints on long bond paper (8.5 &times; 13 in): pick that size in the print dialog if it is not already selected.</p>
			</div>
			{@render catPicker()}
			{#each sheets as s}
				<section class="border-2 border-border bg-card p-4 print:mb-4 print:break-inside-avoid print:border-0 print:p-0">
					<div class="mb-1 flex items-baseline justify-between gap-3">
						<div>
							<h2 class="font-display text-xl leading-none font-black uppercase">{s.category} &middot; {s.batch} <span class="font-sans text-xs font-bold">&mdash; {data.event.name}</span></h2>
						</div>
						<div class="flex items-baseline gap-4 text-xs font-bold whitespace-nowrap uppercase"><span>Checkpoint #: <span class="inline-block w-24 border-b border-black align-baseline">&nbsp;</span></span><span>{s.runners.length} runners</span></div>
					</div>
					<table class="w-full table-fixed border-collapse border-2 border-black text-left">
						<thead>
							<tr class="border-b-2 border-black bg-black/5 text-xs font-bold uppercase">
								<th class="border border-black w-8 px-1 py-0.5">#</th><th class="border border-black w-16 px-1 py-0.5">Bib</th><th class="border border-black px-1 py-0.5">Name of participant</th><th class="border border-black w-60 px-1 py-0.5">Time (write here)</th>
							</tr>
						</thead>
						<tbody>
							{#each s.runners as r, n (r.bib)}
								<tr class="h-[0.3in] border-b border-black print:break-inside-avoid">
									<td class="border border-black px-1 text-xs">{n + 1}</td>
									<td class="font-display border border-black px-1 text-lg leading-none font-black">{r.bib}</td>
									<td class="border border-black px-1 text-sm leading-tight font-bold break-words uppercase">{r.name || '—'}</td>
									<td class="border border-black"></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{:else}
				<p class="text-muted-foreground">{printCats.length ? 'No runners in the selected categories.' : 'No participants yet.'}</p>
			{/each}
		</div>
		{/if}

		<!-- BIB LIST: organizer checklist, tick each runner once registered and their bib is written -->
		{#if tab === 'bibs'}
		<!-- teams (duo/relay) expand to one row per runner, all under the team's bib -->
		{@const batchSheets = groupTally(printable,data.batches, data.participants.flatMap((p) => (p.members?.length ? p.members.map((m: { name: string }) => ({ ...p, name: m.name })) : [p])))}
		{@const sheets = bibView === 'category' ? byCategory(batchSheets) : batchSheets}
		<div class="space-y-5">
			<div class="flex flex-wrap items-center gap-3 print:hidden">
				<Button class="h-11 font-bold uppercase" onclick={() => window.print()} disabled={!sheets.length}>Print bib list</Button>
				<div class="flex gap-2" role="group" aria-label="List by">
					{#each [['batch', 'Per batch'], ['category', 'Per category']] as [id, label]}
						<button type="button" aria-pressed={bibView === id} class="h-11 border-2 border-border px-4 font-bold uppercase {bibView === id ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}" onclick={() => (bibView = id as 'batch' | 'category')}>{label}</button>
					{/each}
				</div>
				<p class="text-muted-foreground">Checklist for the organizer: tick each runner once they have registered and their bib is written. {bibView === 'batch' ? 'One list per category and batch, packed onto each page (a batch is never split across pages unless it is longer than a page)' : 'One list per category, starting on a new page'}, runners by bib. Prints on long bond paper (8.5 &times; 13 in).</p>
			</div>
			{@render catPicker()}
			{#each sheets as s, i}
				<section class="border-2 border-border bg-card p-4 print:border-0 print:p-0 {bibView === 'category' ? `print:break-inside-auto ${i ? 'print:break-before-page' : ''}` : 'print:mb-4 print:break-inside-avoid'}">
					<div class="mb-1 flex items-baseline justify-between gap-3">
						<h2 class="font-display text-xl leading-none font-black uppercase">{s.category}{s.batch ? ` · ${s.batch}` : ''} <span class="font-sans text-xs font-bold">&mdash; {data.event.name}</span></h2>
						<span class="text-xs font-bold whitespace-nowrap uppercase">{s.runners.length} runners</span>
					</div>
					<table class="w-full table-fixed border-collapse border-2 border-black text-left">
						<thead>
							<tr class="border-b-2 border-black bg-black/5 text-xs font-bold uppercase">
								<th class="border border-black w-10 px-1 py-0.5 text-center">&check;</th><th class="border border-black w-8 px-1 py-0.5">#</th><th class="border border-black w-20 px-1 py-0.5">Bib</th><th class="border border-black px-1 py-0.5">Name of participant</th><th class="border border-black w-48 px-1 py-0.5">Remarks</th>
							</tr>
						</thead>
						<tbody>
							{#each s.runners as r, n (n)}
								<tr class="h-[0.3in] border-b border-black print:break-inside-avoid">
									<td class="border border-black text-center"><span class="inline-block size-4 border-2 border-black align-middle"></span></td>
									<td class="border border-black px-1 text-xs">{n + 1}</td>
									<td class="font-display border border-black px-1 text-lg leading-none font-black">{r.bib}</td>
									<td class="border border-black px-1 text-sm leading-tight font-bold break-words uppercase">{r.name || '—'}</td>
									<td class="border border-black"></td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div class="mt-2 flex justify-end gap-6 text-xs font-bold uppercase">
						<span>Checked: <span class="inline-block w-12 border-b border-black">&nbsp;</span> / {s.runners.length}</span>
						<span>Checked by: <span class="inline-block w-40 border-b border-black">&nbsp;</span></span>
					</div>
				</section>
			{:else}
				<p class="text-muted-foreground">{printCats.length ? 'No runners in the selected categories.' : 'No participants yet.'}</p>
			{/each}
		</div>
		{/if}

		<!-- BATCH RELEASE TALLY: blank A4 sheet, filled in by hand as each batch is sent off -->
		{#if tab === 'release'}
		<div class="space-y-5">
			<div class="flex flex-wrap items-center gap-3 print:hidden">
				<Button class="h-11 font-bold uppercase" onclick={() => window.print()}>Print batch release tally</Button>
				<label class="flex items-center gap-2 font-bold uppercase">Rows <input type="number" min="1" max="200" bind:value={releaseRows} class="h-11 w-20 border-2 border-border bg-card px-2" /></label>
				<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (releaseRows = RELEASE_ROWS_A4)}>Fit one page</Button>
				<p class="text-muted-foreground">A blank sheet to fill in by hand. {RELEASE_ROWS_A4} rows fill one A4 page; more rows continue on the next page. Pick A4 in the print dialog if it is not already selected.</p>
			</div>
			<section class="border-2 border-border bg-card p-4 print:border-0 print:p-0">
				<div class="mb-2 flex items-baseline justify-between gap-4">
					<h2 class="font-display text-2xl leading-none font-black uppercase">Batch release tally <span class="font-sans text-xs font-bold">&mdash; {data.event.name}</span></h2>
					<span class="text-sm font-bold whitespace-nowrap uppercase">Category: <span class="inline-block w-56 border-b-2 border-black align-baseline">&nbsp;</span></span>
				</div>
				<table class="w-full table-fixed border-collapse border-2 border-black text-left">
					<thead>
						<tr class="border-b-2 border-black bg-black/5 text-xs font-bold uppercase">
							<th class="w-20 border border-black px-1 py-1">Batch</th><th class="border border-black px-1 py-1">Bibs</th><th class="w-32 border border-black px-1 py-1">Time</th><th class="w-44 border border-black px-1 py-1">Signature</th>
						</tr>
					</thead>
					<tbody>
						{#each { length: Math.max(1, Math.min(200, Math.floor(releaseRows) || RELEASE_ROWS_A4)) } as _, n (n)}
							<tr class="h-[0.45in] border-b border-black print:break-inside-avoid"><td class="border border-black"></td><td class="border border-black"></td><td class="border border-black"></td><td class="border border-black"></td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		</div>
		{/if}

		<!-- READS: manual corrections -->
		{#if tab === 'reads'}
		<div class="space-y-4">
			<form method="POST" action="?tab={tab}&/manualRead" use:enhance={manualTime} class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Add a read by hand</h2>
				<p class="text-muted-foreground">For a missed tag, or to test the board before the event. Pick a runner and a station; leave the time empty to use now.</p>
				<div class="flex flex-wrap items-end gap-2">
					<div class="w-32"><Label class={lbl} for="mb">Bib</Label><Input id="mb" name="bib" class="h-11 border-2" required /></div>
					<div class="w-56">
						<Label class={lbl} for="ms">Station</Label>
						<select id="ms" name="station" class={field} required>
							{#each data.stations as s}<option value={s.id}>{s.name} ({s.kind})</option>{/each}
						</select>
					</div>
					<div class="w-60"><Label class={lbl} for="mt">Time (optional)</Label><Input id="mt" name="time" type="datetime-local" step="1" class="h-11 border-2" /></div>
					<div class="w-60"><Label class={lbl} for="mr">Reason (optional)</Label><Input id="mr" name="reason" maxlength={200} placeholder="e.g. tag fell off" class="h-11 border-2" /></div>
					<Button type="submit" class="h-11 font-bold uppercase">Add read</Button>
				</div>
			</form>

			<div class="border-2 border-border bg-card">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-primary hover:bg-primary">
							{#each ['Time', 'Station', 'Bib', 'Name', 'Source', ''] as h}
								<Table.Head class="font-bold tracking-wide text-primary-foreground uppercase">{h}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.reads as r (r.id)}
							<Table.Row class={r.voided ? 'text-muted-foreground line-through' : ''}>
								<Table.Cell class="whitespace-nowrap">{new Date(r.read_at_ms).toLocaleString()}</Table.Cell>
								<Table.Cell>{r.station ?? '—'}</Table.Cell>
								<Table.Cell class="font-display text-2xl font-black">{r.bib ?? '?'}</Table.Cell>
								<Table.Cell>{r.name || (r.bib ? '—' : r.tag)}</Table.Cell>
								<Table.Cell><b class={r.source === 'rfid' ? 'text-muted-foreground' : ''}>{sourceLabel(r.source)}</b>{#if r.device_id && !['MANUAL', 'MANUAL-CENTRAL'].includes(r.device_id)}<span class="block text-xs text-muted-foreground">{r.device_id}</span>{/if}</Table.Cell>
								<Table.Cell class="text-right">
									<form method="POST" action="?tab={tab}&/voidRead" use:enhance class="inline">
										<input type="hidden" name="id" value={r.id} />
										<input type="hidden" name="voided" value={r.voided ? 'false' : 'true'} />
										<input name="reason" maxlength="200" placeholder="Reason" aria-label="Reason" class="mr-1 h-8 w-28 border-2 border-border bg-card px-2 text-sm" />
										<Button type="submit" variant="outline" size="sm" class={small}>{r.voided ? 'Restore' : 'Void'}</Button>
									</form>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row><Table.Cell colspan={6} class="p-6 text-muted-foreground">No reads yet.</Table.Cell></Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				<a class="inline-flex h-11 items-center border-2 border-border bg-card px-5 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=reads" download>Download all reads (CSV)</a>
				<p class="text-muted-foreground">Every read, including voided ones, with exact times. Good as a backup or for disputes.{data.reads.length === 300 ? ' The list above shows only the latest 300.' : ''}</p>
			</div>

			<form method="POST" action="?tab={tab}&/clearReads" use:enhance class="flex flex-wrap items-end gap-2 border-2 border-destructive bg-card p-4">
				<div class="min-w-64 flex-1">
					<h2 class="font-display text-3xl font-black text-destructive uppercase">Clear all reads</h2>
					<p class="text-muted-foreground">Deletes every read for this event, for wiping test data before the start. Participants and stations stay. Station apps still hold their own copies and will not re-send them, but exports and the board start empty. Export first if unsure.</p>
				</div>
				<div class="w-40"><Label class={lbl} for="cc">Type CLEAR</Label><Input id="cc" name="confirm" class="h-11 border-2" autocomplete="off" /></div>
				<Button type="submit" class="h-11 border-2 border-border bg-destructive font-bold text-white uppercase hover:bg-destructive/90">Clear reads</Button>
			</form>
		</div>
		{/if}

		<!-- STATION DATA: what each station has sent -->
		{#if tab === 'data'}
		<div class="space-y-4">
			<section class="space-y-3 border-2 border-border bg-card p-4" aria-label="Station laptops">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="font-display text-3xl font-black uppercase">Station laptops</h2>
					<span class="flex items-center gap-2 font-bold uppercase" role="status"><span class="inline-block size-4 border-2 border-border" style="background:{monitor.connected ? 'var(--start)' : 'var(--finish)'}"></span>{monitor.connected ? 'Live: updates as they arrive' : 'Reconnecting…'}</span>
				</div>
				{#each laptops as l (l.laptop_id)}
					{@const st = linkState(l.last_seen_ms, now)}
					<div class="border-2 border-border/40">
						<div class="flex flex-wrap items-center gap-3 px-3 py-2">
							<span class="inline-flex items-center border-2 border-border px-2 py-0.5 font-bold uppercase {st === 'late' ? 'text-black' : 'text-white'}" style="background:{linkColor(st)}">{linkWords[st]}</span>
							<span class="text-2xl font-bold uppercase">{l.laptop_name}</span>
							<span class="text-muted-foreground">last heartbeat {ago(l.last_seen_ms, now)}{l.app_version ? ` · app v${l.app_version}` : ''}</span>
						</div>
						<div class="space-y-1 border-t-2 border-border/20 px-3 py-2">
							{#each l.payload.stations ?? [] as ls}
								<p class="flex flex-wrap gap-x-4">
									<b class="min-w-32 uppercase">{ls.name}</b>
									<span class={ls.readersTotal && !ls.readersOnline ? 'font-bold text-destructive' : ''}>readers online {ls.readersOnline} of {ls.readersTotal}</span>
									<span class={ls.pending ? 'font-bold' : 'text-muted-foreground'}>{ls.pending} waiting to upload</span>
									<span class="text-muted-foreground">last read {ago(ls.lastReadMs, now)}</span>
								</p>
							{:else}
								<p class="text-muted-foreground">No stations set up in the station app yet.</p>
							{/each}
							<p class={clockWarning(l.clock_skew_ms) ? 'font-bold text-destructive' : 'text-muted-foreground'}>
								{#if clockWarning(l.clock_skew_ms)}Clock is off by {(Math.abs(Number(l.clock_skew_ms)) / 1000).toFixed(1)} s ({Number(l.clock_skew_ms) > 0 ? 'behind' : 'ahead of'} the server). Its read times will be wrong by that much. Set the laptop's clock to automatic.{:else}Clock in sync with the server{/if}
							</p>
							{#if l.payload.lastError}<p class="font-bold text-destructive">Reports a problem: {l.payload.lastError}</p>{/if}
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground">No station laptop has checked in yet. In the station app, Setup &rarr; Central app, press Save and connect. A laptop appears here within a few seconds and shows Online while it keeps checking in (every 5 seconds).</p>
				{/each}
				<p class="text-sm text-muted-foreground">Online = a heartbeat in the last 15 seconds. Late = 15 to 45 seconds. Offline = longer. A laptop that goes quiet is shown even if no tags are being read.</p>
			</section>

			<form method="POST" action="?tab={tab}&/uploadReads" enctype="multipart/form-data" use:enhance class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Upload a station file</h2>
				<p class="text-muted-foreground">For a laptop that could not connect during the race. In the station app: Results &rarr; Export &rarr; All reads (CSV or JSON), or Setup &rarr; Export this station. Reads already received are skipped, so uploading the same file twice, or a file that overlaps what was sent live, adds nothing twice.</p>
				<div class="flex flex-wrap items-end gap-2">
					<input type="file" name="file" accept=".csv,.json,text/csv,application/json" required class="h-11 min-w-0 flex-1 border-2 border-border bg-card px-3 py-2" aria-label="Station app export file" />
					<Button type="submit" class="h-11 font-bold uppercase">Upload reads</Button>
				</div>
			</form>

			{#if sd.unknown.length}
				<div class="space-y-3 border-2 border-destructive bg-card p-4" role="alert">
					<h2 class="font-display text-3xl font-black text-destructive uppercase">Reads that match no station</h2>
					<p>These arrived under a station name that is not on the Stations page, so they are stored but <b>do not count toward results</b>. Add a station with exactly that name and they are counted straight away.</p>
					{#each sd.unknown as u}
						<div class="flex flex-wrap items-center justify-between gap-2 border-t-2 border-border/20 pt-2">
							<span><b class="text-xl">{u.name ? `"${u.name}"` : '(no station name sent)'}</b> &middot; {u.n} reads &middot; last {ago(u.last_in_ms, now)}</span>
							{#if u.name}
								<form method="POST" action="?tab={tab}&/addStation" use:enhance class="flex gap-2">
									<input type="hidden" name="name" value={u.name} />
									<select name="kind" class="h-11 border-2 border-border bg-card px-3">
										<option value="checkpoint">Checkpoint</option>
										<option value="start">Start</option>
										<option value="finish">Finish</option>
									</select>
									<Button type="submit" class="h-11 font-bold uppercase">Add as station</Button>
								</form>
							{:else}
								<span class="text-muted-foreground">In the station app, assign the reader to a station.</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="border-2 border-border bg-card">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-primary hover:bg-primary">
							{#each ['Station', 'Reads', 'Runners', 'Voided', 'Not in roster', 'Last data received', 'Laptop link', 'Devices', ''] as h}
								<Table.Head class="font-bold tracking-wide text-primary-foreground uppercase">{h}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sd.stations as s (s.id)}
							<Table.Row>
								<Table.Cell>
									<span class="flex items-center gap-2">
										<span class="border-2 border-border px-1 text-sm font-bold text-white uppercase" style="background:{kindColor(s.kind)}">{s.kind}</span>
										<span class="text-xl font-bold uppercase">{s.name}</span>
									</span>
								</Table.Cell>
								<Table.Cell class="font-display text-3xl font-black">{s.total}</Table.Cell>
								<Table.Cell>{s.runners}</Table.Cell>
								<Table.Cell>{s.voided || '—'}</Table.Cell>
								<Table.Cell class={s.unmatched ? 'font-bold text-destructive' : ''}>{s.unmatched || '—'}</Table.Cell>
								<Table.Cell class="whitespace-nowrap">{ago(s.last_in_ms, now)}</Table.Cell>
								<Table.Cell class="whitespace-nowrap">
									{@const lk = linkOf(s.name)}
									<span class="inline-flex items-center gap-2 font-bold uppercase"><span class="inline-block size-4 border-2 border-border" style="background:{linkColor(lk)}"></span>{linkWords[lk]}</span>
								</Table.Cell>
								<Table.Cell>{s.devices.length ? s.devices.map((d: { device_id: string }) => d.device_id || '?').join(', ') : '—'}</Table.Cell>
								<Table.Cell class="text-right"><a href="/admin/{data.event.slug}/station/{s.id}" class="inline-flex h-9 items-center border-2 border-border bg-card px-3 font-bold uppercase hover:bg-accent">View reads</a></Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row><Table.Cell colspan={8} class="p-6 text-muted-foreground">No stations yet. Add them on the Stations page.</Table.Cell></Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<p class="text-muted-foreground">
				<b>Runners</b> = different people read at that station. <b>Not in roster</b> = reads whose tag matches no participant (check tags on the Participants page). Refreshes by itself every few seconds.
			</p>
		</div>
		{/if}

		<!-- CONNECT -->
		{#if tab === 'connect'}
		<div class="space-y-4">
			<div class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Connect a station laptop</h2>
				<ol class="list-decimal space-y-1 pl-6 text-lg">
					<li>{#if data.publicUrl}Make sure the station laptop has an <b>internet connection</b> (venue WiFi or a phone hotspot).{:else}Put the station laptop on the <b>same WiFi</b> as this laptop.{/if}</li>
					<li>In the station app open <b>Setup &rarr; Central app</b>.</li>
					<li>Paste the <b>connection code</b> below and press <b>Fill from code</b>, then <b>Save and connect</b>.</li>
					<li>Name the station's stations exactly like on the Stations page (<b>{data.stations.map((s) => s.name).join(', ') || 'none yet'}</b>).</li>
				</ol>
			</div>

			{#if data.publicUrl}
				<p class="border-2 border-border bg-card p-4 text-lg">This app is hosted at <b>{data.publicUrl}</b>. Station laptops reach it over the internet, so there is no shared WiFi or address to pick.</p>
			{:else if !data.addresses.length}
				<p class="border-2 border-destructive p-3 font-bold text-destructive">This laptop has no network address. Connect it to the WiFi first.</p>
			{:else}
				<div class="space-y-2 border-2 border-border bg-card p-4">
					<h3 class="font-bold tracking-wide uppercase">This laptop's address</h3>
					{#each data.addresses as a, i}
						<label class="flex items-center gap-3 text-lg">
							<input type="radio" name="addr" checked={addrIdx === i} onchange={() => (addrIdx = i)} class="size-5" />
							<span class="font-bold">{a.ip}</span>
							<span class="text-muted-foreground">{a.name}{a.virtual ? ' · virtual adapter, probably not the WiFi' : ''}</span>
						</label>
					{/each}
					<p class="text-muted-foreground">Pick the one on the venue WiFi (usually 192.168.x.x or 10.x.x.x).</p>
				</div>
			{/if}

			{#if data.apiKey}
				<div class="space-y-3 border-2 border-border bg-card p-4">
					<h3 class="font-bold tracking-wide uppercase">Connection code (paste into the station app)</h3>
					<code class="block border-2 border-border bg-muted p-3 break-all select-all">{code}</code>
					<div class="flex flex-wrap items-center gap-2">
						<Button class="h-11 font-bold uppercase" onclick={() => copy('Connection code copied', code)}>Copy code</Button>
						{#if copied}<span class="font-bold" role="status">{copied}</span>{/if}
					</div>
				</div>

				<div class="grid gap-3 border-2 border-border bg-card p-4 md:grid-cols-3">
					{#each [['Address', baseUrl], ['Event name', data.event.slug], ['API key', data.apiKey]] as [label, value]}
						<div class="min-w-0 space-y-1">
							<p class="font-bold tracking-wide uppercase">{label}</p>
							<code class="block border-2 border-border bg-muted p-2 text-sm break-all select-all">{value}</code>
							<Button variant="outline" size="sm" class={small} onclick={() => copy(label + ' copied', value)}>Copy</Button>
						</div>
					{/each}
				</div>
				<div class="space-y-3 border-2 border-border bg-card p-4">
					<h3 class="font-bold tracking-wide uppercase">Marshal tagging link (open on a phone)</h3>
					<p>Send this to a marshal at a checkpoint or the finish. They pick their station, then tap each runner as they arrive. Taps become reads like the readers' own.</p>
					<code class="block border-2 border-border bg-muted p-3 break-all select-all">{marshalUrl}</code>
					<div class="flex flex-wrap items-center gap-2">
						<Button class="h-11 font-bold uppercase" onclick={() => copy('Marshal link copied', marshalUrl)}>Copy link</Button>
						<a href="/m/{data.event.slug}?k={data.apiKey}" target="_blank" rel="noreferrer"><Button variant="outline" class="h-11 border-2 font-bold uppercase">Open</Button></a>
					</div>
					<p class="text-muted-foreground">Anyone with this link can tag runners, so give it only to your marshals. Rotating the key below stops the old links and the station laptops alike.</p>
				</div>
			{:else}
				<p class="border-2 border-border bg-card p-3 font-bold">This event has no key to show yet. Rotate the key to create one.</p>
			{/if}

			<div class="space-y-3 border-2 border-border bg-card p-4">
				<h3 class="font-bold tracking-wide uppercase">Station keys (one per laptop)</h3>
				<p class="text-muted-foreground">With the shared key above, a read cannot be traced to a laptop. Make a key for each station laptop and paste it as that laptop's API key. Every read it sends is then marked with it, and one laptop can be cut off alone.</p>
				<form method="POST" action="?tab={tab}&/createStationKey" use:enhance class="flex flex-wrap items-end gap-2">
					<div class="w-64"><Label class={lbl} for="skl">Laptop name</Label><Input id="skl" name="label" maxlength={60} placeholder="e.g. Finish laptop" class="h-11 border-2" required /></div>
					<Button type="submit" class="h-11 font-bold uppercase">Make key</Button>
				</form>
				{#if form?.stationKey}
					<div class="space-y-1 border-2 border-border bg-muted p-3">
						<p class="font-bold">Key for {form.stationKey.label} - copy it now, it is not shown again:</p>
						<code class="block text-sm break-all select-all">{form.stationKey.key}</code>
						<Button variant="outline" size="sm" class={small} onclick={() => copy('Station key copied', form.stationKey.key)}>Copy</Button>
					</div>
				{/if}
				{#each data.stationKeys as k (k.id)}
					<div class="flex flex-wrap items-center gap-3 border-t-2 border-border pt-2 {k.revoked ? 'text-muted-foreground line-through' : ''}">
						<span class="min-w-40 font-bold">{k.label}</span>
						<span>{k.last_used_ms ? 'last used ' + new Date(k.last_used_ms).toLocaleString() : 'never used'}</span>
						{#if !k.revoked}
							<form method="POST" action="?tab={tab}&/revokeStationKey" use:enhance><input type="hidden" name="id" value={k.id} /><Button type="submit" variant="outline" size="sm" class={small}>Revoke</Button></form>
						{:else}<span class="no-underline">revoked</span>{/if}
					</div>
				{/each}
				<form method="POST" action="?tab={tab}&/setRequireStationKeys" use:enhance class="flex flex-wrap items-center gap-3 border-t-2 border-border pt-2">
					<input type="hidden" name="on" value={data.requireKeys ? 'false' : 'true'} />
					<Button type="submit" variant="outline" class={small}>{data.requireKeys ? 'Stop requiring station keys' : 'Require station keys'}</Button>
					<p class="min-w-64 flex-1 text-muted-foreground">{data.requireKeys ? 'On: reader and station-tap uploads are refused unless they use a station key. Marshal phones are not affected.' : 'Off: the shared key still works for every laptop. Turn on once each laptop has its own key.'}</p>
				</form>
			</div>

			<form method="POST" action="?tab={tab}&/rotateKey" use:enhance class="flex flex-wrap items-center gap-3 border-2 border-border bg-card p-4">
				<Button type="button" onclick={(e) => confirmSubmit('Rotate key?', 'Every station and marshal phone stops uploading at once, until each one gets the new code. Only do this if the key has leaked.', 'Rotate key', e)} class="h-11 border-2 border-border bg-destructive font-bold text-white uppercase hover:bg-destructive/90">Rotate key</Button>
				<p class="min-w-64 flex-1 text-muted-foreground">Makes a new key. Stations using the old key stop uploading until you paste the new code.</p>
			</form>
			{#if !data.publicUrl}<p class="text-muted-foreground">Admin pages open only on this laptop at <code>http://localhost:{data.port}</code>. Stations and phones use the address above.</p>{/if}
		</div>
		{/if}

	{@render overridePanel()}

	<Dialog.Root open={batchDlg !== null} onOpenChange={(o) => !o && (batchDlg = null)}>
		<Dialog.Content class="border-2 border-border sm:max-w-md">
			{#if batchDlg && dlgCat}
				<Dialog.Header>
					<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">{batchDlg.kind === 'add' ? 'Add batch' : batchDlg.kind === 'find' ? 'Find runner' : 'Assign runners'}</Dialog.Title>
					<Dialog.Description>{dlgCat.name}</Dialog.Description>
				</Dialog.Header>
				{#if form?.error}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}
				{#if batchDlg.kind === 'add'}
					<form method="POST" action="?tab={tab}&/addBatch" use:enhance={batchEnhance} class="space-y-4">
						<input type="hidden" name="category" value={batchDlg.cat} />
						<div><Label class={lbl} for="bn">Batch name</Label><Input id="bn" name="name" placeholder="e.g. Batch 1" class="h-11 border-2" required /></div>
						<Button type="submit" class="h-11 w-full font-bold uppercase">Add batch</Button>
					</form>
				{:else if batchDlg.kind === 'find'}
					<div class="space-y-3">
						<div><Label class={lbl} for="fq">Bib or name</Label><Input id="fq" bind:value={findQ} class="h-11 border-2" autocomplete="off" /></div>
						<ul class="max-h-72 divide-y-2 divide-border/15 overflow-y-auto">
							{#each found as p (p.id)}
								{@const mine = dlgBatches.find((b) => b.id === p.batch_id)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-2">
									<span><span class="font-bold">{p.bib}</span> {p.name}<br /><span class="text-sm font-bold uppercase {mine ? '' : 'text-muted-foreground'}">{mine ? `Batch ${mine.name}` : 'Not assigned'}</span></span>
									{#if mine}
										<form method="POST" action="?tab={tab}&/removeFromBatch" use:enhance>
											<input type="hidden" name="id" value={p.id} />
											<Button type="submit" variant="outline" size="sm" class={small}>Remove</Button>
										</form>
									{:else}
										<form method="POST" action="?tab={tab}&/assignBatch" use:enhance class="flex items-center gap-1">
											<input type="hidden" name="category" value={batchDlg.cat} />
											<input type="hidden" name="bibs" value={p.bib} />
											<select name="batch" class="h-9 border-2 border-border bg-card px-2 text-sm" aria-label="Batch for {p.bib}">
												{#each dlgBatches as b}<option value={b.id}>{b.name}</option>{/each}
											</select>
											<Button type="submit" size="sm" class="font-bold uppercase">Assign</Button>
										</form>
									{/if}
								</li>
							{:else}
								<li class="py-2 text-muted-foreground">{findQ.trim() ? 'No runner in this category matches.' : 'Type a bib or name.'}</li>
							{/each}
						</ul>
					</div>
				{:else}
					<form method="POST" action="?tab={tab}&/assignBatch" use:enhance={batchEnhance} class="space-y-4">
						<input type="hidden" name="category" value={batchDlg.cat} />
						<div>
							<Label class={lbl} for="ab">Assign to</Label>
							<select id="ab" name="batch" class={field}>
								{#each dlgBatches as b}<option value={b.id}>{b.name}</option>{/each}
								<option value="">No batch</option>
							</select>
						</div>
						<div><Label class={lbl} for="ar">Bibs (e.g. 101-150, 160)</Label><Input id="ar" name="bibs" class="h-11 border-2" required /></div>
						<Button type="submit" class="h-11 w-full font-bold uppercase">Assign</Button>
					</form>
				{/if}
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={importOpen}>
		<Dialog.Content class="max-h-[90vh] overflow-y-auto border-2 border-border sm:max-w-3xl">
			<Dialog.Header>
				<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Import participants</Dialog.Title>
				<Dialog.Description>Add runners by bib numbers, from a CSV file, or one at a time.</Dialog.Description>
			</Dialog.Header>
			{#if importError}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{importError}</p>{/if}
			<div class="space-y-4">
			<div class="flex flex-wrap gap-2">
						<Button variant={importMode === 'bibs' ? 'default' : 'outline'} class="h-11 border-2 font-bold uppercase" onclick={() => (importMode = 'bibs')}>Bib numbers into a category</Button>
						<Button variant={importMode === 'csv' ? 'default' : 'outline'} class="h-11 border-2 font-bold uppercase" onclick={() => (importMode = 'csv')}>Full detail (CSV)</Button>
						<Button variant={importMode === 'one' ? 'default' : 'outline'} class="h-11 border-2 font-bold uppercase" onclick={() => (importMode = 'one')}>Add one runner</Button>
						<Button variant={importMode === 'tags' ? 'default' : 'outline'} class="h-11 border-2 font-bold uppercase" onclick={() => (importMode = 'tags')}>Assign RFID tags (CSV)</Button>
					</div>

					{#if importMode === 'bibs'}
						<form method="POST" action="?tab={tab}&/importBibs" use:enhance={importEnhance} class="space-y-3 border-2 border-border bg-card p-4">
							<Label class={lbl} for="cat1">Category</Label>
							<select id="cat1" name="category" class={field} required>
								<option value="">Choose…</option>
								{#each data.categories as c}<option value={c.id}>{c.name}</option>{/each}
							</select>
							<Label class={lbl} for="bibs">Bib numbers</Label>
							<textarea id="bibs" name="bibs" rows="6" class="w-full border-2 border-border bg-card p-3" placeholder={'101-150\n201\n205'}></textarea>
							<Label class={lbl} for="gall">Gender for all these bibs (optional)</Label>
							<select id="gall" name="gender" class={field}>
								<option value="">Leave as is</option>
								<option value="M">Male</option>
								<option value="F">Female</option>
							</select>
							<p class="text-muted-foreground">One bib per line or comma-separated. Ranges like 101-150 expand. Existing bibs keep their name, tag and age and just move to this category. Add names and ages later on the Participants page, or use the CSV.</p>
							<Button type="submit" class="h-11 font-bold uppercase">Import bibs</Button>
						</form>
					{:else if importMode === 'one'}
						<form method="POST" action="?tab={tab}&/addParticipant" use:enhance={importEnhance} class="space-y-3 border-2 border-border bg-card p-4">
							<p class="text-muted-foreground">Add or update one runner. If the bib already exists, only the fields you fill in change.</p>
							<div class="grid gap-3 md:grid-cols-3">
								<div><Label class={lbl} for="ob">Bib</Label><Input id="ob" name="bib" class="h-11 border-2" required /></div>
								<div class="md:col-span-2"><Label class={lbl} for="on">Name</Label><Input id="on" name="name" class="h-11 border-2" /></div>
								<div>
									<Label class={lbl} for="oc">Category</Label>
									<select id="oc" name="category" class={field}>
										<option value="">None</option>
										{#each data.categories as c}<option value={c.id}>{c.name}</option>{/each}
									</select>
								</div>
								<div>
									<Label class={lbl} for="og">Gender</Label>
									<select id="og" name="gender" class={field}>
										<option value="">Not set</option>
										<option value="M">Male</option>
										<option value="F">Female</option>
									</select>
								</div>
								<div><Label class={lbl} for="oa">Age</Label><Input id="oa" name="age" inputmode="numeric" class="h-11 border-2" /></div>
								<div class="md:col-span-3"><Label class={lbl} for="ot">RFID tag (optional)</Label><Input id="ot" name="tag" class="h-11 border-2" /></div>
							</div>
							<Button type="submit" class="h-11 font-bold uppercase">Save runner</Button>
						</form>
					{:else if importMode === 'tags'}
						<form method="POST" action="?tab={tab}&/importTags" enctype="multipart/form-data" use:enhance={importEnhance} class="space-y-3 border-2 border-border bg-card p-4">
								<p class="text-muted-foreground"><b>Assign RFID tags:</b> upload the RFID writer CSV (<b>bib</b> and <b>tag</b> columns). Runners are matched by bib; only their tag is set. A relay/duo bib appears once in the file; its tag is written to every member of that bib. Re-uploading overwrites.</p>
								<input type="file" name="file" accept=".csv,text/csv,text/plain" required class={field + ' py-2'} aria-label="RFID writer CSV" />
								<Button type="submit" class="h-11 font-bold uppercase">Assign tags</Button>
							</form>
						{:else}
						
							<form method="POST" action="?tab={tab}&/importCsv" enctype="multipart/form-data" use:enhance={importEnhance} class="space-y-3 border-2 border-border bg-card p-4">
							<p class="text-muted-foreground">
								<b>One file per category:</b> choose the category below, then upload the runners of that distance. Header row required. Columns: <b>bib</b> (required), <b>name</b>, <b>gender</b> (M or F), <b>age</b> (a number), <b>tag</b>. Any other column (team, club…) is kept as extra data. Blank cells never erase existing data.
							</p>
							<div class="flex flex-wrap gap-2">
								<a class="inline-flex h-10 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=template" download>Download template</a>
								<a class="inline-flex h-10 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=participants" download>Download current participants</a>
							</div>
							<p class="text-muted-foreground">The participants download also lists each runner's category. Edit it in Excel and import it back to correct many runners at once (a category written in a file wins over the choice below).</p>
							<Label class={lbl} for="cat2">Category for these runners</Label>
							<select id="cat2" name="category" class={field} required>
								<option value="">Choose a category…</option>
								{#each data.categories as c}<option value={c.id}>{c.name}</option>{/each}
								<option value="keep">Don't change categories (only update details)</option>
							</select>
							{#if !data.categories.length}<p class="font-bold text-destructive">No categories yet. Create them on the Categories page first.</p>{/if}
							<Label class={lbl} for="file">CSV file</Label>
							<input id="file" type="file" name="file" accept=".csv,text/csv,text/plain" class={field + ' py-2'} />
							<Label class={lbl} for="csv">…or paste CSV</Label>
							<textarea id="csv" name="csv" rows="6" class="w-full border-2 border-border bg-card p-3 font-mono" placeholder={'bib,name,gender,age,tag\n101,Jane Doe,F,34,0000000001'}></textarea>
							<Button type="submit" class="h-11 font-bold uppercase">Import CSV</Button>
						</form>
					{/if}
			</div>
		</Dialog.Content>
	</Dialog.Root>
</main>
