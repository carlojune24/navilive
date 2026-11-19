import { describe, expect, it } from 'vitest';
import { computeResults, fmt, type P, type R, type S } from './results';

const st: S[] = [
	{ id: 1, name: 'Start', kind: 'start', ord: 0 },
	{ id: 2, name: 'Half', kind: 'checkpoint', ord: 1 },
	{ id: 3, name: 'Finish', kind: 'finish', ord: 2 }
];
const cats = [{ id: 10, name: '10K' }];
const ps: P[] = [
	{ id: 1, bib: '101', name: 'A', category_id: 10 },
	{ id: 2, bib: '102', name: 'B', category_id: 10 },
	{ id: 3, bib: '103', name: 'C', category_id: 10 }
];
// A starts at 0, B starts 60s later (wave), C never finishes
const rs: R[] = [
	{ pid: 1, station_id: 1, read_at_ms: 1000 },
	{ pid: 2, station_id: 1, read_at_ms: 61000 },
	{ pid: 3, station_id: 1, read_at_ms: 2000 },
	{ pid: 1, station_id: 2, read_at_ms: 301000 },
	{ pid: 1, station_id: 3, read_at_ms: 601000 },
	{ pid: 2, station_id: 3, read_at_ms: 641000 }
];

describe('manual gun start', () => {
	// nobody was read at the start station
	const noStart = rs.filter((r) => r.station_id !== 1);
	it('without a start read there is no time', () => {
		expect(computeResults(cats, ps, st, noStart, 'gun')[0].rows).toEqual([]);
	});
	it('a gun start set by hand times everyone from it, in gun and own mode', () => {
		for (const mode of ['gun', 'own'] as const) {
			const [c] = computeResults([{ id: 10, name: '10K', gun_ms: 100 }], ps, st, noStart, mode);
			expect(c.rows.map((r) => [r.bib, r.time])).toEqual([['101', 600900], ['102', 640900]]);
		}
	});
	it('a gun start set by hand wins over the first start read', () => {
		const [c] = computeResults([{ id: 10, name: '10K', gun_ms: 500 }], ps, st, rs, 'gun');
		expect(c.rows[0].time).toBe(600500);
	});
});

describe('batches', () => {
	const noStart = rs.filter((r) => r.station_id !== 1);
	it('a runner in a batch is timed from the batch gun, not the category gun', () => {
		const bp = [{ ...ps[0], batch_id: 7 }, ps[1]];
		const [c] = computeResults([{ id: 10, name: '10K', gun_ms: 100 }], bp, st, noStart, 'gun', undefined, undefined, [{ id: 7, gun_ms: 300 }]);
		expect(c.rows.map((r) => [r.bib, r.time])).toEqual([['101', 600700], ['102', 640900]]);
	});
	it('an unstarted batch has no time even when the category has started', () => {
		const bp = [{ ...ps[0], batch_id: 7 }];
		const [c] = computeResults([{ id: 10, name: '10K', gun_ms: 100 }], bp, st, noStart, 'gun', undefined, undefined, [{ id: 7, gun_ms: null }]);
		expect(c.rows).toEqual([]);
	});
});

describe('rank_by', () => {
	// A starts at 1000 and finishes at 601000 (time 600000); B starts at 61000 and finishes at 641000 (time 580000, but later on the clock)
	const r = (rank_by: string) => computeResults([{ id: 10, name: '10K', rank_by }], ps, st, rs, 'gun')[0].rows.map((x) => x.bib);
	it('chip: own start, B is faster', () => expect(r('chip')).toEqual(['102', '101']));
	it('finish: first across the line wins whatever their start', () => expect(r('finish')).toEqual(['101', '102']));
	it('elapsed: from the category gun (A first read 1000)', () => expect(r('elapsed')).toEqual(['101', '102']));
});

describe('finish override', () => {
	// B really crossed first on the clock (before A's 601000) but their read landed late: the admin fixes it
	const withOverride = (o: number | null) => computeResults(cats, ps.map((p) => (p.id === 2 ? { ...p, finishOverride: o } : p)), st, rs, 'gun')[0].rows;
	it('replaces the finish read and re-ranks', () => {
		const rows = withOverride(600000);
		expect(rows.map((x) => x.bib)).toEqual(['102', '101']);
		expect(rows[0]).toMatchObject({ finishAt: 600000, overridden: true });
	});
	it('no override leaves the ranking alone', () => expect(withOverride(null).map((x) => x.bib)).toEqual(['101', '102']));
});

describe('start corrected after the reads', () => {
	// the gun is moved to 700000: after every read of A (checkpoint 301000, finish 601000)
	const late = () => computeResults([{ id: 10, name: '10K', gun_ms: 700000 }], ps, st, rs.filter((r) => r.station_id !== 1), 'gun')[0];
	it('keeps the checkpoint and finish reads visible', () => {
		const a = late().progress.find((x) => x.bib === '101')!;
		expect(a.at.filter((t) => t !== null)).toEqual([301000, 601000]);
		expect(a.state).toBe('finished');
	});
	it('flags the finish-before-start runners instead of dropping them silently', () => {
		const c = late();
		expect(c.rows).toEqual([]);
		expect(c.badStart).toBe(2);
	});
});

describe('underway (the clock can no longer be started)', () => {
	it('only checkpoint or finish reads count, start-station reads do not', () => {
		const only = (f: (r: R) => boolean) => computeResults(cats, ps, st, rs.filter(f), 'gun')[0].underway;
		expect(only((r) => r.station_id === 1)).toBe(false);
		expect(only(() => false)).toBe(false);
		expect(only((r) => r.station_id === 2)).toBe(true);
		expect(only((r) => r.station_id === 3)).toBe(true);
	});
});

describe('computeResults', () => {
	it('gun time times everyone from the category first start', () => {
		const [c] = computeResults(cats, ps, st, rs, 'gun');
		expect(c.rows.map((r) => [r.bib, r.rank, r.time])).toEqual([['101', 1, 600000], ['102', 2, 640000]]);
		expect(c.rows[0].splits).toEqual([{ station: 'Half', elapsed: 300000 }]);
	});
	it('own start times from each runner start, which can change the order', () => {
		const [c] = computeResults(cats, ps, st, rs, 'own');
		expect(c.rows.map((r) => [r.bib, r.time])).toEqual([['102', 580000], ['101', 600000]]);
	});
	it('own mode: finisher with no start read is unranked, not crashed', () => {
		const [c] = computeResults(cats, ps, st, [{ pid: 1, station_id: 3, read_at_ms: 5000 }], 'own');
		expect(c.rows).toHaveLength(0);
	});
	it('a pass over the finish mat before the start does not hide the real finish', () => {
		const warm: R[] = [{ pid: 1, station_id: 3, read_at_ms: 500 }, { pid: 1, station_id: 1, read_at_ms: 1000 }, { pid: 1, station_id: 3, read_at_ms: 601000 }];
		const [c] = computeResults(cats, ps, st, warm, 'gun');
		expect(c.rows.map((r) => [r.bib, r.time])).toEqual([['101', 600000]]);
		expect(c.badStart).toBe(0);
	});
	it('a team read over the finish mat before the start does not hide its real finish', () => {
		const team: P[] = [{ id: 1, bib: '101', name: 'Duo', category_id: 10, members: [{ id: 11, name: 'X' }, { id: 12, name: 'Y' }] }];
		const reads: R[] = [{ pid: 1, station_id: 3, read_at_ms: 500 }, { pid: 1, station_id: 1, read_at_ms: 1000 }, { pid: 1, station_id: 3, read_at_ms: 601000 }];
		const [c] = computeResults(cats, team, st, reads, 'gun');
		expect(c.rows[0].time).toBe(600000);
	});
	it('ignores a finish read from before the start', () => {
		const [c] = computeResults(cats, ps, st, [{ pid: 1, station_id: 1, read_at_ms: 5000 }, { pid: 1, station_id: 3, read_at_ms: 1000 }], 'gun');
		expect(c.rows).toHaveLength(0);
	});
});

describe('finisher with no start time', () => {
	// one runner, a finish read only, category ranked by their own start read and no gun pressed
	const fin: R[] = [{ pid: 1, station_id: 3, read_at_ms: 5000 }];
	it('is counted, not silently dropped', () => {
		const [c] = computeResults([{ id: 10, name: '10K', rank_by: 'chip' }], ps, st, fin, 'gun');
		expect(c.noStart).toBe(1);
		expect(c.rows).toHaveLength(0);
	});
	it('is timed from the gun once Start is pressed', () => {
		const [c] = computeResults([{ id: 10, name: '10K', rank_by: 'chip', gun_ms: 1000 }], ps, st, fin, 'gun');
		expect(c.noStart).toBe(0);
		expect(c.rows.map((r) => [r.bib, r.time])).toEqual([['101', 4000]]);
	});
	it('stays zero when nobody finished', () => {
		expect(computeResults(cats, ps, st, rs, 'gun')[0].noStart).toBe(0);
	});
});

describe('fmt', () => {
	it('formats m:ss and h:mm:ss', () => {
		expect(fmt(65000)).toBe('0:01:05');
		expect(fmt(396977)).toBe('0:06:36');
		expect(fmt(3725000)).toBe('1:02:05');
	});
});

describe('team (relay / duo)', () => {
	const team: P[] = [{ id: 1, bib: '201', name: 'DUO', category_id: 10, members: [{ id: 7, name: 'Ann' }, { id: 8, name: 'Bob' }] }];
	const relay: P[] = [{ id: 1, bib: '301', name: 'RELAY', category_id: 10, members: [1, 2, 3, 4].map((id) => ({ id, name: 'R' + id })) }];
	const start = { pid: 1, station_id: 1, read_at_ms: 1000 };
	const fin = (at: number): R => ({ pid: 1, station_id: 3, read_at_ms: at });
	const run = (reads: R[], p = team) => computeResults(cats, p, st, reads, 'own')[0];
	it('finishes on its first finish read, whatever the team size', () => {
		expect(run([start, fin(601000), fin(701000)]).rows[0].time).toBe(600000);
		const c = run([start, fin(501000)], relay);
		expect(c.rows[0].time).toBe(500000);
		expect(c.progress[0].state).toBe('finished');
	});
	it('lists the team runners', () => {
		expect(run([start, fin(601000)]).rows[0].members).toEqual([{ name: 'Ann' }, { name: 'Bob' }]);
	});
	it('an override finishes the team', () => {
		expect(run([start], [{ ...team[0], finishOverride: 801000 }]).rows[0].time).toBe(800000);
	});
	it('an override fills the finish column of the progress view, so a released override is not shown as Verifying', () => {
		const pr = run([start], [{ ...team[0], finishOverride: 801000 }]).progress[0];
		expect(pr.at.at(-1)).toBe(801000);
		expect(pr.by.at(-1)).toBe('Override');
	});
	it('a solo runner is unaffected', () => {
		expect(run([start, fin(601000)], [{ id: 1, bib: '1', name: 'S', category_id: 10 }]).rows[0].time).toBe(600000);
	});
});

describe('penalty', () => {
	const two: P[] = [
		{ id: 1, bib: '1', name: 'A', category_id: 10, penaltyMs: 120000 },
		{ id: 2, bib: '2', name: 'B', category_id: 10 }
	];
	const reads: R[] = [
		{ pid: 1, station_id: 1, read_at_ms: 0 }, { pid: 1, station_id: 3, read_at_ms: 600000 },
		{ pid: 2, station_id: 1, read_at_ms: 0 }, { pid: 2, station_id: 3, read_at_ms: 660000 }
	];
	it('is added to the total time and can change the order', () => {
		const [c] = computeResults(cats, two, st, reads, 'own');
		expect(c.rows.map((r) => [r.bib, r.rank, r.time, r.penalty])).toEqual([['2', 1, 660000, undefined], ['1', 2, 720000, 120000]]);
		expect(c.progress.find((r) => r.bib === '1')).toMatchObject({ time: 720000, penalty: 120000 });
	});
});

describe('readGuns (clock nobody started)', () => {
	const st = [{ id: 1, name: 'Start', kind: 'start', ord: 0 }, { id: 2, name: 'Finish', kind: 'finish', ord: 1 }];
	const ps = [{ id: 1, bib: '1', name: 'A', category_id: 10 }, { id: 2, bib: '2', name: 'B', category_id: 10 }];
	const reads = [{ pid: 1, station_id: 1, read_at_ms: 1000 }, { pid: 2, station_id: 1, read_at_ms: 5000 }, { pid: 2, station_id: 2, read_at_ms: 9000 }];
	it('reports a category clock running from the earliest Start read', () => {
		const [c] = computeResults([{ id: 10, name: '5K' }], ps, st, reads, 'gun');
		expect(c.readGuns).toEqual({ c10: 1000 });
		expect(c.rows[0].time).toBe(8000); // the stray early read sets everyone's clock: why the admin is warned
	});
	it('reports nothing once the organizer sets the start', () => {
		const [c] = computeResults([{ id: 10, name: '5K', gun_ms: 4000 }], ps, st, reads, 'gun');
		expect(c.readGuns).toEqual({});
	});
});
