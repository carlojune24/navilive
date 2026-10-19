import { fail, redirect } from '@sveltejs/kit';
import { PUBLIC_URL } from '$app/env/private';
import { SESSION_COOKIE, passwordOk, sessionValue } from '$lib/server/auth';
import { blockedMinutes, clearFails, recordFail } from '$lib/server/ratelimit';

export const actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const ip = getClientAddress();
		const wait = blockedMinutes(ip);
		if (wait) return fail(429, { error: `Too many wrong passwords. Try again in ${wait} min.` });
		const pw = String((await request.formData()).get('password') ?? '');
		if (!(await passwordOk(pw))) {
			recordFail(ip);
			await new Promise((r) => setTimeout(r, 600)); // slows down guessing
			return fail(401, { error: 'Wrong password' });
		}
		clearFails(ip);
		cookies.set(SESSION_COOKIE, await sessionValue(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !!PUBLIC_URL?.startsWith('https://'),
			maxAge: 60 * 60 * 24 * 7
		});
		redirect(303, '/admin');
	}
};
