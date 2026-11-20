import { describe, expect, it } from 'vitest';
import { applyLocal, batchState, gunsOf, lastThrough, newlyStarted, runnerState, seenBy, stampFor, taggedCount, undoLocked, type Batch, type Person, type Tag } from './marshal';
import { defaultCourse } from './progress';

const course = [1, 2, 3]; // Start, CP1, Finish
const p = (bib: string, batch_id: number | null = 7): Person => ({ bib, name: `R${bib}`, tag: '', category_id: 10, batch_id });
const members = [p('101'), p('102'), p('103')];

describe('runnerState', () => {
	it('no reads at all is waiting', () => {
		expect(runnerState('101', seenBy([]), 2, course)).toBe('waiting');
	});
	it('a read here is tagged', () => {
		const seen = seenBy([{ bib: '101', station_id: 2, at: 500 }]);
		expect(runnerState('101', seen, 2, course)).toBe('tagged');
	});
	it('a read at the station before is incoming', () => {
		const seen = seenBy([{ bib: '101', station_id: 1, at: 500 }]);
		expect(runnerState('101', seen, 2, course)).toBe('incoming');
	});
	it('a read at a later station but none here is missed, not tagged', () => {
		const seen = seenBy([{ bib: '101', station_id: 1, at: 500 }, { bib: '101', station_id: 3, at: 900 }]);
		expect(runnerState('101', seen, 2, course)).toBe('missed');
	});
	it('being tagged here wins over a later read, so a late catch-up still reads as tagged', () => {
		const seen = seenBy([{ bib: '101', station_id: 2, at: 700 }, { bib: '101', station_id: 3, at: 900 }]);
		expect(runnerState('101', seen, 2, course)).toBe('tagged');
	});
	it('the first station on the course is never incoming', () => {
		const seen = seenBy([{ bib: '101', station_id: 2, at: 500 }]);
		expect(runnerState('101', seen, 1, course)).toBe('missed');
	});
	it('a station off this runner course leaves them waiting', () => {
		const seen = seenBy([{ bib: '101', station_id: 1, at: 500 }]);
		expect(runnerState('101', seen, 99, course)).toBe('waiting');
	});
});

describe('seenBy', () => {
	it('keeps the earliest read per station', () => {
		const rows: Tag[] = [{ bib: '101', station_id: 2, at: 900 }, { bib: '101', station_id: 2, at: 400 }];
		expect(seenBy(rows).get('101')!.get(2)).toBe(400);
	});
});

describe('batchState', () => {
	const seenNone = seenBy([]);
	const b = (gun_ms: number | null): Batch => ({ id: 7, name: '1', category_id: 10, gun_ms });
	it('no gun means not started', () => {
		expect(batchState(b(null), members, seenNone, 2)).toBe('not-started');
	});
	it('started with people still to come is live', () => {
		expect(batchState(b(1000), members, seenBy([{ bib: '101', station_id: 2, at: 1 }]), 2)).toBe('live');
	});
	it('started and everyone read here is done', () => {
		const all = seenBy(members.map((m) => ({ bib: m.bib, station_id: 2, at: 1 })));
		expect(batchState(b(1000), members, all, 2)).toBe('done');
	});
	it('an empty started batch is live, not done', () => {
		expect(batchState(b(1000), [], seenNone, 2)).toBe('live');
	});
	it('reads at another station do not finish this one', () => {
		const all = seenBy(members.map((m) => ({ bib: m.bib, station_id: 1, at: 1 })));
		expect(batchState(b(1000), members, all, 2)).toBe('live');
	});
});

describe('taggedCount', () => {
	it('counts only reads at this station', () => {
		const seen = seenBy([{ bib: '101', station_id: 2, at: 1 }, { bib: '102', station_id: 1, at: 1 }]);
		expect(taggedCount(members, seen, 2)).toBe(1);
	});
});

describe('newlyStarted', () => {
	const bt = (id: number, gun_ms: number | null): Batch => ({ id, name: String(id), category_id: 10, gun_ms });
	it('the first poll of a session announces nothing, however many waves are already running', () => {
		expect(newlyStarted(null, [bt(1, 5000), bt(2, null)])).toEqual([]);
	});
	it('a gun going from unset to set announces', () => {
		const prev = gunsOf([bt(1, null), bt(2, null)]);
		expect(newlyStarted(prev, [bt(1, 5000), bt(2, null)]).map((b) => b.id)).toEqual([1]);
	});
	it('an unchanged gun does not announce again', () => {
		expect(newlyStarted(gunsOf([bt(1, 5000)]), [bt(1, 5000)])).toEqual([]);
	});
	it('a corrected gun time does not announce: the wave already went', () => {
		expect(newlyStarted(gunsOf([bt(1, 5000)]), [bt(1, 7000)])).toEqual([]);
	});
	it('a batch first seen already started does not announce', () => {
		expect(newlyStarted(gunsOf([bt(1, null)]), [bt(1, null), bt(2, 5000)])).toEqual([]);
	});
	it('two batches fired together both announce', () => {
		const prev = gunsOf([bt(1, null), bt(2, null)]);
		expect(newlyStarted(prev, [bt(1, 5000), bt(2, 5000)]).map((b) => b.id)).toEqual([1, 2]);
	});
	it('an undone gun can be fired again and announces', () => {
		expect(newlyStarted(gunsOf([bt(1, null)]), [bt(1, 9000)]).map((b) => b.id)).toEqual([1]);
	});
});

describe('applyLocal', () => {
	const tap = (bib: string, read_at_ms: number, voided = false, station = 'CP1') => ({ bib, station, read_at_ms, voided });
	it('an unsynced tap shows at once', () => {
		const m = applyLocal(seenBy([]), [tap('101', 500)], 2, 'CP1');
		expect(m.get('101')!.get(2)).toBe(500);
	});
	it('a tap made at another station does not bleed into this one', () => {
		const m = applyLocal(seenBy([]), [tap('101', 500, false, 'CP2')], 2, 'CP1');
		expect(m.get('101')).toBe(undefined);
	});
	it('an undo hides this device own tap', () => {
		const m = applyLocal(seenBy([{ bib: '101', station_id: 2, at: 500 }]), [tap('101', 500, true)], 2, 'CP1');
		expect(m.get('101')!.has(2)).toBe(false);
	});
	it('a later read from another device survives an undo, so a re-tagged runner is not lost', () => {
		const m = applyLocal(seenBy([{ bib: '101', station_id: 2, at: 900 }]), [tap('101', 500, true)], 2, 'CP1');
		expect(m.get('101')!.get(2)).toBe(900);
	});
	it('a later read also wins over a stale local tap', () => {
		const m = applyLocal(seenBy([{ bib: '101', station_id: 2, at: 900 }]), [tap('101', 500)], 2, 'CP1');
		expect(m.get('101')!.get(2)).toBe(900);
	});
});

describe('lastThrough', () => {
	it('is null while anyone is still out', () => {
		const seen = seenBy([{ bib: '101', station_id: 2, at: 500 }]);
		expect(lastThrough(members, seen, 2)).toBe(null);
	});
	it('is the latest arrival once everyone is in', () => {
		const seen = seenBy(members.map((m, i) => ({ bib: m.bib, station_id: 2, at: 500 + i * 100 })));
		expect(lastThrough(members, seen, 2)).toBe(700);
	});
	it('an empty batch has nobody to wait for', () => {
		expect(lastThrough([], seenBy([]), 2)).toBe(null);
	});
	it('a read at another station does not count as through here', () => {
		const seen = seenBy(members.map((m) => ({ bib: m.bib, station_id: 3, at: 500 })));
		expect(lastThrough(members, seen, 2)).toBe(null);
	});
});

describe('stampFor', () => {
	it('uses the server clock for a prompt tap', () => expect(stampFor(100_000, 101_500)).toBe(101_500));
	it('keeps the phone time for a tap that waited offline', () => expect(stampFor(100_000, 200_000)).toBe(100_000));
	it('keeps the phone time when it claims to be far in the future', () => expect(stampFor(300_000, 100_000)).toBe(300_000));
});

describe('undoLocked', () => {
	// course: start 1, CP 2, CP 3, finish 4
	const course = [1, 2, 3, 4];
	const at = (stations: number[]) => seenBy(stations.map((id) => ({ bib: '7', station_id: id, at: id * 100 })));
	it('free while the runner has no later read', () => {
		expect(undoLocked('7', at([1, 2]), 2, course, [4])).toBe(false);
		expect(undoLocked('8', at([1, 2]), 2, course, [4])).toBe(false);
	});
	it('locked once they reach a later checkpoint or the finish', () => {
		expect(undoLocked('7', at([1, 2, 3]), 2, course, [4])).toBe(true);
		expect(undoLocked('7', at([1, 2, 4]), 2, course, [4])).toBe(true);
	});
	it('a finish read anywhere locks a checkpoint off the course; the finish marshal may still undo their own tap', () => {
		expect(undoLocked('7', at([2, 4]), 9, course, [4])).toBe(true);
		expect(undoLocked('7', at([1, 4]), 4, course, [4])).toBe(false);
	});
});

describe('finish added before a checkpoint (ord: Start, Finish, CP1)', () => {
	const st = [
		{ id: 1, kind: 'start', ord: 0 },
		{ id: 2, kind: 'finish', ord: 1 },
		{ id: 3, kind: 'checkpoint', ord: 2 }
	];
	const c = defaultCourse(st).map((s) => s.id); // [1, 3, 2]
	it('a runner read at the finish is missed at the checkpoint, not incoming', () => {
		const seen = seenBy([{ bib: '101', station_id: 1, at: 1 }, { bib: '101', station_id: 2, at: 9 }]);
		expect(runnerState('101', seen, 3, c)).toBe('missed');
	});
	it('a runner only read at the start is incoming at the checkpoint, and one read at the checkpoint is incoming at the finish', () => {
		expect(runnerState('102', seenBy([{ bib: '102', station_id: 1, at: 1 }]), 3, c)).toBe('incoming');
		expect(runnerState('103', seenBy([{ bib: '103', station_id: 3, at: 5 }]), 2, c)).toBe('incoming');
	});
});
