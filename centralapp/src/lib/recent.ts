import type { CourseStation, ProgressRow } from './progress';

export type Recent = { bib: string; name: string };
export type FinishLineRow = { bib: string; name: string; category: string; time: number | null };

/** The last `n` runners (or teams) across the finish line, newest first: their finish read or override, as the station
 *  saw it. Only the order is sent, never the time, so a held (Results pending) finisher's time stays hidden. */
export function recentFinishers(course: CourseStation[], progress: ProgressRow[], n: number): Recent[] {
	const fin = course.findIndex((s) => s.kind === 'finish');
	if (fin < 0) return [];
	return progress
		.filter((r) => r.state === 'finished' && r.at[fin] !== null)
		.sort((a, b) => b.at[fin]! - a.at[fin]! || a.bib.localeCompare(b.bib, undefined, { numeric: true }))
		.slice(0, n)
		.map((r) => ({ bib: r.bib, name: r.name }));
}

/** The live board's Finish view: the last `n` across the finish line in any category, newest first, with their
 *  unofficial time (shown even before the organizer releases the results; penalties may still change it). */
export function finishLine(cats: { name: string; course: CourseStation[]; progress: ProgressRow[] }[], n: number): FinishLineRow[] {
	return cats
		.flatMap((c) => {
			const fin = c.course.findIndex((s) => s.kind === 'finish');
			if (fin < 0) return [];
			return c.progress.filter((r) => r.state === 'finished' && r.at[fin] !== null).map((r) => ({ bib: r.bib, name: r.name, category: c.name, time: r.time, at: r.at[fin]! }));
		})
		.sort((a, b) => b.at - a.at || a.bib.localeCompare(b.bib, undefined, { numeric: true }))
		.slice(0, n)
		.map(({ at: _at, ...r }) => r);
}
