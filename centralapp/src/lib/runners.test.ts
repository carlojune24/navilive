import { describe, expect, it } from 'vitest';
import { countRunners } from './runners';

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
