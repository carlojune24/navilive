import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';

// Public: the live board shows winner photos. The ?v=<time> in the address changes whenever the photo does, so it can be cached for a year.
export const GET = async ({ params }) => {
	const rows = await q<{ mime: string; data: Buffer }>(
		`select ph.mime, ph.data from participant_photos ph
		 join participants p on p.id = ph.participant_id join events e on e.id = p.event_id
		 where e.slug = $1 and p.bib = $2`,
		[params.slug, params.bib]
	);
	if (!rows[0]) error(404, 'No photo');
	return new Response(new Uint8Array(rows[0].data), {
		headers: {
			'content-type': rows[0].mime,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
