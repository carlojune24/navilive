import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // one week, then log in again

const mac = (secret: string, exp: number) => createHmac('sha256', secret).update(`admin-session:${exp}`).digest('hex');

/** "<expiry ms>.<signature>": the expiry is signed, so it cannot be pushed out by editing the cookie. */
export const makeSession = (secret: string, now = Date.now()) => {
	const exp = now + SESSION_MS;
	return `${exp}.${mac(secret, exp)}`;
};

export function checkSession(cookie: string | undefined, secret: string, now = Date.now()) {
	const [e, sig] = (cookie ?? '').split('.');
	const exp = Number(e);
	if (!sig || !Number.isSafeInteger(exp) || exp <= now) return false;
	const a = Buffer.from(sig);
	const b = Buffer.from(mac(secret, exp));
	return a.length === b.length && timingSafeEqual(a, b);
}
