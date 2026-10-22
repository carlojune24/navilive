import { fail, redirect } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { hashKey, newKey } from '$lib/server/apikey';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const load = async () => ({
	events: await q('select id, name, slug, date, published from events order by id desc')
});

export const actions = {
	// a draft event 404s on the live board; see hooks.server.ts
	publish: async ({ request }) => {
		const f = await request.formData();
		await q('update events set published=$2 where id=$1', [Number(f.get('id')), f.get('published') === 'true']);
		return { published: true };
	},
	create: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		const date = String(f.get('date') ?? '') || null;
		const slug = slugify(name);
		if (!slug) return fail(400, { error: 'Event name required' });
		if (['guide', 'account'].includes(slug)) return fail(400, { error: 'That name is reserved. Use another.' });
		if ((await q('select 1 from events where slug=$1', [slug])).length) return fail(400, { error: 'An event with that name exists' });
		const key = newKey();
		await q('insert into events(name, slug, date, api_key_hash, api_key) values($1,$2,$3,$4,$5)', [name, slug, date, hashKey(key), key]);
		await q(
			`insert into stations(event_id, name, kind, ord)
			 select id, v.n, v.k, v.o from events, (values ('Start','start',0),('Finish','finish',1)) v(n,k,o) where slug=$1`,
			[slug]
		);
		redirect(303, `/admin/${slug}`);
	}
};
