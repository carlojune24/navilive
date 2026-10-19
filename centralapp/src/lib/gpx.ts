// GPX route handling, pure so it is unit-tested and runs in the browser (upload) and on the server (store).

export type RawPoint = [lon: number, lat: number, ele: number];
/** lon, lat, smoothed elevation (m), km from start, cumulative gain (m), cumulative loss (m) */
export type TrackPoint = [number, number, number, number, number, number];
export type Track = { pts: TrackPoint[]; km: number; gain: number; loss: number; min: number; max: number };

const MAX_STORED = 1500;
export const MAX_UPLOAD_POINTS = 6000; // keeps the upload under the 512 KB request limit
const GAIN_STEP = 3; // m: elevation wiggles smaller than this are GPS noise, not climbing

/** Track points of a GPX file (falls back to route points), plus the route's name. */
export function parseGpx(xml: string): { name: string; pts: RawPoint[] } {
	const grab = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g'))];
	const attr = (s: string | undefined, key: string) => {
		const m = s?.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`));
		return m ? Number(m[1]) : NaN;
	};
	const pts: RawPoint[] = [];
	const trk = grab('trkpt');
	for (const m of trk.length ? trk : grab('rtept')) {
		const lat = attr(m[1], 'lat');
		const lon = attr(m[1], 'lon');
		const e = m[2]?.match(/<ele>\s*([^<\s]+)\s*<\/ele>/);
		if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push([lon, lat, e ? Number(e[1]) : NaN]);
	}
	const name = xml.match(/<(?:trk|rte)\b[^>]*>[\s\S]*?<name>\s*(?:<!\[CDATA\[)?([^<\]]*)/)?.[1]?.trim() || '';
	return { name, pts };
}

/** Every n-th point (always keeping the last), so a big file fits in one request. shortcut: index step, not distance step; fine for GPS tracks. */
export function decimate<T>(pts: T[], max: number): T[] {
	if (pts.length <= max) return pts;
	const step = (pts.length - 1) / (max - 1);
	return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
}

const rad = Math.PI / 180;
export function haversineKm(a: [number, number], b: [number, number]) {
	const dLat = (b[1] - a[1]) * rad;
	const dLon = (b[0] - a[0]) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
	return 12742 * Math.asin(Math.sqrt(h));
}

/** Distance, smoothed elevation and cumulative gain/loss for raw points; null when there is no usable route. */
export function buildTrack(raw: RawPoint[]): Track | null {
	// drop points with bad numbers and repeats (a paused watch)
	const ok = raw.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180);
	const clean = ok.filter((p, i) => i === 0 || p[0] !== ok[i - 1][0] || p[1] !== ok[i - 1][1]);
	if (clean.length < 2) return null;
	// fill missing elevation from the last known one; no elevation at all => flat 0
	let last = clean.find((p) => Number.isFinite(p[2]))?.[2] ?? 0;
	const ele = clean.map((p) => (Number.isFinite(p[2]) ? (last = p[2]) : last));
	// 5-point moving average removes GPS spikes without flattening real climbs
	const smooth = ele.map((_, i) => {
		const w = ele.slice(Math.max(0, i - 2), i + 3);
		return w.reduce((s, v) => s + v, 0) / w.length;
	});
	const all: TrackPoint[] = [];
	let km = 0;
	let gain = 0;
	let loss = 0;
	let ref = smooth[0]; // hysteresis: a climb or drop only counts once it passes GAIN_STEP from the last counted level
	clean.forEach((p, i) => {
		if (i) km += haversineKm([clean[i - 1][0], clean[i - 1][1]], [p[0], p[1]]);
		if (smooth[i] - ref >= GAIN_STEP) (gain += smooth[i] - ref), (ref = smooth[i]);
		else if (ref - smooth[i] >= GAIN_STEP) (loss += ref - smooth[i]), (ref = smooth[i]);
		all.push([p[0], p[1], smooth[i], km, gain, loss]);
	});
	if (km <= 0) return null;
	const pts = decimate(all, MAX_STORED).map((p): TrackPoint => [+p[0].toFixed(6), +p[1].toFixed(6), +p[2].toFixed(1), +p[3].toFixed(4), +p[4].toFixed(1), +p[5].toFixed(1)]);
	return { pts, km: all[all.length - 1][3], gain, loss, min: Math.min(...smooth), max: Math.max(...smooth) };
}

/** Index of the last point at or before km. */
function indexAt(t: Track, km: number) {
	let lo = 0;
	let hi = t.pts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		t.pts[mid][3] <= km ? (lo = mid) : (hi = mid - 1);
	}
	return lo;
}

export type Spot = { km: number; lon: number; lat: number; ele: number; gain: number; loss: number; bearing: number };

/** Position, altitude and gain/loss so far at a distance along the route (clamped to the route). */
export function spotAt(t: Track, kmIn: number): Spot {
	const km = Math.min(Math.max(kmIn, 0), t.km);
	const i = Math.min(indexAt(t, km), t.pts.length - 2);
	const a = t.pts[i];
	const b = t.pts[i + 1];
	const f = b[3] > a[3] ? (km - a[3]) / (b[3] - a[3]) : 0;
	const mix = (k: number) => a[k] + (b[k] - a[k]) * f;
	const bearing = (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * rad), b[1] - a[1]) / rad + 360) % 360;
	return { km, lon: mix(0), lat: mix(1), ele: mix(2), gain: mix(4), loss: mix(5), bearing };
}

/** Grade (%) over each stored segment, for colouring the climbs. */
export const grades = (t: Track) => t.pts.slice(1).map((b, i) => ((b[2] - t.pts[i][2]) / Math.max((b[3] - t.pts[i][3]) * 1000, 1)) * 100);

/** Colour for a grade: green flat, amber to red climbing, blue descending. */
export function gradeColor(g: number) {
	const a = Math.abs(g);
	if (g < -3) return a > 8 ? '#2d7dff' : '#4fc3ff';
	if (a < 3) return '#3ddc84';
	if (a < 6) return '#ffd21f';
	if (a < 10) return '#ff8a1f';
	return '#ff2e3d';
}

/** n+1 colour stops (position 0..1 along the route) for painting the route or profile by steepness. */
export function gradeStops(t: Track, n = 100) {
	const g = grades(t);
	return Array.from({ length: n + 1 }, (_, i) => {
		const km = (i / n) * t.km;
		const k = Math.min(g.length - 1, Math.max(0, t.pts.findIndex((p) => p[3] >= km) - 1));
		return { at: i / n, color: gradeColor(g[k] ?? 0) };
	});
}

/** Shape check for a stored route (from the database or an upload): rejects anything the map could choke on. */
export function isTrack(v: unknown): v is Track {
	const t = v as Track | null;
	return !!t && Array.isArray(t.pts) && t.pts.length >= 2 && t.pts.length <= 5000 && t.pts.every((p) => Array.isArray(p) && p.length === 6 && p.every(Number.isFinite)) && Number.isFinite(t.km) && t.km > 0;
}
