import { error, json } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { monitorSnapshot } from '$lib/server/monitor';

export const GET = async ({ params }) => {
	const [e] = await q<{ id: number }>('select id from events where slug=$1', [params.slug]);
	if (!e) error(404, 'Event not found');
	return json(await monitorSnapshot(e.id), { headers: { 'cache-control': 'no-store' } });
};
