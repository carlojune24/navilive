/** "12s ago", "3 min ago", "2 h ago". `ms` is an epoch time; null means never. */
export function ago(ms: number | null | undefined, now: number) {
	if (ms === null || ms === undefined) return 'never';
	const s = Math.max(0, Math.floor((now - Number(ms)) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}
