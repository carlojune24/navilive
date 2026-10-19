import { describe, expect, it } from 'vitest';
import { buildAwards, type Row } from './results';
import { DEFAULT_BRACKETS, DEFAULT_CONFIG, parseBrackets, parseConfig, resolveOptions, type AwardConfig, type CategoryOptions } from './awardcfg';

const mk = (bib: string, time: number, gender: string, age: number | null, extra: Record<string, string> = {}): Row => ({
	rank: null,
	bib,
	name: 'N' + bib,
	time,
	finishAt: time,
	splits: [],
	gender,
	age,
	extra,
	photo: null
});
// already ranked by time: 1 (M25), 2 (F25), 3 (M35), 4 (F35), 5 (M35), 6 (F28)
const field = [mk('1', 100, 'M', 25), mk('2', 110, 'F', 25), mk('3', 120, 'M', 35), mk('4', 130, 'F', 35), mk('5', 140, 'M', 35), mk('6', 150, 'F', 28)];
const bibs = (a: ReturnType<typeof buildAwards>, key: string) => a.find((x) => x.key === key)?.winners.map((w) => w.bib);
const def = { places: 3, brackets: '18-29,30-39', exclusive: false };
const opts = (cfg: Partial<AwardConfig> = {}, d = def): CategoryOptions => resolveOptions(d, { ...DEFAULT_CONFIG, ...cfg }, 7);
const withCat = (c: AwardConfig['categories'][string]): AwardConfig => ({ ...DEFAULT_CONFIG, categories: { '7': c } });

describe('parseBrackets', () => {
	it('parses ranges and open-ended, rejects junk', () => {
		expect(parseBrackets('18-29, 30-39, 60+')!.map((b) => [b.label, b.min, b.max])).toEqual([['18-29', 18, 29], ['30-39', 30, 39], ['60+', 60, 200]]);
		expect(parseBrackets('abc')).toBeNull();
		expect(parseBrackets('40-30')).toBeNull();
		expect(parseBrackets('')).toEqual([]);
	});
});

describe('standard awards (nothing configured = today)', () => {
	it('ranks overall, gender and age groups within the category', () => {
		const a = buildAwards(field, opts());
		expect(bibs(a, 'overall')).toEqual(['1', '2', '3']);
		expect(bibs(a, 'M')).toEqual(['1', '3', '5']);
		expect(bibs(a, 'F')).toEqual(['2', '4', '6']);
		expect(bibs(a, 'M:30-39')).toEqual(['3', '5']);
		expect(bibs(a, 'F:18-29')).toEqual(['2', '6']);
	});
	it('a single-gender category has no separate gender award, unless asked for', () => {
		const women = [mk('1', 100, 'F', 25), mk('2', 110, 'F', 26)];
		expect(buildAwards(women, opts()).map((x) => x.name)).toEqual(['Overall', 'Women 18-29']);
		expect(buildAwards(women, opts({ showSingleGender: true })).map((x) => x.name)).toEqual(['Overall', 'Women', 'Women 18-29']);
	});
	it('no gender data: age groups are plain brackets; a runner without age gets no age award', () => {
		expect(buildAwards([mk('1', 100, '', 25), mk('2', 110, '', null)], opts()).map((x) => x.name)).toEqual(['Overall', '18-29']);
	});
	it('exclusive: the overall podium is skipped in age groups', () => {
		const a = buildAwards(field, opts({}, { ...def, exclusive: true }));
		expect(bibs(a, 'M:18-29')).toBeUndefined();
		expect(bibs(a, 'F:30-39')).toEqual(['4']);
		expect(bibs(a, 'F:18-29')).toEqual(['6']);
	});
	it('fewer finishers than places gives fewer winners; none gives no awards', () => {
		expect(bibs(buildAwards([mk('1', 100, 'M', 25)], opts()), 'overall')).toEqual(['1']);
		expect(buildAwards([], opts())).toEqual([]);
	});
});

describe('per-category choices', () => {
	it('unticked awards disappear', () => {
		const a = buildAwards(field, opts({ categories: withCat({ overall: false, women: false }).categories }));
		expect(a.some((x) => x.key === 'overall' || x.key === 'F')).toBe(false);
		expect(bibs(a, 'M')).toEqual(['1', '3', '5']);
	});
	it('places can differ per category', () => {
		expect(bibs(buildAwards(field, opts({ categories: withCat({ places: 5 }).categories })), 'overall')).toEqual(['1', '2', '3', '4', '5']);
	});
	it('age groups off removes them all; own brackets replace the defaults', () => {
		expect(buildAwards(field, opts({ categories: withCat({ ageGroups: false }).categories })).map((x) => x.key)).toEqual(['overall', 'M', 'F']);
		const a = buildAwards(field, opts({ categories: withCat({ brackets: [{ min: 30, max: null, men: true, women: false }] }).categories }));
		expect(a.map((x) => x.name)).toEqual(['Overall', 'Men', 'Women', 'Men 30+']);
		expect(bibs(a, 'M:30+')).toEqual(['3', '5']);
	});
	it('a bracket can award everyone regardless of gender', () => {
		const a = buildAwards(field, opts({ categories: withCat({ brackets: [{ min: 30, max: null, men: false, women: false, all: true }] }).categories }));
		expect(bibs(a, 'A:30+')).toEqual(['3', '4', '5']);
	});
});

describe('special and custom awards', () => {
	it('youngest and oldest finisher, ties go to the faster runner', () => {
		const a = buildAwards(field, opts({ categories: withCat({ youngest: true, oldest: true }).categories }));
		expect(a.find((x) => x.key === 'youngest')!.winners[0]).toMatchObject({ bib: '1', detail: 'age 25' });
		expect(a.find((x) => x.key === 'oldest')!.winners[0]).toMatchObject({ bib: '3', detail: 'age 35' });
	});
	it('custom award filters on gender, age and an extra field, with its own places', () => {
		const rows = [mk('1', 100, 'M', 25, { team: 'Runners Club' }), mk('2', 110, 'F', 30, { team: 'runners club' }), mk('3', 120, 'F', 40, { team: 'Other' }), mk('4', 130, 'F', 33, { team: 'Runners Club' })];
		const customs = [
			{ id: 'club', name: 'Best club runner', gender: '' as const, ageMin: null, ageMax: null, field: 'team', value: 'Runners Club', places: 2, categoryIds: [] },
			{ id: 'w30', name: 'Women 30-39 club', gender: 'F' as const, ageMin: 30, ageMax: 39, field: 'team', value: 'runners club', places: 3, categoryIds: [7] },
			{ id: 'other', name: 'Not here', gender: '' as const, ageMin: null, ageMax: null, field: '', value: '', places: 1, categoryIds: [99] }
		];
		const a = buildAwards(rows, opts({ customs }));
		expect(bibs(a, 'custom:club')).toEqual(['1', '2']);
		expect(bibs(a, 'custom:w30')).toEqual(['2', '4']);
		expect(a.some((x) => x.key === 'custom:other')).toBe(false); // scoped to another category
	});
	it('a custom award nobody qualifies for is not shown', () => {
		const customs = [{ id: 'x', name: 'Seniors', gender: '' as const, ageMin: 60, ageMax: null, field: '', value: '', places: 1, categoryIds: [] }];
		expect(buildAwards(field, opts({ customs })).some((x) => x.key === 'custom:x')).toBe(false);
	});
});

describe('parseConfig', () => {
	it('accepts a good config and sorts brackets', () => {
		const { cfg, errors } = parseConfig({ reveal: false, categories: { '7': { places: '5', brackets: [{ min: 30, max: null }, { min: 18, max: 29, women: false }] } }, customs: [{ name: 'Club', field: 'team', value: 'X', places: 2 }] });
		expect(errors).toEqual([]);
		expect(cfg.reveal).toBe(false);
		expect(cfg.categories['7'].places).toBe(5);
		expect(cfg.categories['7'].brackets!.map((b) => b.min)).toEqual([18, 30]);
		expect(cfg.categories['7'].brackets![0].women).toBe(false);
		expect(cfg.customs[0]).toMatchObject({ name: 'Club', field: 'team', value: 'X', places: 2, gender: '', categoryIds: [] });
	});
	it('reports bad values instead of storing them', () => {
		expect(parseConfig({ categories: { '7': { places: 99 } } }).errors).toHaveLength(1);
		expect(parseConfig({ categories: { '7': { brackets: [{ min: 40, max: 30 }] } } }).errors[0]).toMatch(/ends before/);
		expect(parseConfig({ customs: [{ name: '', places: 1 }] }).errors[0]).toMatch(/name/);
		expect(parseConfig({ customs: [{ name: 'A', field: 'team', value: '' }] }).errors[0]).toMatch(/pick a value/);
		expect(parseConfig({ customs: [{ name: 'A', ageMin: 50, ageMax: 40 }] }).errors[0]).toMatch(/below/);
	});
	it('garbage in gives the defaults', () => {
		expect(parseConfig(null).cfg).toMatchObject({ reveal: true, showSingleGender: false, categories: {}, customs: [] });
		expect(parseConfig('nope').errors).toEqual([]);
	});
});

describe('resolveOptions', () => {
	it('uses the event defaults when a category has no settings', () => {
		const o = resolveOptions({ places: 4, brackets: DEFAULT_BRACKETS, exclusive: true }, DEFAULT_CONFIG, 1);
		expect(o).toMatchObject({ places: 4, overall: true, men: true, women: true, exclusive: true, youngest: false });
		expect(o.groups.map((g) => g.label)).toEqual(['18-29', '30-39', '40-49', '50-59', '60+']);
	});
});
