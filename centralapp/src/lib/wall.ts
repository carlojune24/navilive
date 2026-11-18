// Finish-time wall: where the time sits on a category backdrop. Percentages of the image, so it lands the same on any screen.
export type Layout = { x: number; y: number; size: number; color: string };

export type Backdrop = { category_id: number; x: number; y: number; size: number; color: string; name_x: number; name_y: number; name_size: number; name_color: string; v: number };

// two texts on the backdrop: the finish time and the name (team name for a team, runner name for a solo)
export type Item = 'time' | 'name';
export const ITEMS = [['time', 'Time'], ['name', 'Name']] as const;
const DEFAULT: Record<Item, Layout> = { time: { x: 50, y: 30, size: 12, color: '#ffffff' }, name: { x: 50, y: 60, size: 5, color: '#ffffff' } };

/** The saved positions of a backdrop's time and name (defaults when there is no backdrop yet). */
export function layoutOf(b: Backdrop | undefined): Record<Item, Layout> {
	if (!b) return structuredClone(DEFAULT);
	return { time: { x: b.x, y: b.y, size: b.size, color: b.color }, name: { x: b.name_x, y: b.name_y, size: b.name_size, color: b.name_color } };
}

const clamp =(v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validates the organizer's layout form (fields named with `prefix`, e.g. 'name_'); null when anything is missing or not a number. */
export function parseLayout(f: { get(k: string): unknown }, prefix = ''): Layout | null {
	const [x, y, size] = ['x', 'y', 'size'].map((k) => Number(f.get(prefix + k) ?? NaN));
	const color = String(f.get(prefix + 'color') ?? '').toLowerCase();
	if (![x, y, size].every(Number.isFinite) || !/^#[0-9a-f]{6}$/.test(color)) return null;
	return { x: clamp(x, 0, 100), y: clamp(y, 0, 100), size: clamp(size, 2, 40), color };
}
