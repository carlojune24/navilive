import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';

// Public: sponsor logos in the live board footer. ?v=<time> changes with the logo, so it can be cached for a year.
export const GET = async ({ params }) => {
	if (!/^\d+$/.test(params.id)) error(404, 'No logo');
	const rows = await q<{ mime: string; data: Buffer }>(
		'select s.mime, s.data from event_sponsors s join events e on e.id=s.event_id where e.slug=$1 and s.id=$2',
		[params.slug, Number(params.id)]
	);
	if (!rows[0]) error(404, 'No logo');
	return new Response(new Uint8Array(rows[0].data), {
		headers: {
			'content-type': rows[0].mime,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
