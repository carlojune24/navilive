import { createHmac, timingSafeEqual } from 'node:crypto';
import { ADMIN_PASSWORD } from '$app/env/private';
import { q } from './db';
import { hashPassword, verifyPassword } from '$lib/password';

// shortcut: one shared admin password; add real accounts if more admins appear.
// The password is ADMIN_PASSWORD from .env until it is changed in the admin; after that the hash in app_settings wins.
// Recovery if it is forgotten:  delete from app_settings where key='admin_password_hash';  (the .env password works again)

export const SESSION_COOKIE = 'admin';

let cache: { hash: string | null; at: number } | null = null;
const TTL_MS = 30_000; // picks up a recovery edit made directly in the database

async function storedHash(): Promise<string | null> {
	if (!cache || Date.now() - cache.at > TTL_MS) {
		const rows = await q<{ value: string }>("select value from app_settings where key='admin_password_hash'");
		cache = { hash: rows[0]?.value ?? null, at: Date.now() };
	}
	return cache.hash;
}

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

export async function passwordOk(input: string) {
	const hash = await storedHash();
	return hash ? verifyPassword(input, hash) : same(input, ADMIN_PASSWORD);
}

// the session cookie is derived from whatever the current password material is, so changing the password signs everyone out
async function sign() {
	const material = (await storedHash()) ?? ADMIN_PASSWORD;
	return createHmac('sha256', material).update('admin-session').digest('hex');
}

export const sessionValue = sign;

export async function sessionOk(cookie: string | undefined) {
	if (!cookie) return false;
	return same(cookie, await sign());
}

export async function setPassword(newPassword: string) {
	const hash = await hashPassword(newPassword);
	await q("insert into app_settings(key, value) values('admin_password_hash', $1) on conflict(key) do update set value = excluded.value", [hash]);
	cache = { hash, at: Date.now() };
}
