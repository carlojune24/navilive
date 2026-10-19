import { error, json } from '@sveltejs/kit';
import { loadRoute } from '$lib/server/route';

export const GET = async ({ params, url }) => {
	const cat = Number(url.searchParams.get('cat'));
	const r = await loadRoute(params.slug, Number.isInteger(cat) && cat > 0 ? cat : null);
	if (!r) error(404, 'Event not found');
	return json(r, { headers: { 'cache-control': 'no-store' } });
};
