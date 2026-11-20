import { q } from './db';
import { buildTrail, type TrailRead } from '$lib/readtrail';
import { MATCH } from './stationdata';

/** Every runner's read trail for an event (the Reports page and its CSV share this). Reads without a bib are returned apart. */
export async function loadTrails(eventId: number) {
	const [stations, people, courses, reads] = await Promise.all([
		q<{ id: number; name: string; kind: string }>('select id, name, kind from stations where event_id=$1 order by ord, id', [eventId]),
		q<{ bib: string; name: string; category_id: number | null; category: string | null }>(
			'select p.bib, p.name, p.category_id, c.name as category from participants p left join categories c on c.id=p.category_id where p.event_id=$1 order by p.bib',
			[eventId]
		),
		q<{ category_id: number; station_id: number }>(
			'select cc.category_id, cc.station_id from category_courses cc join categories c on c.id=cc.category_id where c.event_id=$1 order by cc.ord',
			[eventId]
		),
		q<TrailRead & { bib: string | null }>(
			`select r.id, coalesce(r.bib, p.bib) as bib, r.station_id, r.read_at_ms::float8 as read_at_ms, (extract(epoch from r.ingested_at)*1000)::float8 as ingested_ms, r.device_id, r.source, r.voided, k.label as key_label
			 from reads r left join station_keys k on k.id=r.key_id
			 left join participants p on ${MATCH}
			 where r.event_id=$1 order by r.read_at_ms, r.id`,
			[eventId]
		)
	]);
	const allIds = stations.map((s) => s.id);
	const courseOf = new Map<number, number[]>();
	for (const c of courses) courseOf.set(c.category_id, [...(courseOf.get(c.category_id) ?? []), c.station_id]);
	const byBib = new Map<string, TrailRead[]>();
	for (const r of reads) if (r.bib) byBib.set(r.bib, [...(byBib.get(r.bib) ?? []), r]);
	const trails = people.map((p) => ({ p, trail: buildTrail((p.category_id && courseOf.get(p.category_id)) || allIds, byBib.get(p.bib) ?? []) }));
	return { stations, people, reads, byBib, trails };
}
