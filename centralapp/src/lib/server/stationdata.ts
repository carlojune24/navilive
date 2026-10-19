import { q } from './db';

// A read belongs to the participant whose bib it carries, else whose tag matches. A manual entry at a station for a runner
// without an RFID tag is recorded under the bib number itself, so when no tag matches, a participant whose bib equals the
// read's tag also counts (the station app applies the same rule).
export const MATCH = `p.event_id=r.event_id and (p.bib=r.bib or (r.bib is null and (
	(p.tag<>'' and upper(p.tag)=upper(r.tag))
	or (p.bib=r.tag and not exists (select 1 from participants q where q.event_id=r.event_id and q.tag<>'' and upper(q.tag)=upper(r.tag)))
)))`;
const INGESTED = `(extract(epoch from max(ingested_at))*1000)::bigint`;

/** What each station has sent, plus reads whose station name matches no station (a setup mistake worth surfacing). */
export async function stationOverview(eventId: number) {
	const [stations, devices, unknown] = await Promise.all([
		q(
			`select s.id, s.name, s.kind,
			        count(r.id)::int as total,
			        count(r.id) filter (where r.voided)::int as voided,
			        count(distinct p.id)::int as runners,
			        count(r.id) filter (where p.id is null)::int as unmatched,
			        max(r.read_at_ms) as last_read_ms,
			        (extract(epoch from max(r.ingested_at))*1000)::bigint as last_in_ms
			 from stations s
			 left join reads r on r.station_id=s.id
			 left join participants p on ${MATCH}
			 where s.event_id=$1 group by s.id order by s.ord, s.id`,
			[eventId]
		),
		q(
			`select station_id, device_id, count(*)::int as n, ${INGESTED} as last_in_ms
			 from reads where event_id=$1 and station_id is not null group by station_id, device_id order by station_id, n desc`,
			[eventId]
		),
		q(
			`select station_name_sent as name, count(*)::int as n, ${INGESTED} as last_in_ms
			 from reads where event_id=$1 and station_id is null group by station_name_sent order by n desc`,
			[eventId]
		)
	]);
	return { stations: stations.map((s) => ({ ...s, devices: devices.filter((d) => d.station_id === s.id) })), unknown };
}
