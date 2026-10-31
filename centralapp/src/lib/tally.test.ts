import { describe, expect, it } from 'vitest';
import { groupTally } from './tally';

const cats = [{ id: 1, name: '5K' }, { id: 2, name: '10K' }, { id: 3, name: 'Empty' }];
const batches = [{ id: 10, category_id: 1, name: 'Batch 1' }, { id: 11, category_id: 1, name: 'Batch 2' }];
const p = (bib: string, category_id: number, batch_id: number | null) => ({ bib, name: `R${bib}`, category_id, batch_id });

describe('groupTally', () => {
	it('groups by category then batch, bibs in numeric order, unbatched last, empty groups skipped', () => {
		const s = groupTally(cats, batches, [p('10', 1, 10), p('2', 1, 10), p('3', 1, null), p('7', 2, null)]);
		expect(s.map((x) => `${x.category}/${x.batch}`)).toEqual(['5K/Batch 1', '5K/No batch', '10K/No batch']);
		expect(s[0].runners.map((r) => r.bib)).toEqual(['2', '10']);
	});
});
