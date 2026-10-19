import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { MATCH } from '$lib/server/stationdata';

export const load = async ({ params, url }) => {
	const [e] = await q<{ id: number; name: string; slug: string }>('select id, name, slug from events where slug=$1', [params.slug]);
	if (!e) error(404, 'Event not found');
	const [st] = await q<{ id: number; name: string; kind: string }>('select id, name, kind from stations where id=$1 and event_id=$2', [Number(params.id), e.id]);
	if (!st) error(404, 'Station not found');

	const search = (url.searchParams.get('q') ?? '').trim();
	const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
	const [reads, devices, totals] = await Promise.all([
		q(
			`select r.id, r.read_at_ms, r.tag, r.device_id, r.voided, (extract(epoch from r.ingested_at)*1000)::bigint as received_ms,
			        coalesce(r.bib, p.bib) as bib, p.name, (p.id is null) as unmatched
			 from reads r left join participants p on ${MATCH}
			 where r.event_id=$1 and r.station_id=$2
			   and ($3 = '' or coalesce(r.bib, p.bib) ilike $4 or p.name ilike $4 or r.tag ilike $4)
			 order by r.read_at_ms desc, r.id desc limit 500`,
			[e.id, st.id, search, like]
		),
		q(
			`select device_id, count(*)::int as n, (extract(epoch from max(ingested_at))*1000)::bigint as last_in_ms
			 from reads where event_id=$1 and station_id=$2 group by device_id order by n desc`,
			[e.id, st.id]
		),
		q<{ total: number; voided: number }>('select count(*)::int as total, count(*) filter (where voided)::int as voided from reads where event_id=$1 and station_id=$2', [e.id, st.id])
	]);
	return { event: e, station: st, search, reads, devices, total: totals[0].total, voided: totals[0].voided };
};
