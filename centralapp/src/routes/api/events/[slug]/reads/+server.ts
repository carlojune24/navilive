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
		if (typeof r.tag !== 'string' || !r.tag || !Number.isFinite(r.read_at_ms)) error(400, 'Each read needs tag (string) and read_at_ms (number)');

	return json(await insertReads(e.id, reads));
};
