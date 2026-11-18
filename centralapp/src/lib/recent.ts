import type { CourseStation, ProgressRow } from './progress';

export type Recent = { bib: string; name: string };

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
