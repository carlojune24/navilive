import { error } from '@sveltejs/kit';
import { q } from './db';
import { hashKey } from './apikey';

/** Station API auth: `Authorization: Bearer <event api key>`. An archived or deleted event takes no more uploads. */
export async function authEvent(slug: string, request: Request) {
	const key = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	const [e] = await q<{ id: number }>('select id from events where slug=$1 and api_key_hash=$2 and archived_at is null and deleted_at is null', [slug, key ? hashKey(key) : '']);
	if (!e) error(401, 'Invalid event or API key');
	return e;
}
