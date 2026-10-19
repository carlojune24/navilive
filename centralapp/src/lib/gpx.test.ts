import { describe, expect, it } from 'vitest';
import { buildTrack, decimate, isTrack, parseGpx, spotAt, type RawPoint } from './gpx';

const gpx = `<gpx><trk><name>Test 10K</name><trkseg>
<trkpt lat="45.0" lon="7.0"><ele>100</ele></trkpt>
<trkpt lat="45.009" lon="7.0"><ele>120</ele></trkpt>
<trkpt lat="45.018" lon="7.0"><ele>110</ele></trkpt>
</trkseg></trk></gpx>`;

describe('gpx', () => {
	it('parses points and name', () => {
		const r = parseGpx(gpx);
		expect(r.name).toBe('Test 10K');
		expect(r.pts).toHaveLength(3);
		expect(r.pts[1]).toEqual([7, 45.009, 120]);
	});
	it('rejects garbage', () => {
		expect(parseGpx('<html>nope</html>').pts).toHaveLength(0);
		expect(buildTrack([])).toBeNull();
		expect(isTrack({ pts: [[1, 2]], km: 1 })).toBe(false);
	});
	it('measures distance (0.009 deg lat is about 1 km each)', () => {
		const t = buildTrack(parseGpx(gpx).pts)!;
		expect(t.km).toBeGreaterThan(1.95);
		expect(t.km).toBeLessThan(2.05);
		expect(isTrack(t)).toBe(true);
	});
	it('counts a real climb but not noise', () => {
		const flat: RawPoint[] = Array.from({ length: 40 }, (_, i) => [7, 45 + i * 0.0005, 100 + (i % 2)]);
		expect(buildTrack(flat)!.gain).toBe(0);
		const hill: RawPoint[] = Array.from({ length: 40 }, (_, i) => [7, 45 + i * 0.0005, 100 + i * 2]);
		expect(buildTrack(hill)!.gain).toBeGreaterThan(60);
		expect(buildTrack(hill)!.loss).toBe(0);
	});
	it('finds a spot by km, clamped to the route', () => {
		const t = buildTrack(parseGpx(gpx).pts)!;
		const mid = spotAt(t, t.km / 2);
		expect(mid.lat).toBeGreaterThan(45.008);
		expect(mid.lat).toBeLessThan(45.01);
		expect(spotAt(t, 999).km).toBe(t.km);
		expect(spotAt(t, -5).km).toBe(0);
	});
	it('decimates keeping first and last', () => {
		const d = decimate(Array.from({ length: 100 }, (_, i) => i), 10);
		expect(d).toHaveLength(10);
		expect(d[0]).toBe(0);
		expect(d[9]).toBe(99);
	});
});
