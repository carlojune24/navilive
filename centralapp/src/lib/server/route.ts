import { q } from './db';
import { loadResults } from './live';
import { isTrack, type Track } from '$lib/gpx';

export type StationRunner = { rank: number; bib: string; name: string; at: number; elapsed: number | null };
export type RouteStation = { id: number; name: string; kind: string; km: number; services: string[]; runners: StationRunner[] };
export type RouteCategory = { id: number; name: string; hasRoute: boolean };

/**
 * What the route map shows for ONE category: its route, the stations that category passes (pinned by their km on that route),
 * and who of that category has passed each one, first to last. `catId` null/unknown = the first category that has a route.
 */
export async function loadRoute(slug: string, catId?: number | null) {
	const [ev] = await q<{ id: number; name: string }>('select id, name from events where slug=$1', [slug]);
	if (!ev) return null;
	const cats = await q<RouteCategory>('select id, name, gpx is not null as "hasRoute" from categories where event_id=$1 and archived_at is null order by name', [ev.id]);
	const chosen = cats.find((c) => c.id === catId) ?? cats.find((c) => c.hasRoute) ?? cats[0];
	const empty = { event: ev.name, categories: cats, category: chosen?.id ?? null, name: '', track: null as Track | null, stations: [] as RouteStation[], lastReadAgoMs: null as number | null };
	if (!chosen) return empty;
	const [row] = await q<{ gpx: unknown; gpx_name: string | null }>('select gpx, gpx_name from categories where id=$1', [chosen.id]);
	if (!isTrack(row?.gpx)) return empty;
	const track: Track = row.gpx;
	const [rows, kms, res] = await Promise.all([
		q<{ id: number; name: string; kind: string; services: string[] }>('select id, name, kind, services from stations where event_id=$1 order by ord, id', [ev.id]),
		q<{ station_id: number; km: string }>('select station_id, km from category_station_km where category_id=$1', [chosen.id]),
		loadResults(slug, 'gun')
	]);
	const kmOf = new Map(kms.map((k) => [k.station_id, Number(k.km)]));
	const c = res?.categories.find((x) => x.id === chosen.id);
	const inCourse = c ? new Set(c.course.map((s) => s.id)) : null; // a category with no runners yet passes every station
	const stations: RouteStation[] = [];
	for (const s of rows) {
		if (inCourse && !inCourse.has(s.id)) continue;
		// start and finish default to the two ends of the route; a checkpoint with no km is not on this map yet
		const km = kmOf.get(s.id) ?? (s.kind === 'start' ? 0 : s.kind === 'finish' ? track.km : null);
		if (km === null) continue;
		const i = c ? c.course.findIndex((x) => x.id === s.id) : -1;
		const runners = (c && i >= 0 ? c.progress : [])
			.filter((r) => r.at[i] !== null)
			.map((r) => ({ bib: r.bib, name: r.name, at: r.at[i]!, elapsed: r.start !== null ? r.at[i]! - r.start : null }))
			.sort((a, b) => (a.elapsed ?? Infinity) - (b.elapsed ?? Infinity) || a.at - b.at);
		stations.push({ id: s.id, name: s.name, kind: s.kind, km, services: s.services, runners: runners.map((r, k) => ({ ...r, rank: k + 1 })) });
	}
	stations.sort((a, b) => a.km - b.km);
	return { ...empty, name: row.gpx_name ?? '', track, stations, lastReadAgoMs: res?.lastReadAgoMs ?? null };
}
