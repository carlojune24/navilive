import { describe, expect, it } from 'vitest';
import { finishLine, recentFinishers } from './recent';
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

describe('finishLine', () => {
	it('mixes every category, newest first, with the category name and the time', () => {
		const a = { name: '5K', course, progress: [{ ...row('1', 100), time: 90 }, { ...row('2', 400), time: 390 }] };
		const b = { name: 'DUO', course, progress: [{ ...row('D1', 300), time: 280 }, row('D2', null)] };
		expect(finishLine([a, b], 5)).toEqual([
			{ bib: '2', name: 'N2', category: '5K', time: 390 },
			{ bib: 'D1', name: 'ND1', category: 'DUO', time: 280 },
			{ bib: '1', name: 'N1', category: '5K', time: 90 }
		]);
		expect(finishLine([a, b], 2).map((r) => r.bib)).toEqual(['2', 'D1']);
	});
});
