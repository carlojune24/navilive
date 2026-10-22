<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { ago } from '$lib/time';
	import { monitor } from '$lib/monitor.svelte';
	import { linkState } from '$lib/heartbeat';
	import Users from '@lucide/svelte/icons/users';
	import Tags from '@lucide/svelte/icons/tags';
	import Flag from '@lucide/svelte/icons/flag';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Trophy from '@lucide/svelte/icons/trophy';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Activity from '@lucide/svelte/icons/activity';
	import Plug from '@lucide/svelte/icons/plug';
	import Radio from '@lucide/svelte/icons/radio';
	import Route from '@lucide/svelte/icons/route';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MapIcon from '@lucide/svelte/icons/map';
	import KeyRound from '@lucide/svelte/icons/key-round';

	let { children } = $props();
	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	// real time: the server pings on every heartbeat and every read; we fetch a light snapshot (not the whole page).
	// Lives here, not in a page, so it keeps running on every event page (station detail, reads, ...) and feeds the sidebar.
	$effect(() => {
		const slug = (page.data.event as { slug: string } | undefined)?.slug;
		if (!slug) return;
		const pull = async () => {
			try {
				const r = await fetch(`/admin/${slug}/monitor`);
				if (!r.ok) return;
				const j = await r.json();
				monitor.laptops = j.laptops;
				monitor.stationData = j.stationData;
			} catch {
				/* the connection light shows the problem */
			}
		};
		// Pull straight from the push, not from a timer: a tab in the background gets its timers slowed to about once a minute,
		// which made a healthy laptop look LATE or OFFLINE. Server pushes and visibility changes are not throttled that way.
		let busy = false;
		let again = false;
		const pullNow = async () => {
			if (busy) return void (again = true);
			busy = true;
			await pull();
			busy = false;
			if (again) (again = false), void pullNow();
		};
		const es = new EventSource(`/admin/${slug}/monitor/stream`);
		es.onopen = () => ((monitor.connected = true), void pullNow());
		es.onerror = () => (monitor.connected = false);
		es.onmessage = () => void pullNow();
		const visible = () => document.visibilityState === 'visible' && void pullNow();
		document.addEventListener('visibilitychange', visible);
		const fallback = setInterval(pullNow, 15000); // safety net if a push is ever missed
		return () => (es.close(), clearInterval(fallback), document.removeEventListener('visibilitychange', visible), (monitor.connected = false));
	});

	// the event pages publish `event` (and the event page also `stationData`) in their load data
	const ev = $derived(page.data.event as { name: string; slug: string } | undefined);
	const isStation = $derived(page.url.pathname.includes('/station/'));
	const activeTab = $derived(isStation ? 'data' : (page.url.searchParams.get('tab') ?? 'participants'));

	const eventItems = [
		['participants', 'Participants', Users],
		['categories', 'Categories', Tags],
		['stations', 'Stations', Flag],
		['route', 'Route & map', MapIcon],
		['progress', 'Progress', Route],
		['results', 'Results', ListOrdered],
		['awards', 'Awards', Trophy],
		['reads', 'Reads', ListChecks],
		['data', 'Station data', Activity],
		['connect', 'Connect', Plug]
	] as const;

	// status strip: is data arriving, and how many stations are reporting (last 10 minutes)
	const stations = $derived(((monitor.stationData ?? page.data.stationData)?.stations ?? []) as { last_in_ms: number | null }[]);
	const laptops = $derived((monitor.laptops ?? page.data.laptops ?? []) as { last_seen_ms: number }[]);
	const online = $derived(laptops.filter((l) => linkState(l.last_seen_ms, now) === 'online').length);
	const offline = $derived(laptops.filter((l) => linkState(l.last_seen_ms, now) === 'offline').length);
	const lastIn = $derived(stations.reduce((m, s) => Math.max(m, Number(s.last_in_ms ?? 0)), 0) || null);
	const reporting = $derived(stations.filter((s) => s.last_in_ms && now - Number(s.last_in_ms) < 10 * 60_000).length);
	const receiving = $derived(lastIn !== null && now - lastIn < 10 * 60_000);

	const base = 'flex h-10 items-center gap-3 border-2 px-3 text-sm font-bold uppercase';
	const on = 'border-border bg-primary text-primary-foreground';
	const off = 'border-transparent hover:border-border';
</script>

{#snippet nav(compact: boolean)}
	{#if ev}
		{#each eventItems as [id, label, Icon]}
			<a href="/admin/{ev.slug}?tab={id}" class="{base} {activeTab === id ? on : off}" aria-current={activeTab === id ? 'page' : undefined}>
				<Icon class="size-5 shrink-0" />{label}
			</a>
		{/each}
		<a href="/e/{ev.slug}" target="_blank" rel="noopener" class="{base} {off}"><Radio class="size-5 shrink-0" />Live board</a>
		{#if !compact}<div class="perf my-2" aria-hidden="true"></div>{/if}
	{/if}
	<a href="/admin" class="{base} {page.url.pathname === '/admin' ? on : off}"><CalendarDays class="size-5 shrink-0" />{ev ? 'All events' : 'Events'}</a>
	<a href="/admin/guide" class="{base} {page.url.pathname === '/admin/guide' ? on : off}"><BookOpen class="size-5 shrink-0" />Setup guide</a>
	<a href="/admin/account" class="{base} {page.url.pathname === '/admin/account' ? on : off}"><KeyRound class="size-5 shrink-0" />Password</a>
{/snippet}

<!-- desktop: fixed rail, like the station app -->
<aside class="fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r-2 border-border bg-card md:flex print:hidden">
	<div class="px-5 pt-5">
		<p class="font-display text-[44px] leading-[0.85] font-black uppercase">Race<br />Central</p>
		{#if ev}<p class="mt-3 truncate text-sm font-bold tracking-wide uppercase" title={ev.name}>{ev.name}</p>{/if}
	</div>
	<div class="perf mx-0 mt-3 mb-2" aria-hidden="true"></div>
	<nav class="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Admin">{@render nav(false)}</nav>
	<div class="perf" aria-hidden="true"></div>
	<div class="space-y-1 px-5 py-3 text-sm font-bold uppercase" role="status">
		{#if ev && (stations.length || laptops.length)}
			<p class="flex items-center gap-2">
				<span class="inline-block size-4 shrink-0 border-2 border-border" style="background:{receiving ? 'var(--start)' : 'transparent'}"></span>
				{lastIn ? `Last read ${ago(lastIn, now)}` : 'No reads yet'}
			</p>
			{#if laptops.length}
				<p class="flex items-center gap-2">
					<span class="inline-block size-4 shrink-0 border-2 border-border" style="background:{offline ? 'var(--finish)' : online === laptops.length ? 'var(--start)' : 'var(--checkpoint)'}"></span>
					{online} of {laptops.length} laptops online{offline ? ` · ${offline} offline` : ''}
				</p>
			{:else}
				<p class="flex items-center gap-2">
					<span class="inline-block size-4 shrink-0 border-2 border-border" style="background:{reporting ? 'var(--start)' : 'transparent'}"></span>
					{reporting} of {stations.length} stations reporting
				</p>
			{/if}
		{/if}
		<p class="pt-1 text-xs font-normal tracking-normal normal-case">{page.url.host}</p>
		<form method="POST" action="/logout">
			<button type="submit" class="mt-1 inline-flex items-center gap-2 font-bold uppercase underline"><LogOut class="size-4" />Sign out</button>
		</form>
	</div>
</aside>

<!-- narrow screens: the same menu as a scrolling strip on top -->
<header class="border-b-2 border-border bg-card md:hidden print:hidden">
	<p class="px-4 pt-3 font-display text-3xl leading-[0.85] font-black uppercase">Race Central{ev ? ` · ${ev.name}` : ''}</p>
	<nav class="flex gap-1 overflow-x-auto p-2" aria-label="Admin">{@render nav(true)}</nav>
</header>

<div class="min-h-screen md:pl-[216px] print:pl-0">{@render children()}</div>

<style>
	.perf {
		height: 6px;
		background-image: radial-gradient(circle, oklch(0.7 0.01 260) 1.6px, transparent 1.8px);
		background-size: 12px 6px;
	}
</style>
