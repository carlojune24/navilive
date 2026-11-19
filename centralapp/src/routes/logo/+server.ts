import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';

// Public: the system logo (top right of every live board). ?v=<md5> changes with the logo, so it can be cached for a year.
export const GET = async () => {
	const [row] = await q<{ value: string }>("select value from app_settings where key='logo'");
	const m = row?.value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
	if (!m) error(404, 'No logo');
	return new Response(new Uint8Array(Buffer.from(m[2], 'base64')), {
		headers: {
			'content-type': m[1],
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
