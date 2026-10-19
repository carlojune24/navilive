import { q } from './db';
import { stationOverview } from './stationdata';

export type Laptop = {
	laptop_id: string;
	laptop_name: string;
	app_version: string;
	clock_skew_ms: number | null;
	last_seen_ms: number;
	first_seen_ms: number;
	payload: { stations?: { name: string; kind: string; readersTotal: number; readersOnline: number; lastReadMs: number | null; pending: number }[]; pending?: number; lastError?: string };
};

export async function loadLaptops(eventId: number) {
	return q<Laptop>(
		`select laptop_id, laptop_name, app_version, clock_skew_ms, payload,
		        (extract(epoch from last_seen_at)*1000)::bigint as last_seen_ms,
		        (extract(epoch from first_seen_at)*1000)::bigint as first_seen_ms
		 from station_heartbeats where event_id=$1 order by laptop_name, laptop_id`,
		[eventId]
	);
}

/** Everything the monitor shows, cheap enough to fetch on every heartbeat. */
export async function monitorSnapshot(eventId: number) {
	const [laptops, overview] = await Promise.all([loadLaptops(eventId), stationOverview(eventId)]);
	return { laptops, stationData: overview, serverMs: Date.now() };
}
