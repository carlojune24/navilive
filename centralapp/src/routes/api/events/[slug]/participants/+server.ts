import { json } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { authEvent } from '$lib/server/station';

export const GET = async ({ params, request }) => {
	const e = await authEvent(params.slug, request);
	return json(
		await q(
			'select p.bib, p.name, coalesce(c.name, \'\') as category, p.tag from participants p left join categories c on c.id=p.category_id where p.event_id=$1 order by p.bib',
			[e.id]
		)
	);
};
