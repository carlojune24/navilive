<script lang="ts">
	import { fmt, type CourseStation, type ProgressRow } from '$lib/results';

	// Who has reached which station. `flags` (admin) also shows runners who skipped a station, so a missed read can be fixed.
	type Props = { course: CourseStation[]; rows: ProgressRow[]; flags?: boolean; big?: boolean; pageSize?: number; onOverride?: (r: ProgressRow) => void; overridden?: (bib: string) => boolean };
	let { course, rows, flags = false, big = false, pageSize = 0, onOverride, overridden }: Props = $props(); // pageSize 0 = show every row

	let page = $state(0);
	const pages = $derived(pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1);
	const at = $derived(Math.min(page, pages - 1)); // rows can shrink under us (live updates, category switch)
	const shown = $derived(pageSize ? rows.slice(at * pageSize, (at + 1) * pageSize) : rows);

	const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	// the start station shows the clock time; every later station shows the race time at that point
	// r.start is what the race time is measured from (the gun start in gun mode), so the Start column shows it even for a runner with no start read
	const isStart = (i: number) => course[i].kind === 'start';
	const cell = (r: ProgressRow, i: number) => {
		const t = r.at[i];
		if (isStart(i)) return r.start !== null ? clock(r.start) : t === null ? null : clock(t);
		if (t === null) return null;
		return r.start === null ? clock(t) : fmt(Math.max(0, t - r.start));
	};
	const arrived = (i: number) => rows.filter((r) => (isStart(i) ? r.start !== null : r.at[i] !== null)).length;
	const status = { 'not-started': 'Not started', 'on-course': 'On course', finished: 'Finished' } as const;
	const text = $derived(big ? 'text-xl md:text-3xl' : 'text-base');
	const head = $derived(big ? 'text-base md:text-xl' : 'text-sm');
</script>

<div class="overflow-x-auto">
	<table class="w-full border-collapse text-left">
		<thead>
			<tr class="bg-primary text-primary-foreground">
				<th class="px-3 py-2 font-bold tracking-wide uppercase {head}">Rank</th>
				<th class="px-3 py-2 font-bold tracking-wide uppercase {head}">Bib</th>
				<th class="px-3 py-2 font-bold tracking-wide uppercase {head}">Name</th>
				<th class="px-3 py-2 font-bold tracking-wide uppercase {head}">Status</th>
				{#each course as s, i (s.id)}
					<th class="px-3 py-2 font-bold tracking-wide whitespace-nowrap uppercase {head}">
						{s.name}
						<span class="block font-normal normal-case opacity-80">{arrived(i)} of {rows.length}</span>
					</th>
				{/each}
				<th class="px-3 py-2 font-bold tracking-wide whitespace-nowrap uppercase {head}">Total time</th>
				{#if flags}<th class="px-3 py-2 font-bold tracking-wide uppercase {head}">Check</th>{/if}
				{#if onOverride}<th class="px-3 py-2 {head}"></th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each shown as r (r.bib)}
				<tr class="border-b-2 border-border/15 {r.state === 'not-started' ? 'text-muted-foreground' : ''}">
					<td class="font-display px-3 py-1 text-3xl leading-[0.9] font-black {big ? 'md:text-5xl' : ''}">{r.state === 'finished' && r.rank ? r.rank : '—'}</td>
					<td class="font-display px-3 py-1 text-3xl leading-[0.9] font-black {big ? 'md:text-5xl' : ''}">{r.bib}</td>
					<td class="px-3 py-1 font-bold uppercase {text}">{r.name || '—'}</td>
					<td class="px-3 py-1 whitespace-nowrap {text}">
						{#if r.state === 'finished'}<b>Finished</b>{:else if r.state === 'on-course'}{r.last ? `At ${r.last}` : 'Started'}{:else}{status[r.state]}{/if}
					</td>
					{#each course as s, i (s.id)}
						{@const v = cell(r, i)}
						<td class="px-3 py-1 font-display whitespace-nowrap {big ? 'text-3xl' : 'text-xl'} font-black" title={r.at[i] !== null ? `Read at ${clock(r.at[i]!)} (station clock)` : ''}>
								{v ?? '—'}
								<!-- the read time as the station recorded it; the first line is the race time since the start -->
								{#if flags && r.by[i]}<span class="block font-sans text-xs font-bold normal-case" title="Tagged by">{r.by[i] === 'MANUAL-CENTRAL' ? 'Manual' : r.by[i]}</span>{/if}
								{#if v !== null && r.at[i] !== null && (!isStart(i) ? r.start !== null : r.at[i] !== r.start)}<span class="block font-sans {big ? 'text-base' : 'text-xs'} font-normal text-muted-foreground">{isStart(i) ? 'read ' : ''}{clock(r.at[i]!)}</span>{/if}
							</td>
					{/each}
					<td class="px-3 py-1 font-display whitespace-nowrap {big ? 'text-3xl' : 'text-xl'} font-black">{r.time !== null ? fmt(r.time) : '—'}</td>
					{#if flags}
						<td class="px-3 py-1">
							{#if r.missed.length}<span class="inline-block border-2 border-destructive px-1 font-bold text-destructive uppercase">Missed: {r.missed.join(', ')}</span>{/if}
						</td>
					{/if}
					{#if onOverride}<td class="px-3 py-1 {text}"><button type="button" class="underline" onclick={() => onOverride(r)}>{overridden?.(r.bib) ? 'Override ✓' : 'Override'}</button></td>{/if}
				</tr>
			{:else}
				<tr><td colspan={course.length + 7} class="p-6 text-muted-foreground">No runners in this category yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="px-3 py-1 {big ? 'text-base' : 'text-xs'} text-muted-foreground">Small times under each result are the time of day the station read the tag (the station's own clock, not the server's).</p>
{#if pages > 1}
	<div class="flex flex-wrap items-center justify-between gap-2 border-t-2 border-border/15 px-4 py-2 font-bold uppercase">
		<span>{at * pageSize + 1}–{Math.min(rows.length, (at + 1) * pageSize)} of {rows.length}</span>
		<div class="flex items-center gap-1">
			<button type="button" class="border-2 border-border px-3 py-1 disabled:opacity-30" disabled={at === 0} onclick={() => (page = at - 1)}>Prev</button>
			{#each Array.from({ length: pages }, (_, i) => i) as i}
				<button type="button" class="min-w-9 border-2 border-border px-2 py-1 {i === at ? 'bg-primary text-primary-foreground' : ''}" aria-current={i === at ? 'page' : undefined} onclick={() => (page = i)}>{i + 1}</button>
			{/each}
			<button type="button" class="border-2 border-border px-3 py-1 disabled:opacity-30" disabled={at === pages - 1} onclick={() => (page = at + 1)}>Next</button>
		</div>
	</div>
{/if}
