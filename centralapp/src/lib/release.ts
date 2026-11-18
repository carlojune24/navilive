import type { Cat } from './results';

export type Level = 'checkpoints' | 'released';
export const LEVELS: Level[] = ['checkpoints', 'released'];

/**
 * What the public board may see, per runner. A released batch shows its finish times; places only appear once every
 * runner in the category is released (a later, faster batch could still push them down), and so do the awards.
 */
export function applyRelease(cats: Cat[], levelOf: (bib: string) => Level): Cat[] {
	return cats.map((c) => {
		const allReleased = c.progress.every((r) => levelOf(r.bib) === 'released');
		return {
			...c,
			rows: c.rows.filter((r) => levelOf(r.bib) === 'released').map((r) => (allReleased ? r : { ...r, rank: null })),
			provisional: !allReleased,
			awards: allReleased ? c.awards : [],
			held: c.progress.filter((r) => r.state === 'finished' && levelOf(r.bib) === 'checkpoints').length,
			progress: unorderHeld(c.progress, levelOf).flatMap((r) => {
				const lv = levelOf(r.bib);
				if (lv === 'released') return [allReleased ? r : { ...r, rank: null }];
				// results pending ('checkpoints'): the finish read goes. A finisher shows their start and "Finished", but no time or rank,
				// so nobody can pick the winner before the results are settled.
				const at = r.at.map((t, i) => (c.course[i]?.kind === 'finish' ? null : t));
				const furthest = at.reduce<number>((m, t, i) => (t !== null ? i : m), -1);
				if (r.state === 'finished') return [{ ...r, at, rank: null, time: null, missed: [] } as typeof r];
				const state = furthest >= 0 || r.start !== null ? 'on-course' : 'not-started';
				return [{ ...r, at, state, rank: null, time: null, last: furthest >= 0 ? c.course[furthest].name : null, missed: [] } as typeof r];
			})
		};
	});
}

/** Held finishers come after the released ones, by bib: their real order (finish order) would give the winner away. */
function unorderHeld(rows: Cat['progress'], levelOf: (bib: string) => Level) {
	const held = (r: Cat['progress'][number]) => r.state === 'finished' && levelOf(r.bib) === 'checkpoints';
	const fin = rows.filter((r) => r.state === 'finished');
	return [
		...fin.filter((r) => !held(r)),
		...fin.filter(held).sort((a, b) => a.bib.localeCompare(b.bib, undefined, { numeric: true })),
		...rows.filter((r) => r.state !== 'finished')
	];
}
