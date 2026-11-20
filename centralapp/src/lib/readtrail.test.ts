import { describe, expect, it } from 'vitest';
import { buildTrail, sourceLabel, type TrailRead } from './readtrail';

const r = (id: number, station_id: number | null, read_at_ms: number, o: Partial<TrailRead> = {}): TrailRead => ({ id, station_id, read_at_ms, ingested_ms: null, device_id: 'D', source: 'rfid', voided: false, ...o });

describe('buildTrail', () => {
	it('clean run has no flags', () => {
		expect(buildTrail([1, 2, 3], [r(1, 1, 10_000), r(2, 2, 20_000), r(3, 3, 30_000)]).flags).toEqual([]);
	});
	it('a missing checkpoint before the last one seen is a gap; one after is not', () => {
		expect(buildTrail([1, 2, 3], [r(1, 1, 10_000), r(3, 3, 30_000)]).flags).toContain('gap');
		expect(buildTrail([1, 2, 3], [r(1, 1, 10_000), r(2, 2, 20_000)]).flags).toEqual([]);
	});
	it('detects out of order, duplicates and counted manual taps', () => {
		expect(buildTrail([1, 2], [r(1, 1, 30_000), r(2, 2, 20_000)]).flags).toContain('order');
		expect(buildTrail([1], [r(1, 1, 10_000), r(2, 1, 12_000)]).flags).toContain('duplicate');
		expect(buildTrail([1], [r(1, 1, 10_000, { source: 'station_manual' })]).flags).toEqual(['manual', 'miss']);
	});
	it('voided reads are kept but never counted; strays are separated', () => {
		const t = buildTrail([1], [r(1, 1, 10_000, { voided: true }), r(2, 1, 15_000), r(3, 9, 5_000), r(4, null, 6_000)]);
		expect(t.slots[0].reads).toHaveLength(2);
		expect(t.slots[0].counted?.id).toBe(2);
		expect(t.flags).toEqual([]);
		expect(t.stray.map((x) => x.id)).toEqual([3, 4]);
	});
	it('coverage: reader only, hand only, both; a voided read does not count', () => {
		const t = buildTrail([1, 2, 3, 4], [r(1, 1, 10_000), r(2, 2, 20_000, { source: 'marshal' }), r(3, 3, 30_000), r(4, 3, 31_000, { source: 'station_manual' }), r(5, 4, 40_000, { voided: true })]);
		expect(t.slots.map((s) => s.coverage)).toEqual(['rfid', 'hand', 'both', 'none']);
		expect(t.flags).toContain('miss');
	});
	it('a reader and a hand tap at the same station is not a reader miss', () => {
		expect(buildTrail([1], [r(1, 1, 10_000), r(2, 1, 11_000, { source: 'station_manual' })]).flags).not.toContain('miss');
	});
	it('two checkpoints under a second apart is flagged fast, a normal split is not', () => {
		expect(buildTrail([1, 2], [r(1, 1, 10_000), r(2, 2, 10_400)]).flags).toContain('fast');
		expect(buildTrail([1, 2], [r(1, 1, 10_000), r(2, 2, 70_000)]).flags).not.toContain('fast');
	});
});

describe('sourceLabel', () => {
	it('names every read type, the finish override, and leaves unknown keys readable', () => {
		expect([null, 'rfid', 'marshal', 'station_manual', 'admin_manual', 'override', 'weird'].map(sourceLabel)).toEqual(['', 'RFID', 'Marshal tap', 'Station tap', 'Admin entry', 'Override', 'weird']);
	});
});
