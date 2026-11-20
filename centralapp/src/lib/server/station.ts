import { error } from '@sveltejs/kit';
import { q } from './db';
import { hashKey } from './apikey';

/**
 * Station API auth: `Authorization: Bearer <key>`, either the event key or one of the event's station keys (not revoked).
 * keyId is the station key used, or null for the shared event key. An archived or deleted event takes no more uploads.
 */
export async function authEvent(slug: string, request: Request) {
	const key = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	const h = key ? hashKey(key) : '';
	const [e] = await q<{ id: number; shared: boolean; require_station_keys: boolean }>(
		'select id, api_key_hash=$2 as shared, require_station_keys from events where slug=$1 and archived_at is null and deleted_at is null', [slug, h]);
	if (!e) error(401, 'Invalid event or API key');
	if (e.shared) return { id: e.id, keyId: null as number | null, requireKeys: e.require_station_keys };
	// last_used_at moves at most once a minute: heartbeats arrive every 5 seconds
	const [k] = h
		? await q<{ id: number }>(
				`update station_keys set last_used_at = case when last_used_at is null or last_used_at < now() - interval '1 minute' then now() else last_used_at end
				 where event_id=$1 and key_hash=$2 and revoked_at is null returning id`, [e.id, h])
		: [];
	if (!k) error(401, 'Invalid event or API key');
	return { id: e.id, keyId: k.id as number | null, requireKeys: e.require_station_keys };
}
