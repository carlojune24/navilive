import { error, fail, redirect } from '@sveltejs/kit';
import { pool, q } from '$lib/server/db';
import { hashKey, newKey } from '$lib/server/apikey';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The slug for a new event's name, or the message to show when that name can't be used. */
async function newSlug(name: string): Promise<{ slug: string } | { error: string }> {
	const slug = slugify(name);
	if (!slug) return { error: 'Event name required' };
	if (['guide', 'account'].includes(slug)) return { error: 'That name is reserved. Use another.' };
	if ((await q('select 1 from events where slug=$1', [slug])).length) return { error: 'An event with that name exists' };
	return { slug };
}

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
		const s = await newSlug(name);
		if ('error' in s) return fail(400, { error: s.error });
		const key = newKey();
		await q('insert into events(name, slug, date, api_key_hash, api_key) values($1,$2,$3,$4,$5)', [name, s.slug, date, hashKey(key), key]);
		await q(
			`insert into stations(event_id, name, kind, ord)
			 select id, v.n, v.k, v.o from events, (values ('Start','start',0),('Finish','finish',1)) v(n,k,o) where slug=$1`,
			[s.slug]
		);
		redirect(303, `/admin/${s.slug}`);
	},
	// Copies the setup of an event (settings, stations, categories, courses, participants, teams) under a new name.
	// Reads, start clocks, batches, release levels, photos and the API key are never copied: the new event starts clean.
	duplicate: async ({ request }) => {
		const f = await request.formData();
		const src = Number(f.get('id'));
		const name = String(f.get('name') ?? '').trim();
		const date = String(f.get('date') ?? '') || null;
		if (!(await q('select 1 from events where id=$1', [src])).length) error(404, 'Event not found');
		const s = await newSlug(name);
		if ('error' in s) return fail(400, { error: s.error });
		const key = newKey();
		const c = await pool.connect();
		try {
			await c.query('begin');
			// the old and the new rows are matched by their unique keys: category name, station name, bib
			const ev = await c.query(
				`insert into events(name, slug, date, api_key_hash, api_key, award_places, age_brackets, award_exclusive, award_config)
				 select $2, $3, $4, $5, $6, award_places, age_brackets, award_exclusive, award_config from events where id=$1 returning id`,
				[src, name, s.slug, date, hashKey(key), key]
			);
			const to = ev.rows[0].id;
			await c.query('insert into stations(event_id, name, kind, ord, km, services) select $2, name, kind, ord, km, services from stations where event_id=$1', [src, to]);
			await c.query('insert into categories(event_id, name, rank_by, gpx, gpx_name, archived_at) select $2, name, rank_by, gpx, gpx_name, archived_at from categories where event_id=$1', [src, to]);
			await c.query(
				`insert into category_courses(category_id, station_id, ord)
				 select nc.id, ns.id, cc.ord from category_courses cc
				 join categories oc on oc.id=cc.category_id and oc.event_id=$1 join categories nc on nc.event_id=$2 and nc.name=oc.name
				 join stations os on os.id=cc.station_id join stations ns on ns.event_id=$2 and ns.name=os.name`,
				[src, to]
			);
			await c.query(
				`insert into category_station_km(category_id, station_id, km)
				 select nc.id, ns.id, k.km from category_station_km k
				 join categories oc on oc.id=k.category_id and oc.event_id=$1 join categories nc on nc.event_id=$2 and nc.name=oc.name
				 join stations os on os.id=k.station_id join stations ns on ns.event_id=$2 and ns.name=os.name`,
				[src, to]
			);
			await c.query(
				`insert into participants(event_id, category_id, bib, name, tag, extra, gender, age)
				 select $2, nc.id, p.bib, p.name, p.tag, p.extra, p.gender, p.age from participants p
				 left join categories oc on oc.id=p.category_id left join categories nc on nc.event_id=$2 and nc.name=oc.name
				 where p.event_id=$1`,
				[src, to]
			);
			await c.query(
				`insert into team_members(event_id, participant_id, name, gender, age, leg, tag, extra)
				 select $2, np.id, m.name, m.gender, m.age, m.leg, m.tag, m.extra from team_members m
				 join participants op on op.id=m.participant_id join participants np on np.event_id=$2 and np.bib=op.bib
				 where m.event_id=$1`,
				[src, to]
			);
			await c.query('commit');
		} catch (err) {
			await c.query('rollback');
			throw err;
		} finally {
			c.release();
		}
		redirect(303, `/admin/${s.slug}`);
	}
};
