import { fail } from '@sveltejs/kit';
import { PUBLIC_URL } from '$app/env/private';
import { SESSION_COOKIE, SESSION_MAX_AGE, passwordOk, sessionValue, setPassword } from '$lib/server/auth';
import { blockedMinutes, clearFails, clientKey, recordFail } from '$lib/server/ratelimit';
import { checkNewPassword } from '$lib/password';
import { q } from '$lib/server/db';
import { MAX_PHOTO_BYTES, sniffImage } from '$lib/image';

// the system logo is one app_settings row holding a data: URL; /logo serves it
export const load = async () => {
	const set = await q<{ key: string; v: string }>("select key, case when key='logo' then md5(value) else value end as v from app_settings where key in ('logo','board_theme')");
	return { logoV: set.find((s) => s.key === 'logo')?.v ?? null, theme: set.find((s) => s.key === 'board_theme')?.v ?? 'default' };
};
const THEMES = ['default', 'grit'] as const;

export const actions = {
	change: async ({ request, cookies, getClientAddress }) => {
		const key = 'pw:' + clientKey(getClientAddress(), request.headers); // separate from the login counter, same limits
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
		cookies.set(SESSION_COOKIE, await sessionValue(), { path: '/', httpOnly: true, sameSite: 'lax', secure: !!PUBLIC_URL?.startsWith('https://'), maxAge: SESSION_MAX_AGE });
		return { changed: true };
	},
	logo: async ({ request }) => {
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose the logo.' });
		if (file.size > MAX_PHOTO_BYTES) return fail(400, { error: 'That logo is too large.' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImage(bytes);
		if (!mime) return fail(400, { error: 'Use a JPG, PNG or WebP logo.' });
		const url = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
		await q("insert into app_settings(key, value) values('logo', $1) on conflict(key) do update set value = excluded.value", [url]);
		return { logoSaved: true };
	},
	theme: async ({ request }) => {
		const t = String((await request.formData()).get('theme'));
		if (!(THEMES as readonly string[]).includes(t)) return fail(400, { error: 'Unknown theme.' });
		await q("insert into app_settings(key, value) values('board_theme', $1) on conflict(key) do update set value = excluded.value", [t]);
		return { themeSaved: true };
	},
	removeLogo: async () => {
		await q("delete from app_settings where key='logo'");
		return { logoSaved: true };
	}
};
