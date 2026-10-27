import { json } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { authEvent } from '$lib/server/station';

/**
 * Everything the marshal tagging page needs, in one trip. The page keeps no other server state: it polls
 * this and posts taps to the normal reads endpoint. bigints are cast to float8 so they arrive as numbers.
 */
export const GET = async ({ params, request }) => {
	const e = await authEvent(params.slug, request);
	const [stations, categories, batches, participants, tagged, courses] = await Promise.all([
		q('select id, name, kind, ord from stations where event_id=$1 order by ord, id', [e.id]),
		q('select id, name, gun_ms::float8 as gun_ms from categories where event_id=$1 and archived_at is null order by name', [e.id]),
		q('select b.id, b.name, b.category_id, b.gun_ms::float8 as gun_ms from batches b join categories c on c.id=b.category_id where c.event_id=$1 order by b.id', [e.id]),
		q('select bib, name, tag, category_id, batch_id from participants where event_id=$1 order by bib', [e.id]),
		// one row per bib per station: drives both "already tagged here" and the incoming/missed badges
		q(
			`select r.bib, r.station_id, min(r.read_at_ms)::float8 as at from reads r
			 where r.event_id=$1 and not r.voided and r.station_id is not null and r.bib is not null
			 group by r.bib, r.station_id`,
			[e.id]
		),
		// a category that skips a station: without this the marshal there flags its runners as missed
		q('select cc.category_id, cc.station_id from category_courses cc join categories c on c.id=cc.category_id where c.event_id=$1 order by cc.category_id, cc.ord', [e.id])
	]);
	return json({ serverMs: Date.now(), stations, categories, batches, participants, tagged, courses });
};
