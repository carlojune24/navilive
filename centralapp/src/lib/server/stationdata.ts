import { q } from './db';

// A read belongs to the participant whose bib it carries, else whose tag matches. A manual entry at a station for a runner
// without an RFID tag is recorded under the bib number itself, so when no tag matches, a participant whose bib equals the
// read's tag also counts (the station app applies the same rule).
// Written as a direct lookup per read (bib, then tag, then a team member's tag, then a bib typed as the tag): an OR join
// over every runner took seconds on a big event and slowed every board refresh. Same matches, checked on real data.
export const MATCH = `p.id = coalesce(
	(select x.id from participants x where x.event_id=r.event_id and x.bib=r.bib),
	case when r.bib is null then coalesce(
		(select x.id from participants x where x.event_id=r.event_id and x.tag<>'' and upper(x.tag)=upper(r.tag) limit 1),
		(select tm.participant_id from team_members tm where tm.event_id=r.event_id and tm.tag<>'' and upper(tm.tag)=upper(r.tag) limit 1),
		(select x.id from participants x where x.event_id=r.event_id and x.bib=r.tag limit 1)
	) end)`;
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
