import { describe, expect, it } from 'vitest';
import { ago, hms, phTime } from './time';

describe('hms', () => {
	it('pads every field', () => expect(hms(0)).toBe('00:00:00'));
	it('counts seconds and minutes', () => expect(hms(61_000)).toBe('00:01:01'));
	it('counts past an hour', () => expect(hms(3_661_000)).toBe('01:01:01'));
	it('a clock that ran backwards reads zero, never a negative', () => expect(hms(-5000)).toBe('00:00:00'));
	it('drops part-seconds rather than rounding up', () => expect(hms(1999)).toBe('00:00:01'));
});

describe('phTime', () => {
	// 2026-10-26T01:30:45Z is 09:30:45 in Manila (UTC+8, no DST)
	it('shows Philippine time whatever the machine timezone', () => {
		expect(phTime(Date.UTC(2026, 9, 26, 1, 30, 45))).toMatch(/\b9:30:45\b/);
	});
});

describe('ago', () => {
	it('null is never', () => expect(ago(null, 0)).toBe('never'));
});
