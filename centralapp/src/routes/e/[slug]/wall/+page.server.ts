import { error, fail } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadWall } from '$lib/server/wall';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';
import { MAX_PHOTO_BYTES, sniffImage } from '$lib/image';
import { parseLayout } from '$lib/wall';

export const load = async ({ params, cookies }) => {
	const w = await loadWall(params.slug);
	if (!w) error(404, 'Event not found');
	return { slug: params.slug, admin: await sessionOk(cookies.get(SESSION_COOKIE)), ...w };
};

/** Organizer only; returns the category id when it belongs to this event. */
async function guard(slug: string, cookies: { get(n: string): string | undefined }, f: FormData) {
	if (!(await sessionOk(cookies.get(SESSION_COOKIE)))) return null;
	const cat = Number(f.get('category'));
	const ok = await q('select 1 from categories c join events e on e.id=c.event_id where c.id=$1 and e.slug=$2', [cat, slug]);
	return ok.length ? cat : null;
}
const denied = () => fail(403, { error: 'Log in as the organizer to change backdrops.' });

export const actions = {
	upload: async ({ request, params, cookies }) => {
		const f = await request.formData();
		const cat = await guard(params.slug, cookies, f);
		if (cat === null) return denied();
		const file = f.get('image');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose an image.' });
		if (file.size > MAX_PHOTO_BYTES) return fail(400, { error: 'That image is too large.' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImage(bytes);
		if (!mime) return fail(400, { error: 'Use a JPG, PNG or WebP image.' });
		await q(
			`insert into category_backdrops(category_id, mime, data) values($1,$2,$3)
			 on conflict(category_id) do update set mime=excluded.mime, data=excluded.data, updated_at=now()`,
			[cat, mime, Buffer.from(bytes)]
		);
		return { saved: true };
	},
	layout: async ({ request, params, cookies }) => {
		const f = await request.formData();
		const cat = await guard(params.slug, cookies, f);
		if (cat === null) return denied();
		const l = parseLayout(f);
		const n = parseLayout(f, 'name_');
		if (!l || !n) return fail(400, { error: 'Bad position, size or color.' });
		const done = await q(
			'update category_backdrops set x=$2, y=$3, size=$4, color=$5, name_x=$6, name_y=$7, name_size=$8, name_color=$9 where category_id=$1 returning 1',
			[cat, l.x, l.y, l.size, l.color, n.x, n.y, n.size, n.color]
		);
		if (!done.length) return fail(400, { error: 'Upload a backdrop first.' });
		return { saved: true };
	},
	// put a runner on the display screen (bib empty = clear it), with an optional name to show instead of theirs;
	// open display screens update through the live stream
	show: async ({ request, params, cookies }) => {
		const f = await request.formData();
		const cat = await guard(params.slug, cookies, f);
		if (cat === null) return fail(403, { error: 'Log in as the organizer to change the display screen.' });
		const bib = String(f.get('bib') ?? '').trim();
		const name = String(f.get('name') ?? '').trim().slice(0, 80);
		const [ev] = await q<{ id: number }>('update events set wall_bib=$2, wall_category=$3, wall_name=$4 where slug=$1 returning id', [params.slug, bib || null, bib ? cat : null, (bib && name) || null]);
		await q("select pg_notify('reads', $1)", [String(ev.id)]);
		return { shown: bib };
	},
	remove: async ({ request, params, cookies }) => {
		const f = await request.formData();
		const cat = await guard(params.slug, cookies, f);
		if (cat === null) return denied();
		await q('delete from category_backdrops where category_id=$1', [cat]);
		return { removed: true };
	}
};
