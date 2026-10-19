// shortcut: in-memory per-process counter, resets on restart; fine for one admin on one server, use a shared store if this ever scales out
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, { n: number; first: number }>();

/** Minutes left on the block for this address, or 0 if it may try. */
export function blockedMinutes(ip: string, now = Date.now()) {
	const f = fails.get(ip);
	if (!f || now - f.first > WINDOW_MS) return 0;
	return f.n >= MAX_FAILS ? Math.ceil((f.first + WINDOW_MS - now) / 60_000) : 0;
}

export function recordFail(ip: string, now = Date.now()) {
	const f = fails.get(ip);
	if (!f || now - f.first > WINDOW_MS) fails.set(ip, { n: 1, first: now });
	else f.n++;
	if (fails.size > 5000) for (const [k, v] of fails) if (now - v.first > WINDOW_MS) fails.delete(k);
}

export const clearFails = (ip: string) => fails.delete(ip);
