import type { Cat } from './results';

export type Level = 'hidden' | 'checkpoints' | 'released';
export const LEVELS: Level[] = ['hidden', 'checkpoints', 'released'];

/**
 * What the public board may see, per runner. Ranks stay the true category ranks (a released batch is not
 * re-ranked), and a category's awards only appear once every runner in it is released.
 */
export function applyRelease(cats: Cat[], levelOf: (bib: string) => Level): Cat[] {
	return cats.map((c) => {
		const allReleased = c.progress.every((r) => levelOf(r.bib) === 'released');
		return {
			...c,
			rows: c.rows.filter((r) => levelOf(r.bib) === 'released'),
			awards: allReleased ? c.awards : [],
			held: c.progress.filter((r) => r.state === 'finished' && levelOf(r.bib) === 'checkpoints').length,
			progress: c.progress.flatMap((r) => {
				const lv = levelOf(r.bib);
				if (lv === 'released') return [r];
				if (lv === 'hidden') return [];
				// checkpoints only: the finish read goes, so a finisher looks like they are still on course
				const at = r.at.map((t, i) => (c.course[i]?.kind === 'finish' ? null : t));
				const furthest = at.reduce<number>((m, t, i) => (t !== null ? i : m), -1);
				const state = furthest >= 0 || r.start !== null ? 'on-course' : 'not-started';
				return [{ ...r, at, state, rank: null, time: null, last: furthest >= 0 ? c.course[furthest].name : null, missed: [] } as typeof r];
			})
		};
	});
}
