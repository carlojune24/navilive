/** "12s ago", "3 min ago", "2 h ago". `ms` is an epoch time; null means never. */
export function ago(ms: number | null | undefined, now: number) {
	if (ms === null || ms === undefined) return 'never';
	const s = Math.max(0, Math.floor((now - Number(ms)) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}

/** Elapsed time as HH:MM:SS, so a marshal can check a wave against the gun. */
export function hms(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * Race-day wall clock, always Philippine time. A marshal's phone left on another timezone (or on a
 * cheap handset with no network time) would otherwise show a time that does not match the organizer.
 */
export const phTime = (ms: number) => new Date(ms).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour12: true });

/** The local calendar day (YYYY-MM-DD) of a moment, in this browser's timezone. */
export const localDay = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** A finish typed as a day and a time of day (local). A finish cannot be before the start, so a time that lands at or
 *  before the start on that day moves to the next day: a 10:56 PM start and a 12:00 AM finish is the night after. */
export function finishAt(day: string, at: string, start: number | null): number {
	let ms = new Date(`${day}T${at.length === 5 ? at + ':00' : at}`).getTime();
	if (!Number.isFinite(ms)) return NaN;
	for (let i = 0; start !== null && ms <= start && i < 3; i++) ms += 86_400_000;
	return ms;
}
