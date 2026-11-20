import { error, json } from '@sveltejs/kit';
import { authEvent } from '$lib/server/station';
import { insertReads, type InRead } from '$lib/server/ingest';

const MAX_BATCH = 2000;

export const POST = async ({ params, request }) => {
	const e = await authEvent(params.slug, request);
	const body = await request.json().catch(() => null);
	const reads: InRead[] | null = Array.isArray(body) ? body : Array.isArray(body?.reads) ? body.reads : null;
	if (!reads || reads.length > MAX_BATCH) error(400, `Body must be an array (or {reads:[]}) of at most ${MAX_BATCH}`);
	for (const r of reads)
		if (!r || typeof r !== 'object' || typeof r.tag !== 'string' || !r.tag || !Number.isSafeInteger(r.read_at_ms))
			error(400, 'Each read needs tag (string) and read_at_ms (whole number of milliseconds)');

	// with station keys required, a read that says it came from a reader or a station laptop must carry a station key; marshal phones use the event link
	if (e.requireKeys && e.keyId === null && reads.some((r) => r.server_time !== true)) error(403, 'This event requires a station key for reader uploads');
	return json(await insertReads(e.id, reads, e.keyId));
};
