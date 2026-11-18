import { error } from '@sveltejs/kit';
import { loadWall } from '$lib/server/wall';

// The display screen: only the picture, no search or settings. The organizer picks the runner on the finish wall page.
export const load = async ({ params }) => {
	const w = await loadWall(params.slug);
	if (!w) error(404, 'Event not found');
	return { slug: params.slug, ...w };
};
