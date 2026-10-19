import { describe, expect, it } from 'vitest';
import { bestLink, clockWarning, linkState, parseHeartbeat } from './heartbeat';

const good = { laptop_id: 'L1', laptop_name: 'Finish laptop', app_version: '0.1.0', now_ms: 1_800_000_000_000, pending: 3, last_error: '', stations: [{ name: 'Finish', kind: 'finish', readers_total: 2, readers_online: 1, last_read_ms: 1_799_999_999_000, pending: 3 }] };

describe('parseHeartbeat', () => {
	it('accepts a good beat', () => {
		const b = parseHeartbeat(good)!;
		expect(b).toMatchObject({ laptopId: 'L1', laptopName: 'Finish laptop', pending: 3 });
		expect(b.stations[0]).toMatchObject({ name: 'Finish', readersOnline: 1, readersTotal: 2, lastReadMs: 1_799_999_999_000 });
	});
	it('defaults a missing name and allows a station that has not read anything', () => {
		const b = parseHeartbeat({ ...good, laptop_name: '', stations: [{ name: 'Start', readers_total: 1, readers_online: 1, last_read_ms: null }] })!;
		expect(b.laptopName).toBe('Station laptop');
		expect(b.stations[0].lastReadMs).toBeNull();
	});
	it('rejects malformed beats', () => {
		expect(parseHeartbeat(null)).toBeNull();
		expect(parseHeartbeat({ ...good, laptop_id: '' })).toBeNull();
		expect(parseHeartbeat({ ...good, now_ms: 'soon' })).toBeNull();
		expect(parseHeartbeat({ ...good, stations: 'x' })).toBeNull();
		expect(parseHeartbeat({ ...good, stations: [{ name: '' }] })).toBeNull();
		expect(parseHeartbeat({ ...good, stations: new Array(31).fill({ name: 'a' }) })).toBeNull();
	});
	it('cuts overlong text', () => {
		expect(parseHeartbeat({ ...good, laptop_name: 'x'.repeat(500) })!.laptopName).toHaveLength(80);
	});
});

describe('linkState', () => {
	const now = 1_000_000;
	it('judges by the age of the last beat', () => {
		expect(linkState(now - 3_000, now)).toBe('online');
		expect(linkState(now - 14_999, now)).toBe('online');
		expect(linkState(now - 20_000, now)).toBe('late');
		expect(linkState(now - 60_000, now)).toBe('offline');
		expect(linkState(null, now)).toBe('never');
	});
	it('the best of several laptops wins', () => {
		expect(bestLink(['offline', 'online'])).toBe('online');
		expect(bestLink(['never', 'late', 'offline'])).toBe('late');
		expect(bestLink([])).toBe('never');
	});
});

describe('clockWarning', () => {
	it('warns above two seconds either way', () => {
		expect(clockWarning(300)).toBe(false);
		expect(clockWarning(-1900)).toBe(false);
		expect(clockWarning(4000)).toBe(true);
		expect(clockWarning(-12000)).toBe(true);
		expect(clockWarning(null)).toBe(false);
	});
});
