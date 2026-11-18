import { describe, expect, it } from 'vitest';
import { cleanUrl } from './sponsors';

describe('cleanUrl', () => {
	it('keeps web addresses and adds https when missing', () => {
		expect(cleanUrl('')).toBe('');
		expect(cleanUrl('example.com')).toBe('https://example.com/');
		expect(cleanUrl('http://example.com/a')).toBe('http://example.com/a');
	});
	it('refuses other schemes', () => {
		expect(cleanUrl('javascript:alert(1)')).toBeNull();
		expect(cleanUrl('JavaScript:alert(1)')).toBeNull();
		expect(cleanUrl('data:text/html,x')).toBeNull();
		expect(cleanUrl('mailto:a@b.c')).toBeNull();
	});
});
