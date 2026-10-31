import { describe, expect, it } from 'vitest';
import { applyRelease, type Level } from './release';
import type { Cat, ProgressRow } from './results';

const course = [
	{ id: 1, name: 'Start', kind: 'start' },
	{ id: 2, name: 'CP1', kind: 'checkpoint' },
	{ id: 3, name: 'Finish', kind: 'finish' }
];
const prog = (bib: string, finished: boolean): ProgressRow => ({
	bib, name: bib, state: finished ? 'finished' : 'on-course', rank: finished ? 1 : null, time: finished ? 600 : null, start: 0,
	at: finished ? [1, 2, 3] : [1, 2, null], by: [null, null, null], last: finished ? 'Finish' : 'CP1', missed: []
});
const cat = { id: 1, name: '5K', course, rows: [{ bib: 'A', rank: 1 }, { bib: 'B', rank: 2 }], awards: [{ key: 'overall' }], progress: [prog('A', true), prog('B', true), prog('C', false)] } as unknown as Cat;
const run = (m: Record<string, Level>) => applyRelease([cat], (b) => m[b] ?? 'checkpoints')[0];

describe('applyRelease', () => {
	it('checkpoints: finishers show Finished and their start, but no rank, finish time or awards', () => {
		const c = run({});
		expect(c.rows).toEqual([]);
		expect(c.awards).toEqual([]);
		const a = c.progress.find((r) => r.bib === 'A')!;
		expect(a).toMatchObject({ state: 'finished', rank: null, time: null, start: 0, at: [1, 2, null] });
		expect(c.progress.find((r) => r.bib === 'C')).toMatchObject({ state: 'on-course', last: 'CP1' });
	});
	it('start + finish only: a held finisher keeps the start and loses the finish', () => {
		const sf = { ...cat, course: [course[0], course[2]], progress: [{ ...prog('A', true), at: [1, 3] }] } as unknown as Cat;
		expect(applyRelease([sf], () => 'checkpoints')[0].progress[0]).toMatchObject({ state: 'finished', rank: null, time: null, start: 0, at: [1, null] });
	});
	it('hidden: the runner is gone from progress', () => expect(run({ A: 'hidden' }).progress.map((r) => r.bib)).toEqual(['B', 'C']));
	it('a released batch shows its true ranks, awards stay held back', () => {
		const c = run({ B: 'released' });
		expect(c.rows.map((r) => [r.bib, r.rank])).toEqual([['B', 2]]);
		expect(c.awards).toEqual([]);
	});
	it('everyone released: nothing is changed', () => {
		const c = run({ A: 'released', B: 'released', C: 'released' });
		expect(c.rows).toHaveLength(2);
		expect(c.awards).toHaveLength(1);
		expect(c.progress.find((r) => r.bib === 'A')!.state).toBe('finished');
	});
});
