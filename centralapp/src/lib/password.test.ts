import { describe, expect, it } from 'vitest';
import { checkNewPassword, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
	it('verifies the right password and rejects others', async () => {
		const h = await hashPassword('correct horse battery');
		expect(h.startsWith('scrypt$')).toBe(true);
		expect(await verifyPassword('correct horse battery', h)).toBe(true);
		expect(await verifyPassword('correct horse batterx', h)).toBe(false);
		expect(await verifyPassword('', h)).toBe(false);
	});
	it('salts: the same password hashes differently each time', async () => {
		expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
	});
	it('a malformed stored value never verifies', async () => {
		expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
		expect(await verifyPassword('x', 'scrypt$1$2$3')).toBe(false);
		expect(await verifyPassword('x', 'md5$a$b$c$d$e')).toBe(false);
	});
});

describe('new password rules', () => {
	it('accepts a long enough, different password', () => {
		expect(checkNewPassword('a-fine-new-passphrase', 'old-one')).toBeNull();
	});
	it('rejects short, same, common and repeated-character passwords', () => {
		expect(checkNewPassword('short', 'old-one')).toMatch(/at least 10/);
		expect(checkNewPassword('same-as-current', 'same-as-current')).toMatch(/different/);
		expect(checkNewPassword('Password1', 'x')).toMatch(/at least 10/); // too short anyway
		expect(checkNewPassword('aaaaaaaaaaaa', 'x')).toMatch(/repeated/);
		expect(checkNewPassword('x'.repeat(201), 'old')).toMatch(/too long/);
	});
});
