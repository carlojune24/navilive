// Who has reached which station, per category, and who skipped one. Pure, so it is unit-tested.

export type CourseStation = { id: number; name: string; kind: string };
export type ProgressState = 'not-started' | 'on-course' | 'finished';
export type ProgressRow = {
	bib: string;
	name: string;
	state: ProgressState;
	rank: number | null;
	start: number | null; // the start the race time is measured from (gun or own), null if unknown
	at: (number | null)[]; // first arrival (ms, clock time) at each course station, null = not reached yet
	last: string | null; // the furthest station reached
	missed: string[]; // course stations with no read although the runner has a read at a later one
};

const KIND_RANK: Record<string, number> = { start: 0, checkpoint: 1, finish: 2 };

/** The course when nothing is configured: start stations, then checkpoints in the order they were added, then finish. */
export function defaultCourse<T extends { id: number; kind: string; ord?: number }>(stations: T[]): T[] {
	return [...stations].sort((a, b) => (KIND_RANK[a.kind] ?? 1) - (KIND_RANK[b.kind] ?? 1) || (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id);
}

/** A configured course (list of station ids in order) turned into stations; unknown ids are dropped. null/empty = the default. */
export function resolveCourse(stations: CourseStation[], ids: number[] | null | undefined): CourseStation[] {
	const ordered = defaultCourse(stations as (CourseStation & { ord?: number })[]);
	if (!ids || !ids.length) return ordered;
	const byId = new Map(stations.map((s) => [s.id, s]));
	const picked = ids.map((id) => byId.get(id)).filter((s): s is CourseStation => !!s);
	return picked.length ? picked : ordered;
}

export type Person = {
	bib: string;
	name: string;
	start: number | null;
	finished: boolean;
	rank: number | null;
	first: Map<number, number>; // station id -> first valid read (ms)
};

export function buildProgress(course: CourseStation[], people: Person[]): ProgressRow[] {
	const rows = people.map((p): ProgressRow => {
		const at = course.map((s) => p.first.get(s.id) ?? null);
		let furthest = -1;
		at.forEach((t, i) => t !== null && (furthest = i));
		// a finished runner is judged against the whole course, even if the finish station is not on a custom course
		const upTo = p.finished ? course.length - 1 : furthest;
		const missed = course.filter((_, i) => i < upTo && at[i] === null).map((s) => s.name);
		const state: ProgressState = p.finished ? 'finished' : furthest >= 0 || p.start !== null ? 'on-course' : 'not-started';
		return { bib: p.bib, name: p.name, state, rank: p.rank, start: p.start, at, last: furthest >= 0 ? course[furthest].name : null, missed };
	});
	const order = (r: ProgressRow) => (r.state === 'finished' ? 0 : r.state === 'on-course' ? 1 : 2);
	const furthestIndex = (r: ProgressRow) => r.at.reduce<number>((m, t, i) => (t !== null ? i : m), -1);
	const arrival = (r: ProgressRow) => r.at[furthestIndex(r)] ?? Infinity;
	return rows.sort((a, b) => {
		if (order(a) !== order(b)) return order(a) - order(b);
		if (a.state === 'finished') return (a.rank ?? 1e9) - (b.rank ?? 1e9);
		if (a.state === 'on-course') return furthestIndex(b) - furthestIndex(a) || arrival(a) - arrival(b) || a.bib.localeCompare(b.bib, undefined, { numeric: true });
		return a.bib.localeCompare(b.bib, undefined, { numeric: true });
	});
}
