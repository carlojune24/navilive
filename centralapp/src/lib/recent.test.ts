import { describe, expect, it } from 'vitest';
import { recentFinishers } from './recent';
import type { ProgressRow } from './progress';

const course = [
	{ id: 1, name: 'Start', kind: 'start' },
	{ id: 3, name: 'Finish', kind: 'finish' }
];
const row = (bib: string, fin: number | null, state: ProgressRow['state'] = fin === null ? 'on-course' : 'finished') =>
	({ bib, name: 'N' + bib, state, rank: null, time: null, start: 0, at: [0, fin], by: [null, null], last: null, missed: [] }) as ProgressRow;

describe('recentFinishers', () => {
	it('newest first, limited, skipping runners still on course', () => {
		const rows = [row('1', 100), row('2', 300), row('3', 200), row('4', null), row('5', 400)];
		expect(recentFinishers(course, rows, 3).map((r) => r.bib)).toEqual(['5', '2', '3']);
	});
	it('the 6th finisher pushes the first one out of a list of 5', () => {
		const rows = [1, 2, 3, 4, 5, 6].map((i) => row(String(i), i * 100));
		expect(recentFinishers(course, rows, 5).map((r) => r.bib)).toEqual(['6', '5', '4', '3', '2']);
	});
	it('no finish station: nothing', () => {
		expect(recentFinishers([course[0]], [row('1', 100)], 5)).toEqual([]);
	});
});
