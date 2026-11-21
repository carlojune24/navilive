import { describe, expect, it } from 'vitest';
import { countRunners, epcToCard } from './runners';

describe('epcToCard', () => {
	it('matches what the station app shows (same cases as the Rust test)', () => {
		expect(epcToCard('00000000C8')).toBe('0000000200');
		expect(epcToCard('000000000000000000000192')).toBe('0000000402');
		expect(epcToCard('e2000000ffffffff')).toBe('4294967295');
		expect(epcToCard('')).toBe('');
		expect(epcToCard('BIB-12')).toBe('BIB-12');
	});
});

describe('countRunners', () => {
	it('counts people, not entries', () => {
		const solo = {};
		const duo = { members: [{}, {}] };
		const relay = { members: [{}, {}, {}, {}] };
		expect(countRunners([solo])).toBe(1);
		expect(countRunners([duo])).toBe(2);
		expect(countRunners([solo, duo, relay])).toBe(7);
	});
	it('a team with no runners listed, a missing list and no entries', () => {
		expect(countRunners([{ members: [] }, { members: null }])).toBe(2);
		expect(countRunners([])).toBe(0);
	});
});
