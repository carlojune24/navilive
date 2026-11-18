import { error, fail } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadResults } from '$lib/server/live';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';
import { loadStarts, rollBatch, startBatch } from '$lib/server/batches';

export const load = async ({ params, url, cookies }) => {
	const r = await loadResults(params.slug, url.searchParams.get('mode') === 'own' ? 'own' : 'gun');
	if (!r) error(404, 'Event not found');
	const c = Number(url.searchParams.get('cycle'));
	// ?cycle=<seconds> lets a wall display be bookmarked with its own pace; anything odd falls back to 12
	const cycle = Number.isFinite(c) && c >= 3 && c <= 300 ? Math.round(c) : 12;
	const v = url.searchParams.get('view');
	const routeCats = (await q<{ id: number }>('select c.id from categories c join events e on e.id=c.event_id where e.slug=$1 and c.gpx is not null and c.archived_at is null', [params.slug])).map((r) => r.id);
	const has = routeCats.length > 0;
	const admin = await sessionOk(cookies.get(SESSION_COOKIE));
	const starts = await loadStarts(params.slug, admin);
	const sponsors = await q<{ id: number; name: string; url: string; v: number }>(
		'select s.id, s.name, s.url, (extract(epoch from s.updated_at)*1000)::float8 as v from event_sponsors s join events e on e.id=s.event_id where e.slug=$1 order by s.ord, s.id',
		[params.slug]
	);
	const view = v === 'awards' ? ('awards' as const) : v === 'progress' ? ('progress' as const) : v === 'map' && has ? ('map' as const) : v === 'start' && starts ? ('start' as const) : ('results' as const);
	return { admin, hasRoute: has, routeCats, slug: params.slug, initial: r, starts, sponsors, kiosk: url.searchParams.has('kiosk'), cycle, view };
};

/** Start view actions: organizer only, and only while the admin has the Start menu on. */
async function guard(slug: string, cookies: { get(n: string): string | undefined }) {
	if (!(await sessionOk(cookies.get(SESSION_COOKIE)))) return null;
	const [ev] = await q<{ id: number; live_start: boolean; roll_size: number }>('select id, live_start, roll_size from events where slug=$1', [slug]);
	return ev?.live_start ? ev : null;
}

export const actions = {
	roll: async ({ request, params, cookies }) => {
		const ev = await guard(params.slug, cookies);
		if (!ev) return fail(403, { error: 'Log in as the organizer, and turn the Start menu on in Admin > Starts.' });
		const f = await request.formData();
		const cat = Number(f.get('category'));
		const g = f.get('gender');
		const gender = g === 'M' || g === 'F' ? g : null;
		if (!(await q('select 1 from categories where id=$1 and event_id=$2 and archived_at is null', [cat, ev.id])).length) return fail(400, { error: 'Unknown category' });
		const r = await rollBatch(ev.id, cat, ev.roll_size, gender);
		if (!r) return fail(409, { error: 'No runners left to roll.' });
		return r;
	},
	start: async ({ request, params, cookies }) => {
		const ev = await guard(params.slug, cookies);
		if (!ev) return fail(403, { error: 'Log in as the organizer, and turn the Start menu on in Admin > Starts.' });
		const id = Number((await request.formData()).get('id'));
		if (!(await startBatch(ev.id, id, Date.now(), false))) return fail(409, { error: 'That batch has already started.' });
	}
};
