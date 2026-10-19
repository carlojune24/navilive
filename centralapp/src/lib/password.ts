// Password hashing and rules. Pure (no database, no environment), so it is unit-tested.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15; // scrypt cost; ~50 ms, memory 32 MB
const R = 8;
const P = 1;
const KEYLEN = 32;

const derive = (password: string, salt: Buffer, n = N, r = R, p = P) =>
	new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));

/** "scrypt$N$r$p$salt$hash" (base64). The cost is stored with the hash so it can be raised later. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt);
	return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [alg, n, r, p, salt, hash] = stored.split('$');
	if (alg !== 'scrypt' || !salt || !hash) return false;
	try {
		const want = Buffer.from(hash, 'base64');
		const got = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
		return got.length === want.length && timingSafeEqual(got, want);
	} catch {
		return false;
	}
}

const COMMON = new Set(['change-me', 'password', 'password1', 'admin', 'admin123', '123456', '12345678', 'qwerty', 'letmein']);

/** Message if the new password is not acceptable, else null. */
export function checkNewPassword(next: string, current: string): string | null {
	if (next.length < 10) return 'Use at least 10 characters.';
	if (next.length > 200) return 'That password is too long (200 characters at most).';
	if (next === current) return 'The new password must be different from the current one.';
	if (COMMON.has(next.toLowerCase())) return 'That password is too easy to guess.';
	if (/^(.)\1+$/.test(next)) return 'Do not use one repeated character.';
	return null;
}
