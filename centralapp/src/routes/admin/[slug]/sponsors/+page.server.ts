import { error, fail } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { MAX_PHOTO_BYTES, sniffImage } from '$lib/image';
import { cleanUrl } from '$lib/sponsors';

// Admin only (the /admin hook). Sponsors are shown as logos in the live board's footer.
async function ev(slug: string) {
	const [e] = await q<{ id: number; name: string; slug: string }>('select id, name, slug from events where slug=$1', [slug]);
	if (!e) error(404, 'Event not found');
	return e;
}
const notify = (id: number) => q("select pg_notify('reads', $1)", [String(id)]); // open boards refetch

export const load = async ({ params }) => {
	const event = await ev(params.slug);
	const sponsors = await q<{ id: number; name: string; url: string; v: number }>(
		'select id, name, url, (extract(epoch from updated_at)*1000)::float8 as v from event_sponsors where event_id=$1 order by ord, id',
		[event.id]
	);
	return { event, sponsors };
};

export const actions = {
	add: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim().slice(0, 120);
		const url = cleanUrl(String(f.get('url') ?? '').slice(0, 500));
		const file = f.get('logo');
		if (!name) return fail(400, { error: 'Enter the sponsor name.' });
		if (url === null) return fail(400, { error: 'The website must be a web address, like example.com.' });
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose the logo.' });
		if (file.size > MAX_PHOTO_BYTES) return fail(400, { error: 'That logo is too large.' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImage(bytes);
		if (!mime) return fail(400, { error: 'Use a JPG, PNG or WebP logo.' });
		await q(
			`insert into event_sponsors(event_id, name, url, mime, data, ord)
			 values($1,$2,$3,$4,$5,(select coalesce(max(ord),0)+1 from event_sponsors where event_id=$1))`,
			[e.id, name, url, mime, Buffer.from(bytes)]
		);
		await notify(e.id);
		return { added: name };
	},
	remove: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('delete from event_sponsors where id=$1 and event_id=$2', [Number((await request.formData()).get('id')), e.id]);
		await notify(e.id);
		return { removed: true };
	},
	// swap with the neighbour above or below
	move: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const id = Number(f.get('id'));
		const up = f.get('dir') === 'up';
		const list = await q<{ id: number; ord: number }>('select id, ord from event_sponsors where event_id=$1 order by ord, id', [e.id]);
		const i = list.findIndex((s) => s.id === id);
		const j = up ? i - 1 : i + 1;
		if (i < 0 || j < 0 || j >= list.length) return { moved: false };
		// renumber the whole list so equal ord values never get stuck
		const order = list.map((s) => s.id);
		[order[i], order[j]] = [order[j], order[i]];
		await q('update event_sponsors s set ord=x.n from unnest($2::int[]) with ordinality x(id, n) where s.id=x.id and s.event_id=$1', [e.id, order]);
		await notify(e.id);
		return { moved: true };
	}
};
