// Sponsor links are shown on the public board, so only plain web addresses are allowed.
/** '' for empty, the normalised address for http(s), null for anything else (javascript:, mailto:, garbage). */
export function cleanUrl(raw: string): string | null {
	const s = raw.trim();
	if (!s) return '';
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
	} catch {
		return null;
	}
}
