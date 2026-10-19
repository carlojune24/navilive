<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ago } from '$lib/time';

	let { data } = $props();
	let now = $state(Date.now());

	onMount(() => {
		// reads arrive all day; keep the table current without a manual refresh
		const tick = setInterval(() => (now = Date.now()), 1000);
		const poll = setInterval(() => void invalidateAll(), 5000);
		return () => (clearInterval(tick), clearInterval(poll));
	});

	const kindColor = (k: string) => (k === 'start' ? 'var(--start)' : k === 'finish' ? 'var(--finish)' : 'var(--checkpoint)');
	const lastIn = $derived(data.devices.reduce((m: number, d: { last_in_ms: number }) => Math.max(m, Number(d.last_in_ms)), 0) || null);
</script>

<main class="mx-auto max-w-5xl space-y-5 p-5">
	<a href="/admin/{data.event.slug}?tab=data" class="font-bold tracking-wide uppercase underline">&larr; Station data</a>
	<div class="flex flex-wrap items-center gap-3">
		<span class="border-2 border-border px-2 py-1 font-bold text-white uppercase" style="background:{kindColor(data.station.kind)}">{data.station.kind}</span>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">{data.station.name}</h1>
	</div>

	<div class="grid gap-3 sm:grid-cols-3">
		<div class="border-2 border-border bg-card p-4"><p class="font-bold tracking-wide uppercase">Reads received</p><p class="font-display text-5xl font-black">{data.total}</p></div>
		<div class="border-2 border-border bg-card p-4"><p class="font-bold tracking-wide uppercase">Voided</p><p class="font-display text-5xl font-black">{data.voided}</p></div>
		<div class="border-2 border-border bg-card p-4"><p class="font-bold tracking-wide uppercase">Last data received</p><p class="font-display text-4xl font-black">{ago(lastIn, now)}</p></div>
	</div>

	<section class="border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Sending devices</h2>
		{#each data.devices as d}
			<p class="flex flex-wrap justify-between gap-2 border-b border-border/20 py-1 last:border-b-0">
				<span class="font-bold">{d.device_id || '(no device id)'}</span>
				<span>{d.n} reads · last {ago(d.last_in_ms, now)}</span>
			</p>
		{:else}
			<p class="text-muted-foreground">Nothing has arrived from this station yet.</p>
		{/each}
	</section>

	<form method="GET" class="flex gap-2">
		<Input name="q" value={data.search} placeholder="Find a bib, name or tag" class="h-11 border-2" />
		<Button type="submit" class="h-11 font-bold uppercase">Search</Button>
		{#if data.search}<a href="?" class="flex h-11 items-center border-2 border-border bg-card px-4 font-bold uppercase hover:bg-accent">Clear</a>{/if}
	</form>

	<div class="border-2 border-border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row class="bg-primary hover:bg-primary">
					{#each ['Read at', 'Received', 'Bib', 'Name / tag', 'Device', ''] as h}
						<Table.Head class="font-bold tracking-wide text-primary-foreground uppercase">{h}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.reads as r (r.id)}
					<Table.Row class={r.voided ? 'text-muted-foreground line-through' : ''}>
						<Table.Cell class="whitespace-nowrap">{new Date(r.read_at_ms).toLocaleString()}</Table.Cell>
						<Table.Cell class="whitespace-nowrap">{ago(r.received_ms, now)}</Table.Cell>
						<Table.Cell class="font-display text-2xl font-black">{r.bib ?? '?'}</Table.Cell>
						<Table.Cell>
							{#if r.unmatched}<span class="border-2 border-destructive px-1 font-bold text-destructive uppercase no-underline">Not in roster</span> {/if}{r.name || r.tag}
						</Table.Cell>
						<Table.Cell>{r.device_id === 'MANUAL-CENTRAL' ? 'Manual' : r.device_id || '—'}</Table.Cell>
						<Table.Cell>{r.voided ? 'Voided' : ''}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row><Table.Cell colspan={6} class="p-6 text-muted-foreground">{data.search ? 'No reads match that search.' : 'No reads yet.'}</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	{#if data.reads.length === 500}<p class="text-muted-foreground">Showing the latest 500. Use Search to find a specific runner, or Export for everything.</p>{/if}
	<p class="text-muted-foreground">Refreshes by itself every few seconds. To void a read or add a missed one, use the event's Reads page.</p>
</main>
