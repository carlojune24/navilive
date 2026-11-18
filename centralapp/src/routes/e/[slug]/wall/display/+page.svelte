<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { fmt } from '$lib/results';
	import { layoutOf } from '$lib/wall';
	import WallStage from '$lib/components/WallStage.svelte';

	let { data } = $props();

	// the runner the organizer picked on the finish wall page; it can be on any laptop, the live stream brings the change here
	const catId = $derived(data.display?.catId ?? -1);
	const back = $derived(data.backdrops.find((b) => b.category_id === catId));
	const runner = $derived(data.display ? data.results.categories.find((c) => c.id === catId)?.rows.find((r) => r.bib === data.display!.bib && r.time !== null) : undefined);
	const texts = $derived({ time: runner ? fmt(runner.time!) : '', name: runner ? data.display!.name || runner.name || 'Bib ' + runner.bib : '' });
	let draft = $state(layoutOf(undefined));
	$effect(() => {
		draft = layoutOf(back);
	});

	let full = $state(false);
	const toggle = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

	onMount(() => {
		const sync = () => (full = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', sync);
		let t: ReturnType<typeof setTimeout>;
		const es = new EventSource(`/e/${data.slug}/stream`);
		es.onopen = () => invalidateAll(); // catch up on anything missed while disconnected
		es.onmessage = () => (clearTimeout(t), (t = setTimeout(() => invalidateAll(), 250)));
		return () => (document.removeEventListener('fullscreenchange', sync), clearTimeout(t), es.close());
	});
</script>

<svelte:head><title>{data.results.event} · Finish wall display</title></svelte:head>

<!-- the whole screen is the button: a click (or Enter) toggles fullscreen, which browsers only allow after a click -->
<button type="button" onclick={toggle} class="display flex h-screen w-screen cursor-none items-center justify-center bg-black" aria-label={full ? 'Leave fullscreen' : 'Go fullscreen'}>
	<WallStage slug={data.slug} {catId} {back} bind:draft {texts} fill />
</button>
{#if !full}<p class="pointer-events-none fixed bottom-2 left-1/2 -translate-x-1/2 text-sm text-white/50">Click anywhere for fullscreen</p>{/if}

<style>
	:global(body) {
		background: #000;
		overflow: hidden;
	}
</style>
