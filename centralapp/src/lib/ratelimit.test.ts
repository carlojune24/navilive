import { describe, expect, it } from 'vitest';
import { blockedMinutes, clearFails, clientKey, recordFail } from './server/ratelimit';

describe('login rate limit', () => {
	it('blocks an address after 5 wrong passwords, only that address, and lifts after the window', () => {
		const t0 = 1_000_000;
		for (let i = 0; i < 4; i++) recordFail('1.1.1.1', t0 + i);
		expect(blockedMinutes('1.1.1.1', t0 + 10)).toBe(0); // 4 fails: still allowed
		recordFail('1.1.1.1', t0 + 5);
		expect(blockedMinutes('1.1.1.1', t0 + 10)).toBeGreaterThan(0);
		expect(blockedMinutes('2.2.2.2', t0 + 10)).toBe(0); // someone else is unaffected
		expect(blockedMinutes('1.1.1.1', t0 + 11 * 60_000)).toBe(0); // window passed
	});
	it('a successful login clears the count', () => {
		for (let i = 0; i < 5; i++) recordFail('3.3.3.3', 5_000_000);
		clearFails('3.3.3.3');
		expect(blockedMinutes('3.3.3.3', 5_000_100)).toBe(0);
	});
});

describe('clientKey', () => {
	const h = (o: Record<string, string>) => new Headers(o);
	it('behind the local proxy, uses the address nginx added last', () => {
		expect(clientKey('127.0.0.1', h({ 'x-forwarded-for': '6.6.6.6, 2.2.2.2' }))).toBe('2.2.2.2');
		expect(clientKey('::1', h({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
	});
	it('ignores the header from anyone but the proxy', () => expect(clientKey('192.168.1.9', h({ 'x-forwarded-for': '9.9.9.9' }))).toBe('192.168.1.9'));
	it('falls back to the peer when no header came', () => expect(clientKey('127.0.0.1', h({}))).toBe('127.0.0.1'));
});
