import { describe, expect, it } from 'vitest';
import { DEFAULT_BRACKETS, DEFAULT_CONFIG, type AwardConfig } from './awardcfg';
import { headcount, type Entry } from './headcount';

const def = { places: 3, brackets: DEFAULT_BRACKETS, exclusive: false };
const cats = [{ id: 1, name: 'SOLO' }, { id: 2, name: 'DUO' }];
const solo = (gender: string, age: number | null, category_id = 1): Entry => ({ category_id, gender, age });
const duo = (a: [string, number], b: [string, number]): Entry => ({ category_id: 2, gender: '', age: null, members: [{ id: 1, name: 'a', gender: a[0], age: a[1] }, { id: 2, name: 'b', gender: b[0], age: b[1] }] });
const get = (h: ReturnType<typeof headcount>, cat: string, key: string) => h.categories.find((c) => c.name === cat)!.rows.find((r) => r.key === key)!.counts;

describe('headcount', () => {
	it('counts solo runners by gender and age group, and flags missing data', () => {
		const h = headcount([solo('M', 25), solo('M', 35), solo('F', 25), solo('', 40), solo('F', null)], cats, def, DEFAULT_CONFIG);
		const m = get(h, 'SOLO', 'M');
		expect(m.total).toBe(2);
		expect(m.groups).toEqual([1, 1, 0, 0, 0]); // 18-29, 30-39, 40-49, 50-59, 60+
		expect(get(h, 'SOLO', 'F')).toMatchObject({ total: 2, noAge: 1 });
		expect(get(h, 'SOLO', '').total).toBe(1);
		expect(h.categories[0].all.total).toBe(5);
	});
	it('a team is one entry: mixed if both genders, age is the members average', () => {
		const h = headcount([duo(['M', 30], ['F', 40]), duo(['M', 20], ['M', 25]), duo(['F', 50], ['F', 60])], cats, def, DEFAULT_CONFIG);
		const c = h.categories.find((x) => x.name === 'DUO')!;
		expect(c.entries).toBe(3);
		expect(c.runners).toBe(6);
		expect(get(h, 'DUO', 'X').groups).toEqual([0, 1, 0, 0, 0]); // average 35 -> 30-39
		expect(get(h, 'DUO', 'M').total).toBe(1);
		expect(get(h, 'DUO', 'F').groups).toEqual([0, 0, 0, 1, 0]); // average 55
		expect(h.entries).toBe(3);
		expect(h.byGender).toEqual({ M: 1, F: 1, X: 1, '': 0 });
	});
	it('uses the category brackets, none when age groups are off, and a block for entries with no category', () => {
		const cfg: AwardConfig = { ...DEFAULT_CONFIG, categories: { '1': { brackets: [{ min: 0, max: null, men: true, women: true }] }, '2': { ageGroups: false } } };
		const h = headcount([solo('M', 70), solo('F', 10, 2), solo('M', 30, null as unknown as number)], cats, def, cfg);
		expect(h.categories[0].groups.map((g) => g.label)).toEqual(['0+']);
		expect(get(h, 'SOLO', 'M').groups).toEqual([1]);
		expect(h.categories[1].groups).toEqual([]);
		expect(h.categories.at(-1)).toMatchObject({ name: 'No category', entries: 1 });
	});
	it('names who is missing a gender or age, per member for a team', () => {
		const named = (e: Entry, bib: string, name: string): Entry => ({ ...e, bib, name });
		const h = headcount(
			[
				named(solo('M', 30), '1', 'COMPLETE'),
				named(solo('', 30), '2', 'NO GENDER'),
				named(solo('F', null), '3', 'NO AGE'),
				named(solo('', null), '4', 'NEITHER'),
				// the team counts as Men (the unknown member is skipped), but that member must be listed
				named({ category_id: 2, gender: '', age: null, members: [{ id: 1, name: 'A', gender: 'M', age: 30 }, { id: 2, name: 'B', gender: '', age: 31 }] }, 'D1', 'TEAM')
			],
			cats,
			def,
			DEFAULT_CONFIG
		);
		expect(h.missing.map((m) => [m.bib, m.member, m.gender, m.age])).toEqual([['2', undefined, true, false], ['3', undefined, false, true], ['4', undefined, true, true], ['D1', 'B', true, false]]);
		expect(h.missing[3]).toMatchObject({ category: 'DUO', name: 'TEAM' });
		expect(headcount([solo('M', 30)], cats, def, DEFAULT_CONFIG).missing).toEqual([]);
	});
	it('no one registered', () => {
		expect(headcount([], cats, def, DEFAULT_CONFIG)).toMatchObject({ entries: 0, runners: 0 });
	});
});
