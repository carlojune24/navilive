<script lang="ts">
	import { gradeStops, spotAt, type Track } from '$lib/gpx';

	type Pin = { id: number; name: string; km: number };
	let {
		track,
		pins = [],
		selected = null,
		cursor = $bindable<number | null>(null),
		onpick,
		dark = false,
		height = 160
	}: { track: Track; pins?: Pin[]; selected?: number | null; cursor?: number | null; onpick?: (id: number) => void; dark?: boolean; height?: number } = $props();

	let W = $state(1000); // real pixel width, so labels and pins are not stretched
	const H = $derived(height);
	const PAD = 30; // room for the pin labels above the line
	// exaggerate flat routes a little so a 30 m rise is still visible, but never below a 100 m range
	const lo = $derived(Math.floor(track.min / 10) * 10 - 10);
	const hi = $derived(Math.max(Math.ceil(track.max / 10) * 10 + 10, lo + 100));
	const x = (km: number) => (km / track.km) * W;
	const y = (ele: number) => H - ((ele - lo) / (hi - lo)) * (H - PAD);

	const line = $derived(track.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[3]).toFixed(1)},${y(p[2]).toFixed(1)}`).join(''));
	const area = $derived(`${line}L${W},${H}L0,${H}Z`);
	const stops = $derived(gradeStops(track));
	const gid = `g${Math.random().toString(36).slice(2, 8)}`;
	const ticks = $derived.by(() => {
		const step = track.km > 60 ? 10 : track.km > 25 ? 5 : track.km > 8 ? 2 : 1;
		return Array.from({ length: Math.floor(track.km / step) + 1 }, (_, i) => i * step);
	});
	const cur = $derived(cursor === null ? null : spotAt(track, cursor));

	function move(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		cursor = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * track.km;
	}
	const ink = $derived(dark ? '#e9edf3' : '#111');
</script>

<svg bind:clientWidth={W} viewBox="0 0 {W} {H + 18}" width="100%" height={H + 18} class="block w-full touch-none overflow-visible select-none" role="img" aria-label="Elevation profile" onpointermove={move} onpointerleave={() => (cursor = null)}>
	<defs>
		<linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
			{#each stops as s}<stop offset={s.at} stop-color={s.color} />{/each}
		</linearGradient>
	</defs>
	<path d={area} fill="url(#{gid})" opacity={dark ? 0.55 : 0.8} />
	<path d={line} fill="none" stroke={ink} stroke-width="3" vector-effect="non-scaling-stroke" />
	{#each ticks as t}
		<line x1={x(t)} x2={x(t)} y1={H} y2={H + 5} stroke={ink} vector-effect="non-scaling-stroke" opacity="0.6" />
		<text x={x(t)} y={H + 16} fill={ink} font-size="11" text-anchor={t === 0 ? 'start' : 'middle'} opacity="0.7" style="font-family:inherit">{t}</text>
	{/each}
	{#each pins as p (p.id)}
		{@const s = spotAt(track, p.km)}
		<g role="button" tabindex="0" aria-label={p.name} class="cursor-pointer" onclick={() => onpick?.(p.id)} onkeydown={(e) => e.key === 'Enter' && onpick?.(p.id)}>
			<line x1={x(p.km)} x2={x(p.km)} y1={y(s.ele)} y2={H} stroke={selected === p.id ? '#ffd21f' : ink} stroke-width={selected === p.id ? 3 : 1.5} vector-effect="non-scaling-stroke" stroke-dasharray="4 3" />
			<rect x={x(p.km) - 7} y={y(s.ele) - 7} width="14" height="14" transform="rotate(45 {x(p.km)} {y(s.ele)})" fill={selected === p.id ? '#ffd21f' : dark ? '#0b0d12' : '#fff'} stroke={selected === p.id ? '#fff' : ink} stroke-width="2.5" vector-effect="non-scaling-stroke" />
		</g>
	{/each}
	{#if cur}
	<g pointer-events="none">
		<line x1={x(cur.km)} x2={x(cur.km)} y1="0" y2={H} stroke="#ffd21f" stroke-width="2" vector-effect="non-scaling-stroke" />
		<circle cx={x(cur.km)} cy={y(cur.ele)} r="6" fill="#ffd21f" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke" />
	</g>
	{/if}
</svg>
