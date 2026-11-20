import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadLaptops } from '$lib/server/monitor';
import { loadTrails } from '$lib/server/trails';
import type { Source } from '$lib/readtrail';
import { reconcile } from '$lib/reconcile';

// Admin only (the /admin hook). Read-only: every read as stored, split by how it got here.
export const load = async ({ params, url }) => {
	const [event] = await q<{ id: number; name: string; slug: string }>('select id, name, slug from events where slug=$1', [params.slug]);
	if (!event) error(404, 'Event not found');
	const [{ stations, people, reads, byBib, trails }, audit, overrides, laptops] = await Promise.all([
		loadTrails(event.id),
		q<{ read_id: number; action: string; reason: string; at_ms: number }>(
			'select read_id, action, reason, (extract(epoch from at)*1000)::float8 as at_ms from read_audit where event_id=$1 order by id', [event.id]),
		q<{ bib: string; finish_ms: number; reason: string; by: string }>(
			'select p.bib, f.finish_ms::float8 as finish_ms, f.reason, f.by from finish_overrides f join participants p on p.id=f.participant_id where p.event_id=$1', [event.id]),
		loadLaptops(event.id)
	]);

	const runners = trails.map(({ p, trail }) => {
		const all = byBib.get(p.bib) ?? [];
		const live = all.filter((r) => !r.voided);
		return {
			bib: p.bib,
			name: p.name,
			category: p.category ?? '',
			flags: trail.flags,
			rfid: live.filter((r) => r.source === 'rfid').length,
			manual: live.filter((r) => r.source !== 'rfid').length,
			voided: all.length - live.length
		};
	});

	const perStation = stations.map((s) => {
		const mine = reads.filter((r) => r.station_id === s.id);
		const n = (src: Source) => mine.filter((r) => !r.voided && r.source === src).length;
		return { ...s, rfid: n('rfid'), station_manual: n('station_manual'), admin_manual: n('admin_manual'), marshal: n('marshal'), voided: mine.filter((r) => r.voided).length };
	});
	const recon = reconcile(perStation, laptops.map((l) => l.payload.stations ?? []));

	const nameOf = new Map(people.map((p) => [p.bib, p.name]));
	const stationName = new Map(stations.map((s) => [s.id, s.name]));
	const handTaps = reads
		.filter((r) => !r.voided && r.source !== 'rfid')
		.map((r) => ({ id: r.id, bib: r.bib, name: r.bib ? (nameOf.get(r.bib) ?? '') : '', station: r.station_id ? (stationName.get(r.station_id) ?? '') : '', source: r.source, device_id: r.device_id, read_at_ms: r.read_at_ms }));

	const hit = trails.find((t) => t.p.bib === url.searchParams.get('bib'));
	const mineIds = new Set((hit ? (byBib.get(hit.p.bib) ?? []) : []).map((r) => r.id));
	return {
		event,
		stations,
		runners,
		perStation,
		recon,
		handTaps,
		unassigned: reads.filter((r) => !r.bib && !r.voided).length,
		selected: hit
			? {
					bib: hit.p.bib,
					name: hit.p.name,
					category: hit.p.category ?? '',
					trail: hit.trail,
					audit: audit.filter((a) => mineIds.has(a.read_id)),
					override: overrides.find((o) => o.bib === hit.p.bib) ?? null
				}
			: null
	};
};
