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
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { ago } from '$lib/time';
	import { fmt } from '$lib/results';
	import { shrinkImage } from '$lib/image';
	import { deserialize } from '$app/forms';
	import { monitor } from '$lib/monitor.svelte';
	import { bestLink, clockWarning, linkState, type Link } from '$lib/heartbeat';

	let { data, form } = $props();
	// the left menu picks the section with ?tab=...
	const sections = ['participants', 'categories', 'stations', 'route', 'progress', 'results', 'awards', 'reads', 'data', 'connect'];
	const titles: Record<string, string> = { participants: 'Participants', categories: 'Categories', stations: 'Stations', route: 'Route & map', progress: 'Progress', results: 'Results', awards: 'Awards', reads: 'Reads', data: 'Station data', connect: 'Connect stations' };
	// Results page: the finish-time override panel for one runner
	let ovr = $state<{ bib: string; name: string; at: string } | null>(null);
	let ovrBy = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem('nv.admin.name') ?? ''));
	let ovrReason = $state('');
	let ovrFile = $state<File | null>(null);
	let ovrErr = $state('');
	let ovrBusy = $state(false);
	const overrideOf = (bib: string) => data.overrides.find((o) => o.bib === bib);
	function openOverride(r: { bib: string; name: string; finishAt: number | null }) {
		ovr = { bib: r.bib, name: r.name, at: r.finishAt ? new Date(r.finishAt - new Date(r.finishAt).getTimezoneOffset() * 60000).toISOString().slice(0, 23) : '' };
		ovrReason = '';
		ovrFile = null;
		ovrErr = '';
	}
	async function saveOverride() {
		if (!ovr) return;
		const ms = new Date(ovr.at).getTime();
		if (!Number.isFinite(ms)) return (ovrErr = 'Enter the finish time.');
		if (!ovrFile) return (ovrErr = 'Attach the proof photo.');
		ovrBusy = true;
		ovrErr = '';
		try {
			const fd = new FormData();
			fd.set('bib', ovr.bib);
			fd.set('finish_ms', String(ms));
			fd.set('reason', ovrReason);
			fd.set('by', ovrBy);
			fd.set('photo', await shrinkImage(ovrFile), 'proof.jpg');
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
	let awardsView = $state<'list' | 'settings'>('list'); // Awards page: the winners list or the settings
	let resSel = $state<number | 'all' | null>(null); // Results / Award list: which category is shown
	const resShown = $derived(resSel === 'all' ? data.resultsData : data.resultsData.filter((c) => c.id === (resSel ?? data.resultsData[0]?.id)));
	let progBatch = $state<'all' | 'none' | number>('all'); // Progress page: which batch of that category
	const progBatches = $derived(data.batches.filter((b) => b.category_id === progShown?.id));
	// the shown category's runners, narrowed to one batch when picked
	const progRows = $derived.by(() => {
		const rows = progShown?.progress ?? [];
		if (progBatch === 'all' || !progBatches.length) return rows;
		const batchOf = new Map(data.participants.map((p) => [p.bib, p.batch_id]));
		return rows.filter((r) => (batchOf.get(r.bib) ?? null) === (progBatch === 'none' ? null : progBatch));
	});
	const progShown = $derived(data.progressData.find((c) => c.id === progCat) ?? data.progressData[0]);
	const tab = $derived(sections.includes(page.url.searchParams.get('tab') ?? '') ? page.url.searchParams.get('tab')! : 'participants');
	let now = $state(Date.now());
	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
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
			const hay = `${p.bib} ${p.name} ${p.tag} ${p.category ?? ''} ${p.gender === 'M' ? 'male men' : p.gender === 'F' ? 'female women' : ''} ${p.age ?? ''}`.toLowerCase();
			return words.every((w) => hay.includes(w)); // every word must match somewhere, so "maria 10k" narrows
		});
	});
	const filtering = $derived(search.trim() !== '' || catFilter !== '');
	let importMode = $state<'bibs' | 'csv' | 'one'>('bibs');
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
	const confirmReset = (label: string) => ({ cancel }: { cancel: () => void }) => {
		if (!confirm(`Reset the start of ${label}? It goes back to Not started. Reads are kept.`)) cancel();
	};
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
		<form method="POST" action="?tab={tab}&/clearGun" use:enhance={confirmReset(label)}>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="id" value={id} />
			<Button type="submit" variant="outline" size="sm" class={small} title="Back to not started, so Start can be pressed again" aria-label="Reset start of {label}">Reset</Button>
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

{#snippet overridePanel()}
{#if ovr}
				<div class="space-y-3 border-2 border-border bg-card p-4 print:hidden" role="dialog" aria-label="Override finish time">
					<h3 class="font-display text-2xl font-black uppercase">Override finish — {ovr.bib} {ovr.name}</h3>
					<p class="text-muted-foreground">Replaces this runner's finish time in the ranking. The original reads are kept. Needs a reason and a photo as proof.</p>
					{#if ovrErr}<p class="font-bold text-destructive" role="alert">{ovrErr}</p>{/if}
					<label class="block font-bold uppercase">Finish time (your local time)<input type="datetime-local" step="0.001" bind:value={ovr.at} class="mt-1 block h-12 w-full border-2 border-border bg-background px-3" /></label>
					<label class="block font-bold uppercase">Reason<input bind:value={ovrReason} maxlength="300" placeholder="e.g. Read delayed; photo shows runner first" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
					<label class="block font-bold uppercase">Your name<input bind:value={ovrBy} maxlength="80" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
					<label class="block font-bold uppercase">Proof photo<input type="file" accept="image/*" onchange={(e) => (ovrFile = e.currentTarget.files?.[0] ?? null)} class="mt-1 block" /></label>
					<div class="flex gap-2">
						<Button class="h-11 font-bold uppercase" disabled={ovrBusy} onclick={saveOverride}>{ovrBusy ? 'Saving…' : 'Save override'}</Button>
						<Button variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (ovr = null)}>Cancel</Button>
					</div>
				</div>
			{/if}
{/snippet}

<main class="space-y-5 p-5 print:p-0">
	<header>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">{titles[tab]}</h1>
		<p class="mt-1 text-muted-foreground">{data.event.name} &middot; {data.participants.length} participants &middot; {data.categories.length} categories</p>
	</header>

	{#if form?.error && !importOpen && !batchDlg}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}
	{#if form?.imported}
		<p class="border-2 border-border bg-card p-3 font-bold">
			Imported {form.imported} participants.
			{#if form.skipped?.length}Notes: {form.skipped.join('; ')}{/if}
		</p>
	{/if}
	{#if form?.awardsSaved}<p class="border-2 border-border bg-card p-3 font-bold">Awards settings saved.</p>{/if}
	{#if form?.revealSet !== undefined}<p class="border-2 border-border bg-card p-3 font-bold">{form.revealSet ? 'Awards are now visible on the live board.' : 'Awards are now hidden from the public board.'}</p>{/if}
	{#if form?.saved}<p class="border-2 border-border bg-card p-3 font-bold">Participant saved.</p>{/if}
	{#if form?.manualAdded}<p class="border-2 border-border bg-card p-3 font-bold">Manual read added.</p>{/if}
	{#if form?.readsUploaded}<p class="border-2 border-border bg-card p-3 font-bold">File read: {form.readsUploaded.received} reads. {form.readsUploaded.inserted} new, {form.readsUploaded.duplicates} already here (skipped){form.readsUploaded.updated ? `, ${form.readsUploaded.updated} void changes applied` : ''}.</p>{/if}
	{#if form?.cleared !== undefined}<p class="border-2 border-border bg-card p-3 font-bold">Cleared {form.cleared} reads.</p>{/if}


		<!-- PARTICIPANTS -->
		{#if tab === 'participants'}
		<div class="space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-lg" role="status">
					{#if filtering}Showing <b>{filtered.length}</b> of <b>{data.participants.length}</b> participants{:else}<b>{data.participants.length}</b> participants in <b>{data.categories.length}</b> categories{/if}
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
						{#each data.categories as c}<option value={String(c.id)}>{c.name} ({c.n})</option>{/each}
						<option value="none">No category ({data.participants.filter((p) => p.category_id === null).length})</option>
					</select>
				</div>
				{#if filtering}<Button type="button" variant="outline" class="h-11 border-2 border-border bg-card font-bold uppercase hover:bg-accent" onclick={() => ((search = ''), (catFilter = ''))}>Clear</Button>{/if}
			</div>
			<div class="border-2 border-border bg-card">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-primary hover:bg-primary">
							{#each ['Bib', 'Name', 'Category', 'Gender', 'Age', 'Tag', ''] as h}
								<Table.Head class="font-bold tracking-wide text-primary-foreground uppercase">{h}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filtered as p (p.id)}
							{#if editing === p.id}
								<Table.Row class="bg-accent">
									<Table.Cell colspan={7}>
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
											<Button type="submit" class="h-11 font-bold uppercase">Save</Button>
											<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (editing = null)}>Cancel</Button>
										</form>
										<div class="mt-3 border-t-2 border-border/20 pt-3"><span class="mr-3 font-bold tracking-wide uppercase">Winner photo</span><PhotoUpload slug={data.event.slug} id={p.id} bib={p.bib} photo={p.photo} tab={tab} /></div>
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell class="font-display text-3xl font-black">{p.bib}</Table.Cell>
									<Table.Cell class="text-lg">{p.name || '—'}</Table.Cell>
									<Table.Cell>{p.category ?? '—'}</Table.Cell>
									<Table.Cell>{p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : '—'}</Table.Cell>
									<Table.Cell>{p.age ?? '—'}</Table.Cell>
									<Table.Cell>{p.tag || '—'}</Table.Cell>
									<Table.Cell class="text-right whitespace-nowrap">
										<Button variant="outline" size="sm" class={small} onclick={() => (editing = p.id)}>Edit</Button>
										<form method="POST" action="?tab={tab}&/deleteParticipant" use:enhance class="inline">
											<input type="hidden" name="id" value={p.id} />
											<Button type="submit" variant="outline" size="sm" class={small}>Delete</Button>
										</form>
									</Table.Cell>
								</Table.Row>
							{/if}
						{:else}
							<Table.Row>
								<Table.Cell colspan={7} class="p-6 text-muted-foreground">{filtering ? 'No participants match this search.' : 'No participants yet. Press Import participants.'}</Table.Cell>
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
									<Button type="submit" variant="outline" size="sm" class={small} title="Hide this category from the boards. Results and reads are kept; Restore brings it back.">Archive</Button>
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
											<Button type="submit" variant="outline" size="sm" class={small} title="Its runners go back to no batch">Delete</Button>
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
								<Button type="submit" variant="outline" size="sm" class={small}>Delete</Button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
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
			{@render overridePanel()}
			<p class="text-muted-foreground">Live: who has reached which station in each category. Times are the race time at that station (the start shows the clock time). A runner who has a later read but none at an earlier station on their course is flagged, so the missed read can be added on the Reads page. Their result is kept.</p>
			{#if data.progressData.length > 1}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Category">
					{#each data.progressData as c (c.id)}
						<button type="button" role="tab" aria-selected={c.id === progShown?.id} onclick={() => ((progCat = c.id), (progBatch = 'all'))} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {c.id === progShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">{c.name}</button>
					{/each}
				</div>
			{/if}
			{#if progBatches.length}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Batch">
					{#each [['all', 'All batches'], ...progBatches.map((b) => [b.id, b.name]), ['none', 'No batch']] as [id, label]}
						<button type="button" role="tab" aria-selected={id === progBatch} onclick={() => (progBatch = id as typeof progBatch)} class="h-11 border-2 border-border px-4 text-lg font-bold uppercase {id === progBatch ? 'bg-primary text-primary-foreground' : 'bg-card'}">{label}</button>
					{/each}
				</div>
			{/if}
			{#each progShown ? [progShown] : [] as c (c.id)}
				{@const flagged = progRows.filter((r) => r.missed.length).length}
				<section class="border-2 border-border bg-card">
					<h3 class="flex flex-wrap items-baseline justify-between gap-2 bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">
						<span>{c.name}</span>
						<span class="text-base font-normal tracking-wide">{progRows.filter((r) => r.state === 'finished').length} finished · {progRows.filter((r) => r.start !== null).length} started · {progRows.length} registered{flagged ? ` · ${flagged} to check` : ''}</span>
					</h3>
					{#key `${c.id}-${progBatch}`}<ProgressTable course={c.course} rows={progRows} flags pageSize={20} onOverride={(r) => openOverride({ bib: r.bib, name: r.name, finishAt: null })} overridden={(bib) => !!overrideOf(bib)} />{/key}
				</section>
				<!-- per checkpoint: who has passed and who has not yet (the start counts a gun start too, like the table) -->
				<section class="border-2 border-border bg-card">
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
			{#if isRes}{@render overridePanel()}{/if}
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
										<Table.Cell>{r.gender || '—'}</Table.Cell>
										<Table.Cell>{r.age ?? '—'}</Table.Cell>
										<Table.Cell class="font-bold tabular-nums">{fmt(r.time!)}</Table.Cell>
										<Table.Cell class="print:hidden">
											{#if r.overridden}
												{@const o = overrideOf(r.bib)}
												<span class="mr-2 border-2 border-destructive px-1 text-sm font-bold text-destructive uppercase" title={o ? `${o.reason} — ${o.by}` : ''}>Override</span>
												<a class="mr-2 underline" href="/admin/{data.event.slug}/override-photo/{r.bib}" target="_blank" rel="noopener">Photo</a>
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

		<!-- READS: manual corrections -->
		{#if tab === 'reads'}
		<div class="space-y-4">
			{@render overridePanel()}
			<form method="POST" action="?tab={tab}&/manualRead" use:enhance class="space-y-3 border-2 border-border bg-card p-4">
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
								<Table.Cell>{r.device_id === 'MANUAL-CENTRAL' ? 'Manual' : r.device_id || '—'}</Table.Cell>
								<Table.Cell class="text-right">
									{#if r.bib}<button type="button" class="mr-2 underline" onclick={() => openOverride({ bib: r.bib, name: r.name ?? '', finishAt: null })}>{overrideOf(r.bib) ? 'Override ✓' : 'Override'}</button>{/if}
									<form method="POST" action="?tab={tab}&/voidRead" use:enhance class="inline">
										<input type="hidden" name="id" value={r.id} />
										<input type="hidden" name="voided" value={r.voided ? 'false' : 'true'} />
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

			<form method="POST" action="?tab={tab}&/rotateKey" use:enhance class="flex flex-wrap items-center gap-3 border-2 border-border bg-card p-4">
				<Button type="submit" class="h-11 border-2 border-border bg-destructive font-bold text-white uppercase hover:bg-destructive/90">Rotate key</Button>
				<p class="min-w-64 flex-1 text-muted-foreground">Makes a new key. Stations using the old key stop uploading until you paste the new code.</p>
			</form>
			{#if !data.publicUrl}<p class="text-muted-foreground">Admin pages open only on this laptop at <code>http://localhost:{data.port}</code>. Stations and phones use the address above.</p>{/if}
		</div>
		{/if}

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
