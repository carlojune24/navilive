import { q } from './db';
import { loadResults } from './live';
import type { Backdrop } from '$lib/wall';

/** What the finish wall pages need: the public results (unreleased finishers are not in them), the backdrops,
 *  and the runner the organizer put on the display screen. null = no such event. */
export async function loadWall(slug: string) {
	const results = await loadResults(slug, 'gun');
	if (!results) return null;
	const [backdrops, [ev]] = await Promise.all([
		q<Backdrop>(
			`select b.category_id, b.x, b.y, b.size, b.color, b.name_x, b.name_y, b.name_size, b.name_color, (extract(epoch from b.updated_at)*1000)::float8 as v
			 from category_backdrops b join categories c on c.id=b.category_id join events e on e.id=c.event_id where e.slug=$1`,
			[slug]
		),
		q<{ wall_bib: string | null; wall_category: number | null; wall_name: string | null }>('select wall_bib, wall_category, wall_name from events where slug=$1', [slug])
	]);
	return { results, backdrops, display: ev?.wall_bib && ev.wall_category ? { bib: ev.wall_bib, catId: ev.wall_category, name: ev.wall_name ?? '' } : null };
}
