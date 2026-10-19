import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, sessionOk } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/admin') && !(await sessionOk(event.cookies.get(SESSION_COOKIE)))) {
		redirect(303, '/login');
	}
	return resolve(event);
};
