// Headcount printable: how many men, women, mixed and per age group, counted the way the awards count them. Pure, so it is unit-tested.
import { resolveOptions, type AwardConfig, type Group } from './awardcfg';
import { teamAge, teamGender, type P } from './results';
import { countRunners } from './runners';

export type Entry = Pick<P, 'category_id' | 'gender' | 'age' | 'members'>;
export type GenderKey = 'M' | 'F' | 'X' | '';
export const GENDER_KEYS: { key: GenderKey; label: string }[] = [
	{ key: 'M', label: 'Men' },
	{ key: 'F', label: 'Women' },
	{ key: 'X', label: 'Mixed' },
	{ key: '', label: 'No gender' }
];

/** `groups[i]` is the count in the category's i-th age group (overlapping custom groups count an entry in each); `noAge` has no age to place. */
export type Counts = { groups: number[]; noAge: number; total: number };
export type CategoryCount = { id: number | null; name: string; entries: number; runners: number; groups: Group[]; rows: { key: GenderKey; label: string; counts: Counts }[]; all: Counts };
export type Headcount = { categories: CategoryCount[]; entries: number; runners: number; byGender: Record<GenderKey, number>; noAge: number };

const empty = (n: number): Counts => ({ groups: Array(n).fill(0), noAge: 0, total: 0 });
const genderOf = (p: Entry): GenderKey => {
	const g = teamGender(p);
	return g === 'M' || g === 'F' || g === 'X' ? g : '';
};

/** Counts per category (and a "No category" block when someone has none). An entry is a solo runner or a whole team, as in the awards. */
export function headcount(participants: Entry[], categories: { id: number; name: string }[], defaults: { places: number; brackets: string; exclusive: boolean }, cfg: AwardConfig): Headcount {
	const blocks: { id: number | null; name: string }[] = [...categories];
	if (participants.some((p) => p.category_id === null || !categories.some((c) => c.id === p.category_id))) blocks.push({ id: null, name: 'No category' });
	const out: CategoryCount[] = blocks.map((c) => {
		const mine = participants.filter((p) => (c.id === null ? !categories.some((k) => k.id === p.category_id) : p.category_id === c.id));
		const groups = resolveOptions(defaults, cfg, c.id ?? 0).groups;
		const rows = GENDER_KEYS.map((g) => ({ ...g, counts: empty(groups.length) }));
		const all = empty(groups.length);
		for (const p of mine) {
			const age = teamAge(p);
			const row = rows.find((r) => r.key === genderOf(p))!.counts;
			for (const t of [row, all]) {
				t.total++;
				if (age === null) t.noAge++;
				else groups.forEach((g, i) => { if (age >= g.min && age <= g.max) t.groups[i]++; });
			}
		}
		return { id: c.id, name: c.name, entries: mine.length, runners: countRunners(mine), groups, rows, all };
	});
	const byGender = { M: 0, F: 0, X: 0, '': 0 } as Record<GenderKey, number>;
	for (const c of out) for (const r of c.rows) byGender[r.key] += r.counts.total;
	return { categories: out, entries: out.reduce((n, c) => n + c.entries, 0), runners: out.reduce((n, c) => n + c.runners, 0), byGender, noAge: out.reduce((n, c) => n + c.all.noAge, 0) };
}
