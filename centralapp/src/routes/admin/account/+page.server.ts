import { fail } from '@sveltejs/kit';
import { PUBLIC_URL } from '$app/env/private';
import { SESSION_COOKIE, passwordOk, sessionValue, setPassword } from '$lib/server/auth';
import { blockedMinutes, clearFails, recordFail } from '$lib/server/ratelimit';
import { checkNewPassword } from '$lib/password';

export const actions = {
	change: async ({ request, cookies, getClientAddress }) => {
		const key = 'pw:' + getClientAddress(); // separate from the login counter, same limits
		const wait = blockedMinutes(key);
		if (wait) return fail(429, { error: `Too many wrong passwords. Try again in ${wait} min.` });

		const f = await request.formData();
		const current = String(f.get('current') ?? '');
		const next = String(f.get('next') ?? '');
		const again = String(f.get('again') ?? '');

		if (!(await passwordOk(current))) {
			recordFail(key);
			await new Promise((r) => setTimeout(r, 600));
			return fail(401, { error: 'The current password is not right.' });
		}
		clearFails(key);
		if (next !== again) return fail(400, { error: 'The two new passwords do not match.' });
		const problem = checkNewPassword(next, current);
		if (problem) return fail(400, { error: problem });

		await setPassword(next);
		// every other session is now signed out (the cookie depends on the password); keep this one signed in
		cookies.set(SESSION_COOKIE, await sessionValue(), { path: '/', httpOnly: true, sameSite: 'lax', secure: !!PUBLIC_URL?.startsWith('https://'), maxAge: 60 * 60 * 24 * 7 });
		return { changed: true };
	}
};
