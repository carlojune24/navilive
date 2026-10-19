<script lang="ts">
	import RouteMap from '$lib/components/RouteMap.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.initial.event} · Route</title></svelte:head>

<div class="fixed inset-0"><RouteMap slug={data.slug} initial={data.initial} display={data.display} /></div>
