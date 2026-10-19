// The "I am alive" message a station laptop sends every few seconds, and how the admin judges a laptop from it. Pure, so unit-tested.

export const BEAT_EVERY_MS = 5_000;
export const ONLINE_MS = 15_000; // up to 3 missed beats is still "online"
export const LATE_MS = 45_000; // after this it is offline

export type BeatStation = { name: string; kind: string; readersTotal: number; readersOnline: number; lastReadMs: number | null; pending: number };
export type Beat = { laptopId: string; laptopName: string; appVersion: string; nowMs: number; pending: number; lastError: string; stations: BeatStation[] };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

/** Strict: anything malformed returns null (the API answers 400). Text is cut to a sane length. */
export function parseHeartbeat(raw: unknown): Beat | null {
	if (!raw || typeof raw !== 'object') return null;
	const b = raw as Record<string, unknown>;
	const laptopId = str(b.laptop_id, 64);
	const nowMs = num(b.now_ms, 1, 4_102_444_800_000);
	if (!laptopId || nowMs === null || !Array.isArray(b.stations) || b.stations.length > 30) return null;
	const stations: BeatStation[] = [];
	for (const s of b.stations) {
		if (!s || typeof s !== 'object') return null;
		const o = s as Record<string, unknown>;
		const name = str(o.name, 80);
		if (!name) return null;
		stations.push({
			name,
			kind: str(o.kind, 20),
			readersTotal: num(o.readers_total, 0, 1000) ?? 0,
			readersOnline: num(o.readers_online, 0, 1000) ?? 0,
			lastReadMs: o.last_read_ms === null || o.last_read_ms === undefined ? null : num(o.last_read_ms, 1, 4_102_444_800_000),
			pending: num(o.pending, 0, 10_000_000) ?? 0
		});
	}
	return {
		laptopId,
		laptopName: str(b.laptop_name, 80) || 'Station laptop',
		appVersion: str(b.app_version, 30),
		nowMs,
		pending: num(b.pending, 0, 10_000_000) ?? 0,
		lastError: str(b.last_error, 300),
		stations
	};
}

export type Link = 'online' | 'late' | 'offline' | 'never';

/** online <15 s since the last beat, late <45 s, otherwise offline. `null` = never heard from. */
export function linkState(lastSeenMs: number | null | undefined, now: number): Link {
	if (lastSeenMs === null || lastSeenMs === undefined) return 'never';
	const age = now - Number(lastSeenMs);
	return age < ONLINE_MS ? 'online' : age < LATE_MS ? 'late' : 'offline';
}

const RANK: Record<Link, number> = { online: 3, late: 2, offline: 1, never: 0 };
/** The best state among several laptops serving the same station. */
export const bestLink = (links: Link[]): Link => links.reduce<Link>((a, b) => (RANK[b] > RANK[a] ? b : a), 'never');

/** Positive skew = the laptop's clock is behind the server. Under 2 s is fine (network delay alone explains it). */
export const clockWarning = (skewMs: number | null | undefined) => skewMs !== null && skewMs !== undefined && Math.abs(Number(skewMs)) > 2000;
