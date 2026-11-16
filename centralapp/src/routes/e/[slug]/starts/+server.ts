import { error, json } from '@sveltejs/kit';
import { loadStarts } from '$lib/server/batches';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

export const GET = async ({ params, cookies }) => {
	const s = await loadStarts(params.slug, await sessionOk(cookies.get(SESSION_COOKIE)));
	if (!s) error(404, 'Start menu is off');
	return json(s, { headers: { 'cache-control': 'no-store' } });
};
