import { error } from '@sveltejs/kit';
import { loadRoute } from '$lib/server/route';

export const load = async ({ params, url }) => {
	const cat = Number(url.searchParams.get('cat'));
	const r = await loadRoute(params.slug, Number.isInteger(cat) && cat > 0 ? cat : null);
	if (!r) error(404, 'Event not found');
	return { slug: params.slug, initial: r, display: url.searchParams.has('display') };
};
