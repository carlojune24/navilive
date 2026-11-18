import { describe, expect, it } from 'vitest';
import { SESSION_MS, checkSession, makeSession } from './session';

describe('admin session', () => {
	const now = 1_000_000;
	const s = makeSession('pw', now);
	it('is valid for one week', () => {
		expect(checkSession(s, 'pw', now + SESSION_MS - 1)).toBe(true);
		expect(checkSession(s, 'pw', now + SESSION_MS)).toBe(false);
	});
	it('dies when the password changes', () => expect(checkSession(s, 'other', now)).toBe(false));
	it('cannot have its expiry pushed out', () => {
		const [, sig] = s.split('.');
		expect(checkSession(`${now + 10 * SESSION_MS}.${sig}`, 'pw', now)).toBe(false);
	});
	it('rejects junk', () => {
		for (const c of [undefined, '', 'abc', '.', `${now + 5}.`]) expect(checkSession(c, 'pw', now)).toBe(false);
	});
});
