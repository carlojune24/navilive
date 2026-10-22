import { error } from '@sveltejs/kit';
import { loadRoute } from '$lib/server/route';

export const load = async ({ params, url }) => {
	const cat = Number(url.searchParams.get('cat'));
	const r = await loadRoute(params.slug, Number.isInteger(cat) && cat > 0 ? cat : null);
	if (!r) error(404, 'Event not found');
	const display = url.searchParams.has('display');
	// ?dim=<0-90> dims the basemap so a wall display can be bookmarked at the level that reads there
	const raw = url.searchParams.get('dim');
	const d = Number(raw);
	const dim = raw !== null && Number.isFinite(d) && d >= 0 && d <= 90 ? Math.round(d) : display ? 40 : 0;
	return { slug: params.slug, initial: r, display, dim };
};
