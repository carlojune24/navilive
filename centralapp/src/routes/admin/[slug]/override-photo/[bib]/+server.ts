import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';

// Admin only (the /admin hook): proof photos are not shown on the public board.
export const GET = async ({ params }) => {
	const rows = await q<{ mime: string; data: Buffer }>(
		`select o.mime, o.data from finish_overrides o
		 join participants p on p.id = o.participant_id join events e on e.id = p.event_id
		 where e.slug = $1 and p.bib = $2`,
		[params.slug, params.bib]
	);
	if (!rows[0]) error(404, 'No photo');
	return new Response(new Uint8Array(rows[0].data), {
		headers: {
			'content-type': rows[0].mime,
			'cache-control': 'private, no-cache',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
