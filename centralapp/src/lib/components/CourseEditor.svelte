<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaultCourse } from '$lib/progress';

	// Which stations each category passes, and in what order. Default: every station, start first and finish last.
	type St = { id: number; name: string; kind: string; ord: number };
	type Props = { categories: { id: number; name: string }[]; stations: St[]; courses: Record<string, number[]> };
	let { categories, stations, courses }: Props = $props();

	let ids = $state<Record<number, number[] | null>>(untrack(() => Object.fromEntries(categories.map((c) => [c.id, courses[String(c.id)]?.length ? [...courses[String(c.id)]] : null]))));
	const byId = $derived(new Map(stations.map((s) => [s.id, s])));
	const everything = $derived(defaultCourse(stations));
	const kindColor = (k: string) => (k === 'start' ? 'var(--start)' : k === 'finish' ? 'var(--finish)' : 'var(--checkpoint)');
	const small = 'border-2 border-border bg-card font-bold uppercase hover:bg-accent';
	let pick = $state<Record<number, string>>({});

	const move = (cid: number, i: number, d: number) => {
		const a = ids[cid]!;
		if (i + d < 0 || i + d >= a.length) return;
		[a[i], a[i + d]] = [a[i + d], a[i]];
	};
	// a station deleted on this page stays in `ids` (state is not re-read from props), so only send stations that still exist
	const payload = $derived(JSON.stringify(Object.fromEntries(categories.map((c) => [String(c.id), (ids[c.id] ?? []).filter((id) => byId.has(id))]))));
</script>

<form method="POST" action="?tab=stations&/saveCourses" use:enhance class="space-y-4">
	<input type="hidden" name="courses" value={payload} />
	<section class="space-y-2 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Course per category</h2>
		<p class="text-muted-foreground">Which stations each category passes, in order. Unless you change it, a category passes every station: start, the checkpoints in the order above, then finish. A shorter category (for example the 5K) can skip a checkpoint. The Progress page and the splits follow these courses.</p>
	</section>

	{#each categories as cat (cat.id)}
		{@const mine = ids[cat.id]}
		<section class="border-2 border-border bg-card">
			<h3 class="bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">{cat.name}</h3>
			<div class="space-y-3 p-4">
				{#if mine === null}
					<p class="flex flex-wrap items-center gap-2 text-lg">
						<span>Passes every station:</span>
						{#each everything as s, i}{i ? ' → ' : ''}<b class="uppercase">{s.name}</b>{/each}
					</p>
					<Button type="button" variant="outline" size="sm" class={small} onclick={() => (ids[cat.id] = everything.map((s) => s.id))}>Customize this course</Button>
				{:else}
					<ol class="space-y-1">
						{#each mine as sid, i (sid)}
							{@const s = byId.get(sid)}
							{#if s}
								<li class="flex flex-wrap items-center gap-2">
									<span class="w-6 font-display text-2xl font-black">{i + 1}</span>
									<span class="border-2 border-border px-1 text-sm font-bold text-white uppercase {s.kind === 'checkpoint' ? 'text-black' : ''}" style="background:{kindColor(s.kind)}">{s.kind}</span>
									<span class="min-w-40 text-xl font-bold uppercase">{s.name}</span>
									<Button type="button" variant="outline" size="sm" class={small} disabled={i === 0} onclick={() => move(cat.id, i, -1)}>Up</Button>
									<Button type="button" variant="outline" size="sm" class={small} disabled={i === mine.length - 1} onclick={() => move(cat.id, i, 1)}>Down</Button>
									<Button type="button" variant="outline" size="sm" class={small} onclick={() => ids[cat.id] = mine.filter((x) => x !== sid)}>Remove</Button>
								</li>
							{/if}
						{/each}
					</ol>
					{#if !mine.length}<p class="text-muted-foreground">No stations. Add at least one, or use every station.</p>{/if}
					{@const left = stations.filter((s) => !mine.includes(s.id))}
					<div class="flex flex-wrap items-center gap-2">
						{#if left.length}
							<select bind:value={pick[cat.id]} class="h-10 border-2 border-border bg-card px-2" aria-label="Station to add to {cat.name}">
								<option value="">Add a station…</option>
								{#each left as s}<option value={String(s.id)}>{s.name}</option>{/each}
							</select>
							<Button type="button" variant="outline" size="sm" class={small} disabled={!pick[cat.id]} onclick={() => { ids[cat.id] = [...mine, Number(pick[cat.id])]; pick[cat.id] = ''; }}>Add</Button>
						{/if}
						<Button type="button" variant="outline" size="sm" class={small} onclick={() => (ids[cat.id] = null)}>Use every station instead</Button>
					</div>
				{/if}
			</div>
		</section>
	{:else}
		<p class="border-2 border-border bg-card p-4 text-muted-foreground">Add categories first (Categories page).</p>
	{/each}

	<Button type="submit" class="h-11 font-bold uppercase">Save courses</Button>
</form>
