<script lang="ts">
	import { goto } from '$app/navigation';
	import { phTime } from '$lib/time';
	import { SOURCE_LABEL, isManual, type Flag } from '$lib/readtrail';

	let { data } = $props();
	let search = $state('');
	let only = $state<'' | Flag>('');
	const FLAG: Record<Flag, string> = { gap: 'Missing checkpoint', order: 'Out of order', duplicate: 'Duplicate read', manual: 'Hand tapped', miss: 'Reader missed (hand only)', fast: 'Under 1 s between stations' };
	const COVER = { rfid: 'RFID only', hand: 'Hand only', both: 'Both', none: '' } as const;
	const ACTION: Record<string, string> = { void: 'Voided', restore: 'Restored', admin_add: 'Added by admin' };
	const th = 'px-3 py-2 text-left text-sm font-bold tracking-wide uppercase';
	const td = 'border-t-2 border-border px-3 py-2';
	const name = (id: number | null) => data.stations.find((s) => s.id === id)?.name ?? 'Unknown station';
	const shown = $derived(data.runners.filter((r) => (!only || r.flags.includes(only)) && `${r.bib} ${r.name}`.toLowerCase().includes(search.trim().toLowerCase())));
	const open = (bib: string) => goto(`?bib=${encodeURIComponent(bib)}`);
	const lag = (r: { read_at_ms: number; ingested_ms: number | null }) => (r.ingested_ms === null ? '' : `${Math.round((r.ingested_ms - r.read_at_ms) / 1000)} s`);
</script>

<div class="space-y-6 p-4">
	<h1 class="text-2xl font-bold uppercase">Reports - {data.event.name}</h1>
	<p>Every read as it was stored, split by how it got in: the RFID reader, a tap on the station laptop, an entry in the admin, or a marshal's phone.</p>

	<section class="overflow-x-auto border-2 border-border">
		<table class="w-full border-collapse">
			<thead>
				<tr class="bg-primary text-primary-foreground">
					<th class={th}>Station</th><th class={th}>RFID</th><th class={th}>Station tap</th><th class={th}>Admin entry</th><th class={th}>Marshal tap</th><th class={th}>Voided</th><th class={th}>% by hand</th><th class={th}>Station says (RFID / tap)</th><th class={th}>Check</th>
				</tr>
			</thead>
			<tbody>
				{#each data.perStation as s (s.id)}
					{@const total = s.rfid + s.station_manual + s.admin_manual + s.marshal}
					{@const rc = data.recon.find((x) => x.name === s.name)}
					<tr>
						<td class="{td} font-bold">{s.name}</td><td class={td}>{s.rfid}</td><td class={td}>{s.station_manual}</td><td class={td}>{s.admin_manual}</td><td class={td}>{s.marshal}</td><td class={td}>{s.voided}</td>
						<td class={td}>{total ? Math.round(((total - s.rfid) / total) * 100) : 0}%</td>
						<td class={td}>{rc && rc.stationRfid !== null ? `${rc.stationRfid} / ${rc.stationManual ?? '?'}` : 'unknown'}</td>
						<td class="{td} font-bold">{rc && (rc.missingRfid || rc.missingManual) ? `Central is short: ${rc.missingRfid} RFID, ${rc.missingManual} tap` : rc && rc.stationRfid !== null ? 'Matches' : ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
	{#if data.unassigned}<p class="border-2 border-border bg-card p-3 font-bold">{data.unassigned} read(s) are not matched to any runner yet (unknown tag). They are not in any trail below.</p>{/if}

	<section class="space-y-2">
		<div class="flex flex-wrap gap-2">
			<input class="h-10 border-2 border-border bg-card px-3" placeholder="Search bib or name" bind:value={search} />
			<select class="h-10 border-2 border-border bg-card px-3" bind:value={only}>
				<option value="">All runners</option>
				{#each Object.entries(FLAG) as [k, v]}<option value={k}>{v}</option>{/each}
			</select>
		</div>
		<div class="max-h-96 overflow-auto border-2 border-border">
			<table class="w-full border-collapse">
				<thead class="sticky top-0">
					<tr class="bg-primary text-primary-foreground"><th class={th}>Bib</th><th class={th}>Name</th><th class={th}>RFID</th><th class={th}>By hand</th><th class={th}>Voided</th><th class={th}>Check</th></tr>
				</thead>
				<tbody>
					{#each shown as r (r.bib)}
						<tr class="cursor-pointer hover:bg-accent {data.selected?.bib === r.bib ? 'bg-accent' : ''}" onclick={() => open(r.bib)}>
							<td class="{td} font-bold">{r.bib}</td><td class={td}>{r.name}</td><td class={td}>{r.rfid}</td><td class={td}>{r.manual}</td><td class={td}>{r.voided}</td>
							<td class={td}>{r.flags.length ? r.flags.map((f) => FLAG[f]).join(', ') : 'Clean'}</td>
						</tr>
					{:else}
						<tr><td class={td} colspan="6">No runners match.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	{#if data.selected}
		{@const t = data.selected.trail}
		<section class="space-y-3">
			<h2 class="text-xl font-bold uppercase">Bib {data.selected.bib} - {data.selected.name} <span class="text-base font-normal normal-case">{data.selected.category}</span></h2>
			{#if t.flags.length}<p class="border-2 border-border bg-card p-3 font-bold">{t.flags.map((f) => FLAG[f]).join(' / ')}</p>{/if}
			{#if data.selected.override}<p class="border-2 border-border bg-card p-3 font-bold">Finish time corrected by admin to {phTime(data.selected.override.finish_ms)} ({data.selected.override.reason}). The reads below are unchanged.</p>{/if}
			<div class="overflow-x-auto border-2 border-border">
				<table class="w-full border-collapse">
					<thead>
						<tr class="bg-primary text-primary-foreground">
							<th class={th}>Station</th><th class={th}>Read</th><th class={th}>Time (PH)</th><th class={th}>Source</th><th class={th}>Device / who</th><th class={th}>Arrived late by</th><th class={th}>Counts</th><th class={th}>Station check</th><th class={th}>Admin log</th>
						</tr>
					</thead>
					<tbody>
						{#each t.slots as s (s.station_id)}
							{#each s.reads as r, i (r.id)}
								<tr class={r.voided ? 'opacity-50 line-through' : ''}>
									<td class="{td} font-bold">{i === 0 ? name(s.station_id) : ''}</td><td class={td}>#{r.id}</td><td class={td}>{phTime(r.read_at_ms)}</td>
									<td class="{td} {isManual(r.source) ? 'font-bold' : ''}">{SOURCE_LABEL[r.source]}</td><td class={td}>{r.device_id}{r.key_label ? ` (key: ${r.key_label})` : ''}</td><td class={td}>{lag(r)}</td>
									<td class={td}>{r.voided ? 'Voided' : s.counted?.id === r.id ? 'Yes' : 'Extra'}</td>
									<td class={td}>{i === 0 ? COVER[s.coverage] : ''}</td>
									<td class={td}>{#each data.selected.audit.filter((a) => a.read_id === r.id) as a}<div>{ACTION[a.action] ?? a.action} {phTime(a.at_ms)}{a.reason ? ` - ${a.reason}` : ''}</div>{/each}</td>
								</tr>
							{/each}
							{#if !s.reads.length}<tr><td class="{td} font-bold">{name(s.station_id)}</td><td class={td} colspan="8">No read</td></tr>{/if}
						{/each}
					</tbody>
				</table>
			</div>
			{#if t.stray.length}
				<p class="font-bold">Reads at a station outside this runner's course:</p>
				<ul>
					{#each t.stray as r (r.id)}<li>#{r.id} {name(r.station_id)} - {phTime(r.read_at_ms)} - {SOURCE_LABEL[r.source]}{r.voided ? ' (voided)' : ''}</li>{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<p class="flex flex-wrap gap-3">
		<a class="inline-flex h-11 items-center border-2 border-border bg-card px-5 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=trail" download>Download read trails (CSV)</a>
		<a class="inline-flex h-11 items-center border-2 border-border bg-card px-5 font-bold uppercase hover:bg-accent" href="/admin/{data.event.slug}/export?kind=reads" download>Download all reads with source (CSV)</a>
	</p>

	<section class="space-y-2">
		<h2 class="text-xl font-bold uppercase">Hand taps ({data.handTaps.length})</h2>
		<div class="max-h-96 overflow-auto border-2 border-border">
			<table class="w-full border-collapse">
				<thead class="sticky top-0"><tr class="bg-primary text-primary-foreground"><th class={th}>Time (PH)</th><th class={th}>Station</th><th class={th}>Bib</th><th class={th}>Name</th><th class={th}>Source</th><th class={th}>Device / who</th></tr></thead>
				<tbody>
					{#each data.handTaps as h (h.id)}
						<tr><td class={td}>{phTime(h.read_at_ms)}</td><td class={td}>{h.station || 'Unknown'}</td><td class="{td} font-bold">{h.bib ?? '?'}</td><td class={td}>{h.name}</td><td class={td}>{SOURCE_LABEL[h.source]}</td><td class={td}>{h.device_id}</td></tr>
					{:else}<tr><td class={td} colspan="6">No hand taps.</td></tr>{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
