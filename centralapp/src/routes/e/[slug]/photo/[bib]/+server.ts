import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { parseConfig } from '$lib/awardcfg';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

// Public: the live board shows winner photos. The ?v=<time> in the address changes whenever the photo does, so it can be cached for a year.
// While the organizer has the awards hidden, only the organizer gets them: a photo by bib would give the winners away.
export const GET = async ({ params, cookies }) => {
	const rows = await q<{ mime: string; data: Buffer; award_config: unknown }>(
		`select ph.mime, ph.data, e.award_config from participant_photos ph
		 join participants p on p.id = ph.participant_id join events e on e.id = p.event_id
		 where e.slug = $1 and p.bib = $2`,
		[params.slug, params.bib]
	);
	if (!rows[0]) error(404, 'No photo');
	const hidden = !parseConfig(rows[0].award_config).cfg.reveal;
	if (hidden && !(await sessionOk(cookies.get(SESSION_COOKIE)))) error(404, 'No photo');
	return new Response(new Uint8Array(rows[0].data), {
		headers: {
			'content-type': rows[0].mime,
			// an organizer-only copy must not be kept by any cache
			'cache-control': hidden ? 'private, no-store' : 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
