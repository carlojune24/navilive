import { error, json } from '@sveltejs/kit';
import { loadResults } from '$lib/server/live';

export const GET = async ({ params, url }) => {
	const r = await loadResults(params.slug, url.searchParams.get('mode') === 'own' ? 'own' : 'gun');
	if (!r) error(404, 'Event not found');
	return json(r, { headers: { 'cache-control': 'no-store' } });
};
