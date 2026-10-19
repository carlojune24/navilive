import { describe, expect, it } from 'vitest';
import { buildProgress, defaultCourse, resolveCourse, type CourseStation, type Person } from './progress';

const S = (id: number, name: string, kind: string, ord = id) => ({ id, name, kind, ord });
// stations as they were added: Start, Finish, then a checkpoint added later (so it has the highest ord)
const stations = [S(1, 'Start', 'start', 0), S(2, 'Finish', 'finish', 1), S(3, 'Checkpoint 1', 'checkpoint', 2), S(4, 'Checkpoint 2', 'checkpoint', 3)];

describe('courses', () => {
	it('default: start, checkpoints in the order added, finish last', () => {
		expect(defaultCourse(stations).map((s) => s.name)).toEqual(['Start', 'Checkpoint 1', 'Checkpoint 2', 'Finish']);
	});
	it('a configured course keeps the chosen order and drops unknown stations', () => {
		const c = resolveCourse(stations, [1, 4, 99, 2]);
		expect(c.map((s) => s.name)).toEqual(['Start', 'Checkpoint 2', 'Finish']);
	});
	it('no or empty or all-unknown configuration falls back to the default', () => {
		expect(resolveCourse(stations, null)).toHaveLength(4);
		expect(resolveCourse(stations, [])).toHaveLength(4);
		expect(resolveCourse(stations, [99])).toHaveLength(4);
	});
});

const course5k: CourseStation[] = [S(1, 'Start', 'start'), S(3, 'Checkpoint 1', 'checkpoint'), S(2, 'Finish', 'finish')];
const person = (bib: string, o: Partial<Person> & { reads?: Record<number, number> } = {}): Person => ({
	bib,
	name: 'R' + bib,
	start: o.start ?? null,
	finished: o.finished ?? false,
	rank: o.rank ?? null,
	first: new Map(Object.entries(o.reads ?? {}).map(([k, v]) => [Number(k), v]))
});

describe('buildProgress', () => {
	const rows = buildProgress(course5k, [
		person('1', { start: 0, finished: true, rank: 2, reads: { 1: 0, 3: 500, 2: 1000 } }),
		person('2', { start: 0, finished: true, rank: 1, reads: { 1: 0, 3: 400, 2: 900 } }),
		person('3', { start: 0, reads: { 1: 0, 3: 700 } }), // at checkpoint 1, on course
		person('4', { start: 0, reads: { 1: 0, 3: 600 } }), // reached it earlier than 3
		person('5', { start: 0, reads: { 1: 0 } }), // started only
		person('6'), // not started
		person('7', { start: 0, finished: true, rank: 3, reads: { 1: 0, 2: 1200 } }) // skipped checkpoint 1
	]);
	const by = (bib: string) => rows.find((r) => r.bib === bib)!;

	it('states', () => {
		expect(by('2').state).toBe('finished');
		expect(by('3').state).toBe('on-course');
		expect(by('5').state).toBe('on-course');
		expect(by('6').state).toBe('not-started');
	});
	it('orders finished by rank, then furthest along (earlier arrival first), then those still on the start, then not started', () => {
		expect(rows.map((r) => r.bib)).toEqual(['2', '1', '7', '4', '3', '5', '6']);
	});
	it('last station and arrival times per course station', () => {
		expect(by('3').last).toBe('Checkpoint 1');
		expect(by('3').at).toEqual([0, 700, null]);
		expect(by('6').last).toBeNull();
	});
	it('flags a station that was skipped, only when a later station was reached', () => {
		expect(by('7').missed).toEqual(['Checkpoint 1']);
		expect(by('3').missed).toEqual([]); // has simply not reached the finish yet
		expect(by('5').missed).toEqual([]);
		expect(by('1').missed).toEqual([]);
	});
	it('a runner at the checkpoint with no start read is flagged for the missing start', () => {
		const r = buildProgress(course5k, [person('9', { reads: { 3: 300 } })])[0];
		expect(r.missed).toEqual(['Start']);
		expect(r.state).toBe('on-course');
	});
});
