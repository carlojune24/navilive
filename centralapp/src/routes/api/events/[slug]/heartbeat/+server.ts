import { error, json } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { authEvent } from '$lib/server/station';
import { parseHeartbeat } from '$lib/heartbeat';

const MAX_LAPTOPS = 100; // per event: a leaked key cannot fill the table

export const POST = async ({ params, request }) => {
	const e = await authEvent(params.slug, request);
	const beat = parseHeartbeat(await request.json().catch(() => null));
	if (!beat) error(400, 'Bad heartbeat');
	const known = await q('select 1 from station_heartbeats where event_id=$1 and laptop_id=$2', [e.id, beat.laptopId]);
	if (!known.length) {
		const [{ n }] = await q<{ n: number }>('select count(*)::int as n from station_heartbeats where event_id=$1', [e.id]);
		if (n >= MAX_LAPTOPS) error(429, 'Too many laptops for this event');
	}
	const now = Date.now();
	// positive = the laptop's clock is behind the server; race times come from each laptop's own clock, so this matters
	const skew = now - beat.nowMs;
	await q(
		`insert into station_heartbeats(event_id, laptop_id, laptop_name, app_version, payload, clock_skew_ms)
		 values($1,$2,$3,$4,$5,$6)
		 on conflict(event_id, laptop_id) do update set laptop_name=excluded.laptop_name, app_version=excluded.app_version,
		   payload=excluded.payload, clock_skew_ms=excluded.clock_skew_ms, last_seen_at=now()`,
		[e.id, beat.laptopId, beat.laptopName, beat.appVersion, JSON.stringify({ stations: beat.stations, pending: beat.pending, lastError: beat.lastError }), skew]
	);
	await q("select pg_notify('hb', $1)", [String(e.id)]);
	return json({ ok: true, server_ms: now });
};
