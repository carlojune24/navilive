<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { parseBrackets, type AwardConfig, type BracketCfg } from '$lib/awardcfg';
	import { fmt, type Award } from '$lib/results';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';

	type Props = {
		categories: { id: number; name: string; n: number }[];
		awards: { places: number; brackets: string; exclusive: boolean; config: AwardConfig };
		extraFields: Record<string, string[]>;
		preview: { id: number; name: string; finished: number; total: number; awards: Award[] }[];
		people: { id: number; bib: string; photo: number | null }[];
		slug: string;
	};
	let { categories, awards, extraFields, preview, people, slug }: Props = $props();
	const byBib = $derived(new Map(people.map((p) => [p.bib, p])));
	// everyone who wins anything in a category, once, with the awards they win
	const winnersOf = (awardsList: Award[]) => {
		const m = new Map<string, { bib: string; name: string; wins: string[] }>();
		for (const a of awardsList) for (const w of a.winners) (m.get(w.bib) ?? m.set(w.bib, { bib: w.bib, name: w.name, wins: [] }).get(w.bib)!).wins.push(`${w.place}. ${a.name}`);
		return [...m.values()];
	};

	type Row = { min: string; max: string; men: boolean; women: boolean; all: boolean };
	const rowFrom = (b: BracketCfg): Row => ({ min: String(b.min), max: b.max === null ? '' : String(b.max), men: b.men, women: b.women, all: !!b.all });

	// editable copies of what was saved (the page keeps them while the organizer edits)
	let places = $state(untrack(() => String(awards.places)));
	let defaultBrackets = $state(untrack(() => awards.brackets));
	let exclusive = $state(untrack(() => awards.exclusive));
	let showSingle = $state(untrack(() => awards.config.showSingleGender));

	const initCat = (id: number) => {
		const c = awards.config.categories[String(id)] ?? {};
		const own = Array.isArray(c.brackets);
		return {
			places: c.places == null ? '' : String(c.places),
			overall: c.overall ?? true,
			men: c.men ?? true,
			women: c.women ?? true,
			ageGroups: c.ageGroups ?? true,
			own, // this category has its own brackets instead of the event's
			brackets: own ? (c.brackets as BracketCfg[]).map(rowFrom) : ([] as Row[]),
			youngest: c.youngest ?? false,
			oldest: c.oldest ?? false
		};
	};
	let cats = $state(untrack(() => Object.fromEntries(categories.map((c) => [c.id, initCat(c.id)]))));

	type Custom = { id: string; name: string; gender: string; ageMin: string; ageMax: string; field: string; value: string; places: string; catIds: number[] };
	let customs = $state<Custom[]>(
		untrack(() =>
			awards.config.customs.map((c) => ({ id: c.id, name: c.name, gender: c.gender, ageMin: c.ageMin === null ? '' : String(c.ageMin), ageMax: c.ageMax === null ? '' : String(c.ageMax), field: c.field, value: c.value, places: String(c.places), catIds: [...c.categoryIds] }))
		)
	);

	const eventDefaultRows = (): Row[] => (parseBrackets(defaultBrackets) ?? []).map((b) => ({ min: String(b.min), max: b.max >= 200 ? '' : String(b.max), men: true, women: true, all: false }));
	const addCustom = () => customs.push({ id: 'new-' + Math.random().toString(36).slice(2, 8), name: '', gender: '', ageMin: '', ageMax: '', field: '', value: '', places: '1', catIds: [] });
	const toggleCat = (c: Custom, id: number) => (c.catIds = c.catIds.includes(id) ? c.catIds.filter((x) => x !== id) : [...c.catIds, id]);

	// what is posted: the browser's choices as JSON, checked again by the server
	const config = $derived(
		JSON.stringify({
			showSingleGender: showSingle,
			categories: Object.fromEntries(
				categories.map((cat) => {
					const e = cats[cat.id];
					return [
						String(cat.id),
						{
							places: e.places.trim() === '' ? null : e.places,
							overall: e.overall,
							men: e.men,
							women: e.women,
							ageGroups: e.ageGroups,
							brackets: e.ageGroups && e.own ? e.brackets.map((b) => ({ min: b.min, max: b.max.trim() === '' ? null : b.max, men: b.men, women: b.women, all: b.all })) : null,
							youngest: e.youngest,
							oldest: e.oldest
						}
					];
				})
			),
			customs: customs.map((c) => ({ id: c.id, name: c.name, gender: c.gender, ageMin: c.ageMin, ageMax: c.ageMax, field: c.field, value: c.value, places: c.places, categoryIds: c.catIds }))
		})
	);

	const fieldNames = $derived(Object.keys(extraFields));
	const hidden = $derived(!awards.config.reveal);
	const lbl = 'font-bold tracking-wide uppercase';
	const check = 'size-5 shrink-0';
	const small = 'border-2 border-border bg-card font-bold uppercase hover:bg-accent';
</script>

<div class="space-y-5">
	<!-- reveal -->
	<form method="POST" action="?tab=awards&/setReveal" use:enhance class="flex flex-wrap items-center justify-between gap-3 border-2 p-4 {hidden ? 'border-destructive bg-card' : 'border-border bg-card'}">
		<input type="hidden" name="reveal" value={hidden ? 'true' : 'false'} />
		<div class="min-w-64 flex-1">
			<h2 class="font-display text-3xl font-black uppercase">{hidden ? 'Awards are hidden from the public' : 'Awards are visible on the live board'}</h2>
			<p class="text-muted-foreground">
				{hidden ? 'The board shows "Awards coming soon" until you reveal them. You still see everything below, and the winners export includes them.' : 'Hide them to keep the winners secret until the ceremony.'}
			</p>
		</div>
		<Button type="submit" class="h-11 border-2 border-border font-bold uppercase {hidden ? 'bg-destructive text-white hover:bg-destructive/90' : ''}" variant={hidden ? 'default' : 'outline'}>
			{hidden ? 'Reveal awards now' : 'Hide until the ceremony'}
		</Button>
	</form>

	<form method="POST" action="?tab=awards&/saveAwards" use:enhance class="space-y-5">
		<input type="hidden" name="config" value={config} />

		<!-- event defaults -->
		<section class="space-y-3 border-2 border-border bg-card p-4">
			<h2 class="font-display text-3xl font-black uppercase">Event defaults</h2>
			<p class="text-muted-foreground">Used by every category that doesn't set its own. Winners are picked inside each category (distance).</p>
			<div class="flex flex-wrap gap-4">
				<div class="w-40">
					<Label class={lbl} for="ap">Places per award</Label>
					<Input id="ap" name="places" type="number" min="1" max="10" bind:value={places} class="h-11 border-2" />
				</div>
				<div class="min-w-64 flex-1">
					<Label class={lbl} for="ab">Default age brackets</Label>
					<Input id="ab" name="brackets" bind:value={defaultBrackets} class="h-11 border-2" placeholder="18-29, 30-39, 40-49, 60+" />
				</div>
			</div>
			<label class="flex items-start gap-3 text-lg">
				<input type="checkbox" name="exclusive" bind:checked={exclusive} class="{check} mt-1" />
				<span><b>Overall winners can't also win an age-group prize.</b> The age-group prize goes to the next runner. Off means every award is ranked on its own.</span>
			</label>
			<label class="flex items-start gap-3 text-lg">
				<input type="checkbox" bind:checked={showSingle} class="{check} mt-1" />
				<span><b>Show Men and Women awards even in a category with only one gender.</b> Normally they are hidden because they would repeat Overall.</span>
			</label>
		</section>

		<!-- one card per category -->
		{#each categories as cat (cat.id)}
			{@const e = cats[cat.id]}
			<section class="border-2 border-border bg-card">
				<h3 class="bg-primary px-4 py-2 font-display text-3xl font-black text-primary-foreground uppercase">{cat.name} <span class="text-lg font-normal tracking-wide">{cat.n} runners</span></h3>
				<div class="space-y-4 p-4">
					<div class="flex flex-wrap items-end gap-x-8 gap-y-3">
						<div class="w-44">
							<Label class={lbl} for="pl{cat.id}">Places</Label>
							<Input id="pl{cat.id}" type="number" min="1" max="10" bind:value={e.places} placeholder="Default ({places})" class="h-11 border-2" />
						</div>
						<div class="flex flex-wrap gap-x-6 gap-y-2 text-lg">
							<label class="flex items-center gap-2"><input type="checkbox" bind:checked={e.overall} class={check} />Overall</label>
							<label class="flex items-center gap-2"><input type="checkbox" bind:checked={e.men} class={check} />Men</label>
							<label class="flex items-center gap-2"><input type="checkbox" bind:checked={e.women} class={check} />Women</label>
							<label class="flex items-center gap-2"><input type="checkbox" bind:checked={e.youngest} class={check} />Youngest finisher</label>
							<label class="flex items-center gap-2"><input type="checkbox" bind:checked={e.oldest} class={check} />Oldest finisher</label>
						</div>
					</div>

					<div class="border-t-2 border-border/20 pt-3">
						<label class="flex items-center gap-2 text-lg font-bold"><input type="checkbox" bind:checked={e.ageGroups} class={check} />Age group awards</label>
						{#if e.ageGroups}
							{#if !e.own}
								<p class="mt-2 text-muted-foreground">
									Using the event's brackets: <b>{defaultBrackets || 'none'}</b>, for men and women.
									<Button type="button" variant="outline" size="sm" class="ml-2 {small}" onclick={() => ((e.brackets = eventDefaultRows()), (e.own = true))}>Edit brackets for this category</Button>
								</p>
							{:else}
								<div class="mt-3 space-y-2">
									{#each e.brackets as b, i}
										<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
											<label class="flex items-center gap-2 font-bold uppercase">From <Input type="number" min="0" max="120" bind:value={b.min} class="h-10 w-20 border-2" aria-label="From age" /></label>
											<label class="flex items-center gap-2 font-bold uppercase">To <Input type="number" min="0" max="120" bind:value={b.max} placeholder="and over" class="h-10 w-28 border-2" aria-label="To age (blank means and over)" /></label>
											<label class="flex items-center gap-1"><input type="checkbox" bind:checked={b.men} class={check} />Men</label>
											<label class="flex items-center gap-1"><input type="checkbox" bind:checked={b.women} class={check} />Women</label>
											<label class="flex items-center gap-1"><input type="checkbox" bind:checked={b.all} class={check} />Everyone</label>
											<Button type="button" variant="outline" size="sm" class={small} onclick={() => e.brackets.splice(i, 1)}>Remove</Button>
										</div>
									{:else}
										<p class="text-muted-foreground">No brackets yet. Add one.</p>
									{/each}
									<div class="flex flex-wrap gap-2 pt-1">
										<Button type="button" variant="outline" size="sm" class={small} onclick={() => e.brackets.push({ min: '', max: '', men: true, women: true, all: false })}>Add bracket</Button>
										<Button type="button" variant="outline" size="sm" class={small} onclick={() => ((e.own = false), (e.brackets = []))}>Use the event's brackets instead</Button>
									</div>
									<p class="text-sm text-muted-foreground">Leave "To" empty for "and over" (for example 60 and over). "Everyone" gives one award for the bracket regardless of gender.</p>
								</div>
							{/if}
						{/if}
					</div>
				</div>
			</section>
		{:else}
			<p class="border-2 border-border bg-card p-4 text-muted-foreground">Add categories first (Categories page), then choose their awards here.</p>
		{/each}

		<!-- custom awards -->
		<section class="space-y-3 border-2 border-border bg-card p-4">
			<h2 class="font-display text-3xl font-black uppercase">Custom awards</h2>
			<p class="text-muted-foreground">Your own prizes from runner info: a gender, an age range, and a team, club or any other column from your CSV. Runners must have that info on the Participants page.</p>
			{#if !fieldNames.length}<p class="text-muted-foreground">No extra columns yet. Import a CSV with a column such as <code>team</code> or <code>club</code> to filter by it.</p>{/if}

			{#each customs as c, i (c.id)}
				<div class="space-y-3 border-2 border-border/40 p-3">
					<div class="flex flex-wrap items-end gap-3">
						<div class="min-w-56 flex-1">
							<Label class={lbl} for="cn{i}">Award name</Label>
							<Input id="cn{i}" bind:value={c.name} placeholder="e.g. Best club runner" class="h-11 border-2" />
						</div>
						<div class="w-32">
							<Label class={lbl} for="cp{i}">Places</Label>
							<Input id="cp{i}" type="number" min="1" max="10" bind:value={c.places} class="h-11 border-2" />
						</div>
						<Button type="button" variant="outline" class="h-11 {small}" onclick={() => customs.splice(i, 1)}>Remove</Button>
					</div>
					<div class="flex flex-wrap items-end gap-3">
						<div class="w-36">
							<Label class={lbl} for="cg{i}">Gender</Label>
							<select id="cg{i}" bind:value={c.gender} class="h-11 w-full border-2 border-border bg-card px-3">
								<option value="">Any</option>
								<option value="M">Men</option>
								<option value="F">Women</option>
							</select>
						</div>
						<div class="w-28"><Label class={lbl} for="ca{i}">Age from</Label><Input id="ca{i}" type="number" min="0" max="120" bind:value={c.ageMin} class="h-11 border-2" /></div>
						<div class="w-28"><Label class={lbl} for="cb{i}">Age to</Label><Input id="cb{i}" type="number" min="0" max="120" bind:value={c.ageMax} class="h-11 border-2" /></div>
						<div class="w-44">
							<Label class={lbl} for="cf{i}">Runner info</Label>
							<select id="cf{i}" bind:value={c.field} onchange={() => (c.value = '')} class="h-11 w-full border-2 border-border bg-card px-3">
								<option value="">None</option>
								{#each fieldNames as k}<option value={k}>{k}</option>{/each}
								{#if c.field && !fieldNames.includes(c.field)}<option value={c.field}>{c.field}</option>{/if}
							</select>
						</div>
						{#if c.field}
							<div class="min-w-44 flex-1">
								<Label class={lbl} for="cv{i}">Is equal to</Label>
								<Input id="cv{i}" bind:value={c.value} list="vals{i}" class="h-11 border-2" />
								<datalist id="vals{i}">{#each extraFields[c.field] ?? [] as v}<option value={v}></option>{/each}</datalist>
							</div>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-x-5 gap-y-1">
						<span class="font-bold tracking-wide uppercase">Categories:</span>
						{#each categories as cat}
							<label class="flex items-center gap-2"><input type="checkbox" checked={c.catIds.includes(cat.id)} onchange={() => toggleCat(c, cat.id)} class={check} />{cat.name}</label>
						{/each}
						<span class="text-sm text-muted-foreground">(none ticked = every category)</span>
					</div>
				</div>
			{/each}
			<Button type="button" variant="outline" class="h-11 {small}" onclick={addCustom}>Add a custom award</Button>
		</section>

		<Button type="submit" class="h-11 font-bold uppercase">Save awards settings</Button>
	</form>

	<!-- what would be shown -->
	<section class="space-y-3 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Who wins what right now</h2>
		<p class="text-muted-foreground">Based on the finishers so far, for the saved settings (gun time). {hidden ? 'This is what the public will see once you reveal.' : 'This is what the live board shows.'}</p>
		{#each preview as c (c.id)}
			<div class="border-2 border-border/40">
				<h3 class="bg-muted px-3 py-1 text-xl font-bold uppercase">{c.name} <span class="font-normal normal-case">{c.finished} of {c.total} finished</span></h3>
				{#each c.awards as a (a.key)}
					<p class="flex flex-wrap gap-x-3 border-t border-border/20 px-3 py-1">
						<b class="w-40 shrink-0 uppercase">{a.name}</b>
						<span>{#each a.winners as w, i}{i ? ' · ' : ''}{w.place}. {w.name || 'Bib ' + w.bib} <span class="text-muted-foreground">{fmt(w.time)}{w.detail ? `, ${w.detail}` : ''}</span>{/each}</span>
					</p>
				{:else}
					<p class="px-3 py-2 text-muted-foreground">No awards yet. Nobody has finished, or every award is switched off.</p>
				{/each}
			</div>
		{:else}
			<p class="text-muted-foreground">Nothing to show yet.</p>
		{/each}
	</section>

	<!-- winner photos -->
	<section class="space-y-3 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Winner photos</h2>
		<p class="text-muted-foreground">Add a photo for the winners. It shows on the live board next to the top three and in the award cards. Any photo from a phone works; it is shrunk before it is uploaded.</p>
		{#each preview as c (c.id)}
			{@const ws = winnersOf(c.awards)}
			{#if ws.length}
				<h3 class="bg-muted px-3 py-1 text-xl font-bold uppercase">{c.name}</h3>
				<div class="grid gap-3 md:grid-cols-2">
					{#each ws as w (w.bib)}
						{@const person = byBib.get(w.bib)}
						<div class="space-y-1 border-2 border-border/40 p-3">
							<p class="text-lg font-bold uppercase">{w.name || 'Bib ' + w.bib} <span class="font-normal text-muted-foreground normal-case">#{w.bib}</span></p>
							<p class="text-sm text-muted-foreground">{w.wins.join(' · ')}</p>
							{#if person}<PhotoUpload {slug} id={person.id} bib={w.bib} photo={person.photo} tab="awards" />{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/each}
	</section>
</div>
