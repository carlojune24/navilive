<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { fmt } from '$lib/results';
	import { shrinkImage } from '$lib/image';
	import { page } from '$app/state';
	import { ITEMS, layoutOf, type Item, type Layout } from '$lib/wall';
	import WallStage from '$lib/components/WallStage.svelte';

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
	let draft = $state<Record<Item, Layout>>(layoutOf(undefined));
	const backKey = $derived(`${catId}:${back?.v ?? ''}`);
	$effect(() => {
		backKey;
		draft = layoutOf(untrack(() => back));
	});
	let editing = $state(false);
	const shown = $derived(runner && runner.catId === catId ? runner : null);
	// the name on the picture: the team or runner name, unless the operator typed another one
	let nameOverride = $state('');
	const texts = $derived<Record<Item, string>>({
		time: shown ? fmt(shown.time!) : editing ? '1:23:45' : '',
		name: shown ? nameOverride.trim() || shown.name || 'Bib ' + shown.bib : editing ? 'Team or runner name' : ''
	});
	const timeText = $derived(texts.time);

	// picking only previews here; Publish puts it on the display screen
	function choose(r: (typeof finishers)[number]) {
		picked = { bib: r.bib, catId: r.catId };
		catId = r.catId;
		query = '';
		nameOverride = '';
	}
	const publish = () => shown && act('show', { bib: shown.bib, name: nameOverride.trim() }, 'Published to the display screen.');
	const onDisplay = $derived(data.display ? finishers.find((r) => r.bib === data.display!.bib && r.catId === data.display!.catId) : undefined);
	const displayName = $derived(data.display?.name || (onDisplay ? onDisplay.name || 'Bib ' + onDisplay.bib : ''));
	const displayUrl = $derived(`${page.url.origin}/e/${data.slug}/wall/display`);
	let copied = $state(false);
	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(displayUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* no clipboard (plain http on some browsers): the address is on screen to type */
		}
	}

	let wall: HTMLDivElement;
	const fullscreen = () => wall.requestFullscreen?.();

	let busy = $state(false);
	let msg = $state('');
	async function act(name: string, fields: Record<string, string | Blob>, done = 'Saved.') {
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
			msg = done;
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
	const fields = (l: Layout, p: string) => ({ [p + 'x']: String(l.x), [p + 'y']: String(l.y), [p + 'size']: String(l.size), [p + 'color']: l.color });
	const save = () => act('layout', { ...fields(draft.time, ''), ...fields(draft.name, 'name_') });

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
				<label class="font-bold uppercase">
					Name to show <span class="font-normal normal-case text-muted-foreground">(optional)</span>
					<input bind:value={nameOverride} maxlength="80" placeholder={runner.name || 'Bib ' + runner.bib} autocomplete="off" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 text-xl font-normal normal-case" />
				</label>
				{#if data.admin}
					<button type="button" disabled={busy || !shown} onclick={publish} class="{btn} h-16 bg-primary text-2xl text-primary-foreground">Publish to display</button>
				{/if}
			{/if}
			<div class="flex flex-col gap-2 border-2 border-border bg-card p-3">
				<h2 class="font-display text-2xl font-black uppercase">Display screen</h2>
				<p class="text-sm text-muted-foreground">Open this address on the screen runners see. It shows only the picture. Pick a runner here, check the preview, then press Publish to display{data.admin ? '' : ' (log in as the organizer to publish)'}.</p>
				<a href={displayUrl} target="_blank" rel="noopener" class="font-bold break-all underline">{displayUrl}</a>
				<button type="button" onclick={copyUrl} class="{btn} bg-card hover:bg-accent">{copied ? 'Copied ✓' : 'Copy address'}</button>
				{#if data.display}
					<p class="text-sm"><b class="uppercase">Showing:</b> {onDisplay ? `${displayName} · #${onDisplay.bib}` : `Bib ${data.display.bib} (no released finish time)`}</p>
					{#if data.admin}<button type="button" disabled={busy} onclick={() => act('show', { bib: '' }, 'Display screen cleared.')} class="{btn} bg-card hover:bg-accent">Clear display</button>{/if}
				{:else}
					<p class="text-sm"><b class="uppercase">Showing:</b> nothing yet</p>
				{/if}
			</div>
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
						<label class="flex items-center gap-2 font-bold uppercase"><input type="checkbox" bind:checked={editing} class="size-5" /> Edit positions</label>
						{#if editing}
							<p class="text-sm text-muted-foreground">Drag the time and the name on the picture to place them.</p>
							{#each ITEMS as [item, label] (item)}
								<fieldset class="flex flex-col gap-2 border-t-2 border-border/15 pt-2">
									<legend class="font-display text-xl font-black uppercase">{label}</legend>
									<label class="font-bold uppercase">Size <input type="range" min="2" max="40" step="0.5" bind:value={draft[item].size} class="block w-full" /></label>
									<label class="flex items-center gap-2 font-bold uppercase">Color <input type="color" bind:value={draft[item].color} class="h-10 w-16 border-2 border-border" /></label>
								</fieldset>
							{/each}
							<button type="button" disabled={busy} onclick={save} class="{btn} bg-primary text-primary-foreground">Save position</button>
						{/if}
					{/if}
					{#if msg}<p class="font-bold" role="status">{msg}</p>{/if}
				</div>
			{/if}
		</section>

		<div bind:this={wall} class="wall">
			<WallStage slug={data.slug} {catId} {back} bind:draft {texts} {editing} empty="Search a runner to show their finish time." />
		</div>
	</div>
</div>

<style>
	.wall:fullscreen {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
	}
</style>
