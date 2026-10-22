import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadResults } from '$lib/server/live';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

export const load = async ({ params, url, cookies }) => {
	const r = await loadResults(params.slug, url.searchParams.get('mode') === 'own' ? 'own' : 'gun');
	if (!r) error(404, 'Event not found');
	const c = Number(url.searchParams.get('cycle'));
	// ?cycle=<seconds> lets a wall display be bookmarked with its own pace; anything odd falls back to 12
	const cycle = Number.isFinite(c) && c >= 3 && c <= 300 ? Math.round(c) : 12;
	const v = url.searchParams.get('view');
	const routeCats = (await q<{ id: number }>('select c.id from categories c join events e on e.id=c.event_id where e.slug=$1 and c.gpx is not null and c.archived_at is null', [params.slug])).map((r) => r.id);
	const has = routeCats.length > 0;
	const view = v === 'awards' ? ('awards' as const) : v === 'progress' ? ('progress' as const) : v === 'map' && has ? ('map' as const) : ('results' as const);
	return { admin: await sessionOk(cookies.get(SESSION_COOKIE)), hasRoute: has, routeCats, slug: params.slug, initial: r, kiosk: url.searchParams.has('kiosk'), cycle, view };
};
