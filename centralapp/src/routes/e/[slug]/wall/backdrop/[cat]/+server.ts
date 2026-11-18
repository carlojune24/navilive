import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';

// Public: the finish-time wall shows it. ?v=<time> changes whenever the image does, so it can be cached for a year.
export const GET = async ({ params }) => {
	if (!/^\d+$/.test(params.cat)) error(404, 'No backdrop');
	const rows = await q<{ mime: string; data: Buffer }>(
		`select b.mime, b.data from category_backdrops b join categories c on c.id=b.category_id join events e on e.id=c.event_id
		 where e.slug=$1 and c.id=$2`,
		[params.slug, Number(params.cat)]
	);
	if (!rows[0]) error(404, 'No backdrop');
	return new Response(new Uint8Array(rows[0].data), {
		headers: {
			'content-type': rows[0].mime,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
