import { error, fail } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadResults } from '$lib/server/live';
import { MATCH } from '$lib/server/stationdata';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

export const load = async ({ params, url, cookies }) => {
	const r = await loadResults(params.slug, url.searchParams.get('mode') === 'own' ? 'own' : 'gun');
	if (!r) error(404, 'Event not found');
	const c = Number(url.searchParams.get('cycle'));
	// ?cycle=<seconds> lets a wall display be bookmarked with its own pace; anything odd falls back to 12
	const cycle = Number.isFinite(c) && c >= 3 && c <= 300 ? Math.round(c) : 12;
	const v = url.searchParams.get('view');
	const routeCats = (await q<{ id: number }>('select c.id from categories c join events e on e.id=c.event_id where e.slug=$1 and c.gpx is not null', [params.slug])).map((r) => r.id);
	const has = routeCats.length > 0;
	const view = v === 'awards' ? ('awards' as const) : v === 'progress' ? ('progress' as const) : v === 'map' && has ? ('map' as const) : ('results' as const);
	return { admin: await sessionOk(cookies.get(SESSION_COOKIE)), hasRoute: has, routeCats, slug: params.slug, initial: r, kiosk: url.searchParams.has('kiosk'), cycle, view };
};

// The public board is open to everyone, so these check the organizer's login themselves (hooks only guard /admin).
async function gun(cookies: import('@sveltejs/kit').Cookies, slug: string, request: Request, ms: number | null) {
	if (!(await sessionOk(cookies.get(SESSION_COOKIE)))) return fail(403, { error: 'Sign in as the organizer to start the clock.' });
	const cat = Number((await request.formData()).get('category'));
	const [e] = await q<{ id: number }>('select id from events where slug=$1', [slug]);
	if (!e || !Number.isInteger(cat)) return fail(400, { error: 'Unknown category.' });
	if (ms !== null) {
		const used = await q(
			`select 1 from reads r join participants p on ${MATCH} join stations s on s.id=r.station_id
			 where p.category_id=$1 and p.event_id=$2 and r.event_id=$2 and not r.voided and s.kind<>'start' limit 1`,
			[cat, e.id]
		);
		if (used.length) return fail(409, { error: 'Checkpoint or finish reads already exist for this category, so it cannot be started now.' });
	}
	// Start only counts the first press (a double tap must not move the start); Reset clears it
	const done = await q('update categories set gun_ms=$3 where id=$1 and event_id=$2 and ($3::bigint is null or gun_ms is null) returning id', [cat, e.id, ms]);
	if (!done.length && ms !== null) return fail(409, { error: 'That category has already started.' });
	await q("select pg_notify('reads', $1)", [String(e.id)]);
	return { ok: true };
}

export const actions = {
	startGun: ({ cookies, params, request }) => gun(cookies, params.slug, request, Date.now()),
	clearGun: ({ cookies, params, request }) => gun(cookies, params.slug, request, null)
};
