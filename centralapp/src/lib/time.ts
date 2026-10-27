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
