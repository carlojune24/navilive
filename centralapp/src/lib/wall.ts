// Finish-time wall: where the time sits on a category backdrop. Percentages of the image, so it lands the same on any screen.
export type Layout = { x: number; y: number; size: number; color: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validates the organizer's layout form; null when anything is missing or not a number. */
export function parseLayout(f: { get(k: string): unknown }): Layout | null {
	const [x, y, size] = ['x', 'y', 'size'].map((k) => Number(f.get(k)));
	const color = String(f.get('color') ?? '').toLowerCase();
	if (![x, y, size].every(Number.isFinite) || !/^#[0-9a-f]{6}$/.test(color)) return null;
	return { x: clamp(x, 0, 100), y: clamp(y, 0, 100), size: clamp(size, 2, 40), color };
}
