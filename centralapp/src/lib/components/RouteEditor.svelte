<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ElevationProfile from './ElevationProfile.svelte';
	import { decimate, MAX_UPLOAD_POINTS, parseGpx, spotAt, type Track } from '$lib/gpx';
	import { SERVICES } from '$lib/services';

	type St = { id: number; name: string; kind: string; services: string[] };
	type Cat = { id: number; name: string };
	let { slug, categories, routes, stationKm, stations, courses, tab }: { slug: string; categories: Cat[]; routes: Record<number, { track: Track | null; name: string }>; stationKm: Record<number, Record<number, number>>; stations: St[]; courses: Record<string, number[]>; tab: string } = $props();

	let catId = $state<number | null>(null); // each category has its own route and its own station distances
	const cat = $derived(categories.find((c) => c.id === catId) ?? categories[0]);
	const route = $derived(cat ? routes[cat.id] : undefined);
	const t = $derived(route?.track ?? null);
	const kms = $derived(cat ? (stationKm[cat.id] ?? {}) : {});

	let pts = $state('');
	let name = $state('');
	let err = $state('');
	let form = $state<HTMLFormElement>();

	// the file is read in the browser; only compact points are sent (a GPX can be several MB)
	async function pick(e: Event) {
		err = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const g = parseGpx(await file.text());
		if (g.pts.length < 2) return void (err = 'No track points found in that file. Use a .gpx exported with a route or track.');
		pts = JSON.stringify(decimate(g.pts, MAX_UPLOAD_POINTS).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), Number.isFinite(p[2]) ? +p[2].toFixed(1) : null]));
		name = g.name || file.name.replace(/\.gpx$/i, '');
		await Promise.resolve();
		form?.requestSubmit();
	}

	// no saved course = the category passes every station
	const onCourse = (s: St) => !courses[String(cat?.id)]?.length || courses[String(cat?.id)].includes(s.id);
	const kmFor =(s: St) => kms[s.id] ?? (s.kind === 'start' ? 0 : s.kind === 'finish' && t ? t.km : null);
	const pins = $derived(t ? stations.filter(onCourse).map((s) => ({ ...s, km: kmFor(s) })).filter((s): s is St & { km: number } => s.km !== null) : []);
	// do not blank the fields after saving: they show what was just saved
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const input = 'h-11 border-2 border-border bg-card px-3';
</script>

{#if !cat}
	<p class="border-2 border-border bg-card p-4 font-bold">Add a category first. Each category (distance) has its own GPX route.</p>
{:else}
	<div class="space-y-4">
		<div class="flex flex-wrap gap-2" role="tablist" aria-label="Category">
			{#each categories as c (c.id)}
				<button type="button" role="tab" aria-selected={c.id === cat.id} onclick={() => (catId = c.id)} class="h-11 border-2 border-border px-4 font-display text-2xl font-black uppercase {c.id === cat.id ? 'bg-primary text-primary-foreground' : 'bg-card'}">
					{c.name}{routes[c.id]?.track ? ' ✓' : ''}
				</button>
			{/each}
		</div>

		<form bind:this={form} method="POST" action="?tab={tab}&/saveRoute" use:enhance class="flex flex-wrap items-end gap-3 border-2 border-border bg-card p-4">
			<input type="hidden" name="category" value={cat.id} />
			<input type="hidden" name="pts" value={pts} />
			<input type="hidden" name="name" value={name} />
			<label class="block">
				<span class="mb-1 block font-bold tracking-wide uppercase">{t ? `Replace the ${cat.name} route` : `Upload the ${cat.name} GPX route`}</span>
				<input type="file" accept=".gpx,application/gpx+xml,text/xml" onchange={pick} class="{input} block py-2" />
			</label>
			{#if t}
				<span class="font-bold uppercase">{route?.name || 'Route'} · {t.km.toFixed(1)} km · +{Math.round(t.gain)} m / −{Math.round(t.loss)} m</span>
			{/if}
			{#if err}<p class="w-full font-bold text-destructive" role="alert">{err}</p>{/if}
		</form>

		{#if t}
			<div class="border-2 border-border bg-card p-4">
				{#key cat.id}<ElevationProfile track={t} {pins} height={150} />{/key}
				<div class="mt-3 flex flex-wrap items-center gap-3">
					<a href="/e/{slug}/map?cat={cat.id}" target="_blank" rel="noopener" class="font-bold uppercase underline">Open the route map</a>
					<a href="/e/{slug}/map?cat={cat.id}&display" target="_blank" rel="noopener" class="font-bold uppercase underline">Display mode (big screen)</a>
					<form method="POST" action="?tab={tab}&/clearRoute" use:enhance class="ml-auto">
						<input type="hidden" name="category" value={cat.id} />
						<Button type="submit" variant="outline" size="sm" class="h-9 border-2 font-bold uppercase">Remove this route</Button>
					</form>
				</div>
			</div>

			<p class="font-bold">Pin each station by its distance from the start of the {cat.name} route. Start and finish sit at the two ends unless you set a km. Untick "On {cat.name}" for a checkpoint this category does not pass: it leaves this map and the Progress page for {cat.name}. A checkpoint with no km is not shown on this map. Services are the same for every category.</p>
			<ul class="space-y-3">
				{#each stations as s (s.id)}
					{@const km = kmFor(s)}
					{@const spot = km === null ? null : spotAt(t, km)}
					<li class="border-2 border-border bg-card p-4">
						{#key cat.id}
							<form method="POST" action="?tab={tab}&/setStationRoute" use:enhance={keep} class="space-y-3">
								<input type="hidden" name="category" value={cat.id} />
								<input type="hidden" name="id" value={s.id} />
								<div class="flex flex-wrap items-end gap-3">
									<span class="min-w-40 text-xl font-bold uppercase">{s.name}<span class="ml-2 text-sm font-normal text-muted-foreground">{s.kind}</span></span>
										<label class="flex items-center gap-2 pb-2 font-bold uppercase"><input type="checkbox" name="on" value="1" checked={onCourse(s)} class="size-5 accent-black" />On {cat.name}</label>
									<label class="block"><span class="mb-1 block text-sm font-bold uppercase">Km from start</span><Input name="km" inputmode="decimal" value={kms[s.id] ?? ''} placeholder={km === null ? 'e.g. 15.4' : km.toFixed(1)} class="h-11 w-32 border-2" /></label>
									{#if spot}<span class="pb-2 font-bold uppercase">{spot.ele.toFixed(0)} m · +{Math.round(spot.gain)} / −{Math.round(spot.loss)} m so far</span>{/if}
								</div>
								<fieldset class="flex flex-wrap gap-x-5 gap-y-2">
									<legend class="mb-1 text-sm font-bold uppercase">Local services</legend>
									{#each SERVICES as sv}
										<label class="flex items-center gap-2 font-bold"><input type="checkbox" name="services" value={sv.key} checked={s.services.includes(sv.key)} class="size-5 accent-black" />{sv.label}</label>
									{/each}
								</fieldset>
								<Button type="submit" class="h-10 font-bold uppercase">Save {s.name}</Button>
							</form>
						{/key}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
