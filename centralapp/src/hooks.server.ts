import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { q } from '$lib/server/db';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/admin') && !(await sessionOk(event.cookies.get(SESSION_COOKIE)))) {
		redirect(303, '/login');
	}
	// the whole public surface under /e/<slug> is gated here, so no endpoint can be left open by mistake
	if (event.url.pathname.startsWith('/e/')) {
		const slug = event.url.pathname.split('/')[2];
		const [ev] = await q<{ published: boolean }>('select published from events where slug=$1', [slug]);
		// an unpublished event answers like a wrong slug, so it cannot be found by guessing names
		if (ev && !ev.published && !(await sessionOk(event.cookies.get(SESSION_COOKIE)))) error(404, 'Event not found');
	}
	return resolve(event);
};
