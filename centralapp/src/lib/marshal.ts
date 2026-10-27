/**
 * What the marshal tagging page shows, derived from /board. Pure, so the page itself holds no rules.
 * Nothing here gates tagging: a runner may be tapped at any station whatever their state, because a
 * missed checkpoint is exactly the case manual tagging exists for.
 */

export type Tag = { bib: string; station_id: number; at: number };
export type Person = { bib: string; name: string; tag: string; category_id: number | null; batch_id: number | null };
export type Batch = { id: number; name: string; category_id: number; gun_ms: number | null };

export type RunnerState =
	| 'tagged' // already read here
	| 'missed' // read at a later station but never here, so they are gone
	| 'incoming' // read at the station just before this one
	| 'waiting'; // no sign of them yet

export type BatchState =
	| 'not-started' // no gun yet
	| 'live' // started, and someone in it still has to come through here
	| 'done'; // everyone in it has been read here

/** bib -> (station id -> earliest read), from the flat rows /board returns. */
export function seenBy(tagged: Tag[]) {
	const m = new Map<string, Map<number, number>>();
	for (const t of tagged) {
		let s = m.get(t.bib);
		if (!s) m.set(t.bib, (s = new Map()));
		s.set(t.station_id, Math.min(s.get(t.station_id) ?? Infinity, t.at));
	}
	return m;
}

/**
 * `course` is the station ids this runner passes, in order: the category's own course when it has one,
 * otherwise every station by `ord`.
 */
export function runnerState(bib: string, seen: Map<string, Map<number, number>>, stationId: number, course: number[]): RunnerState {
	const mine = seen.get(bib);
	if (!mine) return 'waiting';
	if (mine.has(stationId)) return 'tagged';
	const here = course.indexOf(stationId);
	if (here === -1) return 'waiting';
	// past us already: whoever is marshalling here never caught them
	if (course.slice(here + 1).some((id) => mine.has(id))) return 'missed';
	if (here > 0 && mine.has(course[here - 1])) return 'incoming';
	return 'waiting';
}

export function taggedCount(members: Person[], seen: Map<string, Map<number, number>>, stationId: number) {
	return members.filter((p) => seen.get(p.bib)?.has(stationId)).length;
}

export function batchState(batch: Batch, members: Person[], seen: Map<string, Map<number, number>>, stationId: number): BatchState {
	if (batch.gun_ms === null || batch.gun_ms === undefined) return 'not-started';
	// an empty batch is never "done" — there is nobody to have come through
	if (members.length > 0 && taggedCount(members, seen, stationId) === members.length) return 'done';
	return 'live';
}

/** The gun times of a poll, to compare against the next one. */
export function gunsOf(batches: Batch[]) {
	return new Map(batches.map((b) => [b.id, b.gun_ms ?? null]));
}

/**
 * Batches whose gun has just been fired, found by comparing a poll against the one before it.
 * `prev === null` is the first poll of a session: a marshal who opens the page mid-race is told
 * about nothing, because every wave already running would announce itself at once. A batch seen
 * here for the first time counts as not new for the same reason.
 */
export function newlyStarted(prev: Map<number, number | null> | null, batches: Batch[]): Batch[] {
	if (!prev) return [];
	return batches.filter((b) => b.gun_ms !== null && b.gun_ms !== undefined && prev.has(b.id) && prev.get(b.id) === null);
}

export type LocalTap = { bib: string; station: string; read_at_ms: number; voided: boolean };

/**
 * Lays this device's own taps over the board, so a tap shows instantly instead of waiting for the
 * next poll. A board read newer than the local tap wins: otherwise an undo would mask the runner
 * for good, and a marshal who undid a mis-tap would never see the real read that came later.
 * shortcut: an undo still masks a read made BEFORE the local tap (another device catching the same
 * runner first). Give /board a device_id per read if that ever matters.
 * Mutates and returns `seen`, which is freshly built per poll.
 */
export function applyLocal(seen: Map<string, Map<number, number>>, taps: LocalTap[], stationId: number, stationName: string) {
	for (const t of taps) {
		if (t.station !== stationName) continue; // a tap made at another station must not bleed into this one
		const at = seen.get(t.bib)?.get(stationId);
		if (at !== undefined && at > t.read_at_ms) continue;
		let s = seen.get(t.bib);
		if (!s) seen.set(t.bib, (s = new Map()));
		if (t.voided) s.delete(stationId);
		else s.set(stationId, t.read_at_ms);
	}
	return seen;
}

/** When the last runner of a batch came through this station, or null while any are still out. */
export function lastThrough(members: Person[], seen: Map<string, Map<number, number>>, stationId: number) {
	let last = null;
	for (const p of members) {
		const at = seen.get(p.bib)?.get(stationId);
		if (at === undefined) return null; // someone is still on course
		if (last === null || at > last) last = at;
	}
	return last;
}
