<script lang="ts">
	import { onMount, tick, type Component } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import ElevationProfile from '$lib/components/ElevationProfile.svelte';
	import { gradeStops, spotAt, type Track } from '$lib/gpx';
	import { SERVICES } from '$lib/services';
	import { fmt } from '$lib/results';
	import type { RouteStation, RouteCategory } from '$lib/server/route';
	import Soup from '@lucide/svelte/icons/soup';
	import Droplets from '@lucide/svelte/icons/droplets';
	import Zap from '@lucide/svelte/icons/zap';
	import Cross from '@lucide/svelte/icons/cross';
	import Armchair from '@lucide/svelte/icons/armchair';
	import Toilet from '@lucide/svelte/icons/toilet';
	import Backpack from '@lucide/svelte/icons/backpack';
	import ShowerHead from '@lucide/svelte/icons/shower-head';
	import Plug from '@lucide/svelte/icons/plug';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import X from '@lucide/svelte/icons/x';
	import Tv from '@lucide/svelte/icons/tv';

	type Payload = { event: string; categories: RouteCategory[]; category: number | null; name: string; track: Track | null; stations: RouteStation[]; lastReadAgoMs: number | null };

	const ICONS: Record<string, Component<{ class?: string }>> = { meal: Soup, water: Droplets, products: Zap, emergency: Cross, rest: Armchair, wc: Toilet, dropbag: Backpack, shower: ShowerHead, power: Plug };
	const LABEL = Object.fromEntries(SERVICES.map((s) => [s.key, s.label]));

	// compact = embedded beside the live board; display = big-screen loop. Without `initial` the route is fetched on mount.
	// `category` (the board's selected tab) picks whose route is shown; on its own the map has category buttons.
	let { slug, initial = null, display = false, compact = false, category = null }: { slug: string; initial?: Payload | null; display?: boolean; compact?: boolean; category?: number | null } = $props();
	// svelte-ignore state_referenced_locally
	let res = $state<Payload>(initial ?? { event: '', categories: [], category: null, name: '', track: null, stations: [], lastReadAgoMs: null });
	// svelte-ignore state_referenced_locally
	let catId = $state<number | null>(category ?? initial?.category ?? null);
	let loaded = $state(!!initial);
	const track = $derived(res.track);
	const stations = $derived(res.stations);
	// svelte-ignore state_referenced_locally
	let selectedId = $state<number | null>(initial?.stations[0]?.id ?? null); // the first station is selected by default
	const sel = $derived(stations.find((s) => s.id === selectedId) ?? stations[0] ?? null);
	let panelOpen = $state(true);
	let cursor = $state<number | null>(null);
	let flying = $state(false);
	const SEC_PER_KM = 12;
	let speed = $state(1);
	const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
	const slower = () => (speed = [...STEPS].reverse().find((v) => v < speed) ?? speed);
	const faster = () => (speed = STEPS.find((v) => v > speed) ?? speed);
	let basemap = $state<'dark' | 'satellite'>('dark');
	let showProfile = $state(true);
	let showStations = $state(true);
	let showRoute = $state(true);
	let flat = $state(false); // 2D top-down instead of tilted 3D terrain
	let connected = $state(false);
	let ready = $state(false);
	let mapError = $state('');

	let el = $state<HTMLDivElement>();
	let root = $state<HTMLDivElement>();
	let isFull = $state(false); // full screen hides the menu, like display mode
	let map: import('maplibre-gl').Map | undefined;
	let ml: typeof import('maplibre-gl');

	// route numbers: the whole route, or where the flyover / profile cursor is right now
	const stats = $derived.by((): [string, string, string, string][] => {
		if (!track) return [];
		const t = track;
		if (cursor === null) return [['Distance', t.km.toFixed(1), 'km', ''], ['Elevation gain', '+' + Math.round(t.gain), 'm', ''], ['Elevation loss', '−' + Math.round(t.loss), 'm', ''], ['High point', String(Math.round(t.max)), 'm', '']];
		const c = spotAt(t, cursor);
		return [['Distance', c.km.toFixed(1), 'km', `of ${t.km.toFixed(1)}`], ['Elevation gain', '+' + Math.round(c.gain), 'm', `of +${Math.round(t.gain)}`], ['Elevation loss', '−' + Math.round(c.loss), 'm', `of −${Math.round(t.loss)}`], ['Altitude', String(Math.round(c.ele)), 'm', `high ${Math.round(t.max)}`]];
	});
	const upNext = $derived(flying && cursor !== null ? stations.find((s) => s.km > cursor! + 0.3) : undefined);
	const spot = $derived(track && sel ? spotAt(track, sel.km) : null);
	const runners = $derived(sel?.runners ?? []);
	const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

	const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
		const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'; // open terrain tiles, no key needed

	function select(id: number, fly = true) {
		selectedId = id;
		panelOpen = true;
		if (!fly || !map || !track) return;
		stopFly();
		const s = stations.find((x) => x.id === id);
		if (!s) return;
		const p = spotAt(track, s.km);
		map.flyTo({ center: [p.lon, p.lat], zoom: 14.6, pitch: flat ? 0 : 62, bearing: flat ? 0 : p.bearing, speed: 0.9, essential: true });
	}

	function addRoute() {
		const m = map!;
		const empty = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } as const;
		m.addSource('route', { type: 'geojson', data: empty, lineMetrics: true });
		m.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0.55, 'line-blur': 4 } });
		m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 6, 'line-color': '#3ddc84' } });
	}
	// a different category (or a new upload) means a different route: redraw, recolour, refit, and stop any flyover
	let drawn: Track | null | undefined;
	$effect(() => {
		const t = track;
		if (!ready || !map || t === drawn) return;
		drawn = t;
		stopFly();
		flyKm = 0;
		const m = map;
		(m.getSource('route') as import('maplibre-gl').GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t ? t.pts.map((p) => [p[0], p[1]]) : [] } });
		if (!t) return;
		m.setPaintProperty('route-line', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...gradeStops(t, 80).flatMap((s) => [s.at, s.color])] as never);
		const b = new ml.LngLatBounds();
		t.pts.forEach((p) => b.extend([p[0], p[1]]));
		m.fitBounds(b, { padding: compact ? { top: 60, bottom: 140, left: 70, right: 70 } : { top: 90, bottom: 260, left: 40, right: innerWidth > 800 ? 420 : 40 }, pitch: flat ? 0 : 55, bearing: 0, duration: 0 });
	});
	// the board's category tab (or the buttons here) changes whose route is shown
	// svelte-ignore state_referenced_locally
	let lastCategory = category;
	$effect(() => {
		const c = category;
		if (c === lastCategory) return; // only when the board's tab itself changes, so the buttons here can pick another category
		lastCategory = c;
		if (c !== null) {
			catId = c;
			refresh();
		}
	});
	function chooseCategory(id: number) {
		catId = id;
		refresh();
	}

	// Pins are map layers (not DOM markers): they stay glued to the terrain at any tilt
	const point = (lon: number, lat: number, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: [lon, lat] } });
	function addPins() {
		const m = map!;
		m.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		m.addSource('cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		const on = ['==', ['get', 'on'], 1] as never;
		m.addLayer({ id: 'st-halo', type: 'circle', source: 'stations', filter: on, paint: { 'circle-radius': 22, 'circle-color': '#ffd21f', 'circle-opacity': 0.3, 'circle-pitch-alignment': 'viewport' } });
		m.addLayer({ id: 'st-dot', type: 'circle', source: 'stations', paint: { 'circle-radius': ['case', on, 17, 14], 'circle-color': ['case', on, '#ffd21f', '#0b0d12'], 'circle-stroke-color': ['case', on, '#fff', '#ffd21f'], 'circle-stroke-width': 3 } });
		m.addLayer({
			id: 'st-count',
			type: 'symbol',
			source: 'stations',
			layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true },
			paint: { 'text-color': ['case', on, '#0b0d12', '#ffd21f'] }
		});
		m.addLayer({
			id: 'st-label',
			type: 'symbol',
			source: 'stations',
			layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-transform': 'uppercase', 'text-variable-anchor': ['bottom', 'top', 'right', 'left'], 'text-radial-offset': 1.5, 'text-optional': true, 'symbol-sort-key': ['get', 'sort'] },
			paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 2.2 }
		});
		m.addLayer({ id: 'cursor-dot', type: 'circle', source: 'cursor', paint: { 'circle-radius': 8, 'circle-color': '#ffd21f', 'circle-stroke-color': '#000', 'circle-stroke-width': 3 } });
		m.on('click', 'st-dot', (e) => e.features?.[0] && select(Number(e.features[0].properties.id)));
		m.on('click', 'st-count', (e) => e.features?.[0] && select(Number(e.features[0].properties.id)));
		m.on('click', 'st-label', (e) => e.features?.[0] && select(Number(e.features[0].properties.id)));
		for (const id of ['st-dot', 'st-label', 'st-count']) {
			m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
		}
	}
	$effect(() => {
		if (!ready || !map || !track) return;
		const src = map.getSource('stations') as import('maplibre-gl').GeoJSONSource;
		const feats = stations.map((s) => {
			const p = spotAt(track, s.km);
			return point(p.lon, p.lat, { id: s.id, label: `${s.km.toFixed(1)} km · ${s.name}`, n: String(s.runners.length), sort: s.id === selectedId ? 0 : 1, on: s.id === selectedId ? 1 : 0 });
		});
		src.setData({ type: 'FeatureCollection', features: showStations ? feats : [] });
	});

	$effect(() => {
		if (!ready || !map) return;
		for (const id of ['route-glow', 'route-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showRoute ? 'visible' : 'none');
	});
	$effect(() => {
		if (!ready || !map) return;
		map.setLayoutProperty('sat', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
		map.setLayoutProperty('hill', 'visibility', basemap === 'dark' ? 'visible' : 'none');
	});
	$effect(() => {
		if (!ready || !map || flying) return;
		map.setTerrain(flat ? null : { source: 'dem', exaggeration: 1.35 });
		map.easeTo({ pitch: flat ? 0 : 55, bearing: flat ? 0 : map.getBearing(), duration: 700 });
	});
	$effect(() => {
		// the moving dot follows the finger or mouse on the profile
		if (!ready || !map || !track) return;
		const p = cursor === null ? null : spotAt(track, cursor);
		(map.getSource('cursor') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: p ? [point(p.lon, p.lat)] : [] });
	});

	// FLYOVER: the camera runs along the route at a fixed pace, looking ahead, tilted over the terrain
	let raf = 0;
	let flyKm = 0;
	let bearing = 0;
	function startFly() {
		if (!map || !track) return;
		stopFly();
		flying = true;
		panelOpen = true;
		if (flat) flat = false;
		if (flyKm >= track.km - 0.05) flyKm = 0;
		const s0 = spotAt(track, flyKm);
		bearing = s0.bearing;
		let cam = { lon: s0.lon, lat: s0.lat }; // the camera trails the runner marker a little, which irons out GPS zig-zags
		let last = performance.now();
		const frame = (t: number) => {
			if (!flying || !map || !track) return;
			const dt = Math.min((t - last) / 1000, 0.1);
			last = t;
			flyKm += (dt * track.km * speed) / (track.km * SEC_PER_KM); // 1x is 12 s per km whatever the route length
			if (flyKm >= track.km) {
				if (!display) return stopFly();
				flyKm = 0; // display mode loops
			}
			const a = spotAt(track, flyKm);
			const k = 1 - Math.exp(-dt * 2.5);
			cam = { lon: cam.lon + (a.lon - cam.lon) * k, lat: cam.lat + (a.lat - cam.lat) * k };
			// face a point well ahead (not the next few metres), and turn slowly: at most 15 degrees a second
			const ahead = spotAt(track, flyKm + 0.8);
			const want = ahead.km > a.km + 0.05 ? (Math.atan2((ahead.lon - cam.lon) * Math.cos(cam.lat * (Math.PI / 180)), ahead.lat - cam.lat) * 180) / Math.PI : bearing;
			const diff = ((want - bearing + 540) % 360) - 180; // shortest way round
			const turn = Math.max(-15 * dt, Math.min(15 * dt, diff * Math.min(1, dt * 0.8)));
			bearing = (bearing + turn + 360) % 360;
			map.jumpTo({ center: [cam.lon, cam.lat], bearing, pitch: 62, zoom: 14.2 });
			cursor = flyKm;
			const passed = [...stations].reverse().find((s) => s.km <= flyKm + 0.3);
			if (passed && passed.id !== selectedId) selectedId = passed.id;
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
	}
	function stopFly() {
		flying = false;
		cancelAnimationFrame(raf);
		cursor = null;
	}

	async function refresh() {
		try {
			const r = await fetch(`/e/${slug}/map/data${catId ? `?cat=${catId}` : ''}`);
			if (!r.ok) return;
			res = await r.json();
			loaded = true;
			catId = res.category; // the server falls back to the first category that has a route
			if (!res.stations.some((s) => s.id === selectedId)) selectedId = res.stations[0]?.id ?? null; // default: the first checkpoint
		} catch {
			/* the live dot shows the problem */
		}
	}

	function fullscreen() {
		// only the map goes full screen, so the board's title and buttons are out of the way
		document.fullscreenElement ? document.exitFullscreen() : root?.requestFullscreen?.().catch(() => {});
	}

	onMount(() => {
		let es: EventSource | undefined;
		const onFull = () => (isFull = document.fullscreenElement === root);
		document.addEventListener('fullscreenchange', onFull);
		let t: ReturnType<typeof setTimeout>;
		(async () => {
			if (!initial) await refresh();
			try {
				ml = await import('maplibre-gl');
			} catch {
				return void (mapError = 'The map could not be loaded.');
			}
			map = new ml.Map({
				container: el!,
				center: track ? [track.pts[0][0], track.pts[0][1]] : [0, 20],
				zoom: track ? 11 : 1.5,
				pitch: 55,
				maxPitch: 80,
				attributionControl: { compact: true },
				style: 'https://tiles.openfreemap.org/styles/dark' // free vector basemap, no key; satellite and terrain are added on load
			});
			map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
			map.on('error', (e) => console.warn('map', e.error?.message));
			['mousedown', 'touchstart', 'wheel'].forEach((ev) => map!.on(ev as 'mousedown', () => flying && stopFly()));
			map.on('load', () => {
				const m = map!;
				const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id; // keep place names above the imagery
				m.addSource('sat', { type: 'raster', tiles: [SAT], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri' });
				m.addSource('dem', { type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Terrain © Mapzen, AWS' });
				m.addSource('demhs', { type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: 15, encoding: 'terrarium' });
				m.addLayer({ id: 'hill', type: 'hillshade', source: 'demhs', paint: { 'hillshade-exaggeration': 0.7, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#9fb4cc' } }, before);
				m.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, before);
				m.setTerrain({ source: 'dem', exaggeration: 1.35 });
				m.setSky({ 'sky-color': '#0b0d12', 'horizon-color': '#27324a', 'fog-color': '#0b0d12', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.4 });
				addRoute();
				addPins();
				ready = true; // the effect below draws the route of the chosen category
				if (display && track) startFly();
			});
		})();
		{
			es = new EventSource(`/e/${slug}/stream`);
			es.onopen = () => ((connected = true), initial && refresh());
			es.onerror = () => (connected = false);
			es.onmessage = () => (clearTimeout(t), (t = setTimeout(refresh, 300)));
		}
		return () => (document.removeEventListener('fullscreenchange', onFull), stopFly(), clearTimeout(t), es?.close(), map?.remove());
	});
</script>

<div bind:this={root} class="absolute inset-0 overflow-hidden bg-[#0b0d12] text-[#e9edf3]" style="font-family:var(--font-sans)">
		<div bind:this={el} style="position:absolute;inset:0"></div>
		{#if mapError}<p class="absolute inset-x-0 top-1/2 text-center text-xl font-bold">{mapError}</p>{/if}
		{#if loaded && !track}
			<div class="pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6 text-center">
				<div class="bg-black/75 p-6">
					<p class="font-display text-4xl font-black uppercase italic md:text-5xl">No route yet{res.categories.find((x) => x.id === catId) ? ` for ${res.categories.find((x) => x.id === catId)?.name}` : ''}</p>
					<p class="mt-2 text-[#9aa6b8]">The organizer has not uploaded a GPX for this category.</p>
				</div>
			</div>
		{/if}

		<!-- title + route numbers -->
		{#if !compact}
		<header class="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4 pb-10">
			<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
				<div>
					<p class="stripe font-display text-4xl leading-[0.9] font-black uppercase italic md:text-6xl">{res.event}</p>
					<p class="mt-1 flex items-center gap-2 text-sm font-bold tracking-[0.2em] uppercase">
						<span class="inline-block size-2.5 rounded-full {connected ? 'live bg-[#3ddc84]' : 'bg-[#ff2e3d]'}"></span>{connected ? 'Live' : 'Reconnecting'}{res.name ? ` · ${res.name}` : ''}{upNext ? ` · next: ${upNext.name} in ${(upNext.km - cursor!).toFixed(1)} km` : ''}
					</p>
				</div>
				<dl class="pointer-events-auto ml-auto grid grid-cols-4 gap-x-5">
					{#each stats as [k, v, u, sub]}
						<div>
							<dt class="text-[11px] font-bold tracking-[0.18em] text-[#9aa6b8] uppercase">{k}</dt>
							<dd class="font-display text-3xl leading-none font-black italic tabular-nums md:text-5xl">{v}<span class="ml-1 text-base text-[#ffd21f] not-italic">{u}</span></dd>
							{#if sub}<dd class="text-xs font-semibold tracking-wider text-[#9aa6b8] uppercase">{sub}</dd>{/if}
						</div>
					{/each}
				</dl>
			</div>
		</header>
		{/if}

		<!-- display menu -->
		{#if !display && !isFull}
			<nav class="absolute left-4 z-20 flex flex-wrap gap-1.5 text-sm font-bold uppercase" style="top:{compact ? '0.6rem' : 'max(6.5rem, 14vw)'}" aria-label="Map display">
				{#if !compact && res.categories.length > 1}
					{#each res.categories as c (c.id)}<button type="button" onclick={() => chooseCategory(c.id)} aria-pressed={c.id === catId} class="chip {c.id === catId ? 'chip-on' : ''}">{c.name}{c.hasRoute ? '' : ' (no route)'}</button>{/each}
					<span class="w-full"></span>
				{/if}
				{#each [['Satellite', basemap === 'satellite', () => (basemap = basemap === 'dark' ? 'satellite' : 'dark')], ['Route', showRoute, () => (showRoute = !showRoute)], ['Stations', showStations, () => (showStations = !showStations)], ['Profile', showProfile, () => (showProfile = !showProfile)], ['2D', flat, () => (flat = !flat)]] as [label, on, go]}
					{#if !compact || label === 'Satellite' || label === '2D'}
					<button type="button" onclick={go as () => void} aria-pressed={on as boolean} class="chip {on ? 'chip-on' : ''}">{label}</button>{/if}
				{/each}
				{#if !compact}<button type="button" onclick={() => (flying ? stopFly() : startFly())} class="chip chip-hot">{#if flying}<Pause class="size-4" />Pause{:else}<Play class="size-4" />Flyover{/if}</button>
				{#if flying}
					<button type="button" onclick={() => slower()} disabled={speed <= STEPS[0]} class="chip" aria-label="Slower">−</button>
					<span class="chip chip-on min-w-14 justify-center tabular-nums" aria-live="polite" title="Whole route at this speed">{speed}× · {fmt(Math.round(((track?.km ?? 0) * SEC_PER_KM * 1000) / speed))}</span>
					<button type="button" onclick={() => faster()} disabled={speed >= STEPS[STEPS.length - 1]} class="chip" aria-label="Faster">+</button>
				{/if}{/if}
				{#if !compact}<a href="/e/{slug}/map?display{catId ? `&cat=${catId}` : ''}" class="chip" title="Big-screen mode: hides the menu and loops the flyover"><Tv class="size-4" />Display</a>
				<button type="button" onclick={fullscreen} class="chip">Fullscreen</button>{/if}
			</nav>
		{:else if display}
			<a href="/e/{slug}/map{catId ? `?cat=${catId}` : ''}" class="chip absolute right-16 bottom-3 z-20 opacity-60 hover:opacity-100" style="bottom:auto;top:1rem">Exit display</a>
		{:else}
			<button type="button" onclick={fullscreen} class="chip absolute right-16 z-20 opacity-60 hover:opacity-100" style="top:1rem">Exit full screen</button>
		{/if}

		<!-- legend -->
		<div class="pointer-events-none absolute left-4 z-10 hidden items-center gap-2 text-[11px] font-bold tracking-wider uppercase {compact ? 'md:hidden' : 'md:flex'}" style="bottom:{showProfile ? '15.5rem' : '1rem'}">
			<span>Grade</span>
			{#each [['#4fc3ff', 'Down'], ['#3ddc84', 'Flat'], ['#ffd21f', '3–6%'], ['#ff8a1f', '6–10%'], ['#ff2e3d', '10%+']] as [c, l]}<span class="flex items-center gap-1"><i class="inline-block h-2 w-5" style="background:{c}"></i>{l}</span>{/each}
		</div>

		<!-- elevation profile -->
		{#if showProfile && track}
			<section class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 pt-10 pb-2" aria-label="Elevation profile">
				<div class="mb-1 flex items-baseline gap-4 text-sm font-bold tracking-wider uppercase">
					<span class="text-[#9aa6b8]">Elevation</span>
					{#if cursor !== null}{@const c = spotAt(track, cursor)}<span class="text-[#ffd21f]">km {c.km.toFixed(1)} · {Math.round(c.ele)} m</span>{/if}
				</div>
				<ElevationProfile {track} pins={stations} selected={sel?.id ?? null} bind:cursor onpick={(id) => select(id)} dark height={compact ? 90 : 150} />
			</section>
		{/if}

		<!-- station card -->
		{#if sel && spot && track && panelOpen && !compact}
			<aside class="card absolute z-20 flex flex-col overflow-hidden {compact ? 'compact' : ''}" aria-label="Station {sel.name}">
				<div class="flex items-start gap-3 border-b border-white/15 p-4">
					<div class="min-w-0 flex-1">
						<p class="text-xs font-bold tracking-[0.2em] text-[#ffd21f] uppercase">{sel.kind} · km {sel.km.toFixed(1)}</p>
						<h2 class="font-display text-4xl leading-[0.9] font-black uppercase italic">{sel.name}</h2>
					</div>
					<button type="button" onclick={() => (panelOpen = false)} class="p-1 text-[#9aa6b8] hover:text-white" aria-label="Close"><X class="size-6" /></button>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<dl class="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
						{#each [['Location', sel.name], ['Altitude', `${Math.round(spot.ele)} m`], ['Total distance', `${track.km.toFixed(1)} km`], ['Distance from start', `${spot.km.toFixed(1)} km`], ['Total elevation gain', `${Math.round(track.gain)} m+`], ['Gain from start', `${Math.round(spot.gain)} m+`], ['Total elevation loss', `${Math.round(track.loss)} m−`], ['Loss from start', `${Math.round(spot.loss)} m−`]] as [k, v]}
							<div class="min-w-0"><dt class="text-[11px] font-semibold tracking-[0.16em] text-[#9aa6b8] uppercase">{k}</dt><dd class="truncate font-display text-xl font-black text-[#ffd21f] uppercase italic">{v}</dd></div>
						{/each}
					</dl>
					{#if sel.services.length}
						<div class="px-4 pb-4">
							<p class="mb-2 text-[11px] font-semibold tracking-[0.16em] text-[#9aa6b8] uppercase">Local services</p>
							<ul class="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
								{#each sel.services as k}{@const Icon = ICONS[k]}{#if Icon}<li class="flex items-center gap-2 font-display text-base font-black uppercase italic"><Icon class="size-6 shrink-0 text-[#ffd21f]" />{LABEL[k]}</li>{/if}{/each}
							</ul>
						</div>
					{/if}
					<div class="border-t border-white/15 p-4">
						<div class="mb-2 flex flex-wrap items-center gap-2">
							<p class="font-display text-2xl font-black uppercase italic">Passed <span class="text-[#ffd21f]">{sel.runners.length}</span></p>
						</div>
						{#if runners.length}
							<ol class="divide-y divide-white/10">
								{#each runners as r (r.bib)}
									<li class="flex items-center gap-3 py-1.5">
										<span class="w-8 text-right font-display text-2xl font-black italic tabular-nums {r.rank <= 3 ? 'text-[#ffd21f]' : 'text-[#9aa6b8]'}">{r.rank}</span>
										<span class="w-12 font-display text-xl font-black tabular-nums">{r.bib}</span>
										<span class="min-w-0 flex-1 truncate font-semibold uppercase">{r.name}</span>
										<span class="text-right tabular-nums"><span class="block font-bold">{r.elapsed !== null ? fmt(r.elapsed) : '—'}</span><span class="block text-xs text-[#9aa6b8]">{clock(r.at)}</span></span>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="py-3 text-[#9aa6b8]">Nobody has reached this point yet.</p>
						{/if}
					</div>
				</div>
			</aside>
		{:else if sel && !display && !compact}
			<button type="button" onclick={() => (panelOpen = true)} class="chip chip-on absolute right-4 z-20" style="top:{compact ? '0.6rem' : '7rem'}">{sel.name}</button>
		{/if}
</div>

<style>
	.stripe {
		border-left: 8px solid #ffd21f;
		padding-left: 12px;
		text-shadow: 0 2px 12px #000;
	}
	.card {
		background: rgba(11, 13, 18, 0.92);
		backdrop-filter: blur(6px);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-top: 4px solid #ffd21f;
		right: 1rem;
		top: 7rem;
		bottom: 14rem;
		width: min(26rem, calc(100vw - 2rem));
	}
	.card.compact {
		left: 0.5rem;
		right: 0.5rem;
		top: auto;
		bottom: 7.2rem;
		width: auto;
		max-height: 40%;
	}
	@media (max-width: 767px) {
		.card:not(.compact) {
			left: 1rem;
			top: auto;
			bottom: 12rem;
			max-height: 52dvh;
			width: auto;
		}
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: rgba(11, 13, 18, 0.85);
		border: 1.5px solid rgba(255, 255, 255, 0.35);
		color: #e9edf3;
		transform: skewX(-10deg);
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.chip:disabled {
		opacity: 0.35;
	}
	.chip:hover {
		border-color: #ffd21f;
	}
	.chip-on {
		background: #ffd21f;
		border-color: #ffd21f;
		color: #0b0d12;
	}
	.chip-hot {
		background: #ff2e3d;
		border-color: #ff2e3d;
	}
	.live {
		animation: pulse 1.4s infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
