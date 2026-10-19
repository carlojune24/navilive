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
	import { monitor } from '$lib/monitor.svelte';
	import { bestLink, clockWarning, linkState, type Link } from '$lib/heartbeat';

	let { data, form } = $props();
	// the left menu picks the section with ?tab=...
	const sections = ['participants', 'categories', 'stations', 'route', 'progress', 'awards', 'reads', 'data', 'export', 'connect'];
	const titles: Record<string, string> = { participants: 'Participants', categories: 'Categories', stations: 'Stations', route: 'Route & map', progress: 'Progress', awards: 'Awards', reads: 'Reads', data: 'Station data', export: 'Export', connect: 'Connect stations' };
	let progCat = $state<number | null>(null); // Progress page: which category is shown
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
	const kindColor = (k: string) => (k === 'start' ? 'var(--start)' : k === 'finish' ? 'var(--finish)' : 'var(--checkpoint)');

	const addr = $derived(data.addresses[addrIdx]);
	const baseUrl = $derived(data.publicUrl ?? (addr ? `http://${addr.ip}:${data.port}` : `http://<this laptop's IP>:${data.port}`));
	const code = $derived(data.apiKey ? `RC1|${baseUrl}|${data.event.slug}|${data.apiKey}` : '');

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

<main class="space-y-5 p-5">
	<header>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">{titles[tab]}</h1>
		<p class="mt-1 text-muted-foreground">{data.event.name} &middot; {data.participants.length} participants &middot; {data.categories.length} categories</p>
	</header>

	{#if form?.error && !importOpen}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}
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
			<ul class="divide-y-2 divide-border border-2 border-border bg-card">
				{#each data.categories as c (c.id)}
					<li class="flex items-center justify-between p-3">
						<span class="text-xl font-bold uppercase">{c.name} <span class="font-normal text-muted-foreground">({c.n})</span></span>
						<span class="ml-auto mr-4 text-sm text-muted-foreground">{c.gun_ms ? `Gun start: ${new Date(Number(c.gun_ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })} (Start pressed on the live board)` : 'Gun start: press Start on the live board'}</span>
						<form method="POST" action="?tab={tab}&/deleteCategory" use:enhance>
							<input type="hidden" name="id" value={c.id} />
							<Button type="submit" variant="outline" size="sm" class={small}>Delete</Button>
						</form>
					</li>
				{:else}
					<li class="p-3 text-muted-foreground">No categories yet.</li>
				{/each}
			</ul>
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
		<AwardsEditor categories={data.categories} awards={data.awards} extraFields={data.extraFields} preview={data.awardPreview} people={data.participants} slug={data.event.slug} />
		{/if}

		<!-- PROGRESS: who has reached which station -->
		{#if tab === 'progress'}
		<div class="space-y-5">
			<p class="text-muted-foreground">Live: who has reached which station in each category. Times are the race time at that station (the start shows the clock time). A runner who has a later read but none at an earlier station on their course is flagged, so the missed read can be added on the Reads page. Their result is kept.</p>
			{#if data.progressData.length > 1}
				<div class="flex flex-wrap gap-2" role="tablist" aria-label="Category">
					{#each data.progressData as c (c.id)}
						<button type="button" role="tab" aria-selected={c.id === progShown?.id} onclick={() => (progCat = c.id)} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {c.id === progShown?.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">{c.name}</button>
					{/each}
				</div>
			{/if}
			{#each progShown ? [progShown] : [] as c (c.id)}
				{@const flagged = c.progress.filter((r) => r.missed.length).length}
				<section class="border-2 border-border bg-card">
					<h3 class="flex flex-wrap items-baseline justify-between gap-2 bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">
						<span>{c.name}</span>
						<span class="text-base font-normal tracking-wide">{c.finished} finished · {c.started} started · {c.total} registered{flagged ? ` · ${flagged} to check` : ''}</span>
					</h3>
					<p class="border-b-2 border-border/15 px-4 py-2 text-muted-foreground">Course: {c.course.map((s) => s.name).join(' → ')}</p>
					{#key c.id}<ProgressTable course={c.course} rows={c.progress} flags pageSize={20} />{/key}
				</section>
			{:else}
				<p class="border-2 border-border bg-card p-4 text-muted-foreground">No participants yet.</p>
			{/each}
		</div>
		{/if}

		<!-- READS: manual corrections -->
		{#if tab === 'reads'}
		<div class="space-y-4">
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
									<form method="POST" action="?tab={tab}&/voidRead" use:enhance>
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
			{#if data.reads.length === 300}<p class="text-muted-foreground">Showing the latest 300 reads. Use Export for all of them.</p>{/if}

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

		<!-- EXPORT -->
		{#if tab === 'export'}
		<div class="space-y-3">
			<div class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Results</h2>
				<p class="text-muted-foreground">All categories, ranked, with gender and age ranks and checkpoint splits. Opens in Excel.</p>
				<div class="flex flex-wrap gap-2">
					<a class="inline-flex h-11 items-center border-2 border-border bg-primary px-5 font-bold text-primary-foreground uppercase" href="/admin/{data.event.slug}/export?kind=results&mode=gun" download>Results · gun time</a>
					<a class="inline-flex h-11 items-center border-2 border-border bg-primary px-5 font-bold text-primary-foreground uppercase" href="/admin/{data.event.slug}/export?kind=results&mode=own" download>Results · own start</a>
				</div>
			</div>
			<div class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Winners</h2>
				<p class="text-muted-foreground">The podium for every award in every category (overall, gender, age group), ready to read out or print.</p>
				<div class="flex flex-wrap gap-2">
					<a class="inline-flex h-11 items-center border-2 border-border bg-primary px-5 font-bold text-primary-foreground uppercase" href="/admin/{data.event.slug}/export?kind=winners&mode=gun" download>Winners · gun time</a>
					<a class="inline-flex h-11 items-center border-2 border-border bg-primary px-5 font-bold text-primary-foreground uppercase" href="/admin/{data.event.slug}/export?kind=winners&mode=own" download>Winners · own start</a>
				</div>
			</div>
			<div class="space-y-3 border-2 border-border bg-card p-4">
				<h2 class="font-display text-3xl font-black uppercase">Every read</h2>
				<p class="text-muted-foreground">The raw log, including voided reads, with exact times. Good as a backup or for disputes.</p>
				<a class="inline-flex h-11 items-center border-2 border-border bg-card px-5 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=reads" download>All reads (CSV)</a>
			</div>
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
