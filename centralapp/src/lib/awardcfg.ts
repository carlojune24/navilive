// What the organizer ticks on the Awards page, and how it turns into the rules for one category. Pure, so it is unit-tested.

export const DEFAULT_BRACKETS = '18-29,30-39,40-49,50-59,60+';

export type Bracket = { label: string; min: number; max: number };

/** "18-29, 30-39, 60+" -> brackets. Returns null if any piece is not N-M or N+. */
export function parseBrackets(text: string): Bracket[] | null {
	const out: Bracket[] = [];
	for (const raw of text.split(/[,;\n]+/)) {
		const t = raw.trim();
		if (!t) continue;
		const range = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
		const open = /^(\d{1,3})\s*\+$/.exec(t);
		if (range && Number(range[1]) <= Number(range[2])) out.push({ label: `${range[1]}-${range[2]}`, min: Number(range[1]), max: Number(range[2]) });
		else if (open) out.push({ label: `${open[1]}+`, min: Number(open[1]), max: 200 });
		else return null;
	}
	return out;
}

/** One age bracket an organizer typed in. max null = "and over". `all` = also an award for everyone in the bracket regardless of gender. */
export type BracketCfg = { min: number; max: number | null; men: boolean; women: boolean; all?: boolean };

export type CatAwardCfg = {
	places?: number | null; // null/undefined = the event default
	overall?: boolean;
	men?: boolean;
	women?: boolean;
	ageGroups?: boolean;
	brackets?: BracketCfg[] | null; // null/undefined = the event's default brackets, men and women
	youngest?: boolean;
	oldest?: boolean;
};

export type CustomAward = {
	id: string;
	name: string;
	gender: '' | 'M' | 'F';
	ageMin: number | null;
	ageMax: number | null;
	field: string; // a column from the CSV kept as extra data, e.g. "team"
	value: string;
	places: number;
	categoryIds: number[]; // empty = every category
};

export type AwardConfig = {
	reveal: boolean; // false = awards stay hidden on the public board until the organizer reveals them
	showSingleGender: boolean;
	categories: Record<string, CatAwardCfg>;
	customs: CustomAward[];
};

export const DEFAULT_CONFIG: AwardConfig = { reveal: true, showSingleGender: false, categories: {}, customs: [] };

export type EventAwardDefaults = { places: number; brackets: string; exclusive: boolean };

export type Group = { label: string; min: number; max: number; men: boolean; women: boolean; all?: boolean };

export type CategoryOptions = {
	places: number;
	overall: boolean;
	men: boolean;
	women: boolean;
	groups: Group[];
	youngest: boolean;
	oldest: boolean;
	exclusive: boolean;
	showSingleGender: boolean;
	customs: CustomAward[];
};

const labelOf = (min: number, max: number | null) => (max === null ? `${min}+` : `${min}-${max}`);

/** Everything the board needs for one category. Nothing configured = today's behaviour (all standard awards on). */
export function resolveOptions(def: EventAwardDefaults, cfg: AwardConfig, catId: number): CategoryOptions {
	const c = cfg.categories[String(catId)] ?? {};
	const defaults: BracketCfg[] = (parseBrackets(def.brackets) ?? []).map((b) => ({ min: b.min, max: b.max >= 200 ? null : b.max, men: true, women: true }));
	const brackets = c.ageGroups === false ? [] : (c.brackets ?? defaults);
	return {
		places: c.places ?? def.places,
		overall: c.overall ?? true,
		men: c.men ?? true,
		women: c.women ?? true,
		groups: brackets.map((b) => ({ label: labelOf(b.min, b.max), min: b.min, max: b.max ?? 200, men: b.men, women: b.women, all: b.all })),
		youngest: c.youngest ?? false,
		oldest: c.oldest ?? false,
		exclusive: def.exclusive,
		showSingleGender: cfg.showSingleGender,
		customs: cfg.customs.filter((x) => x.categoryIds.length === 0 || x.categoryIds.includes(catId))
	};
}

// ---------------------------------------------------------------- reading what the browser sends back

const int = (v: unknown, lo: number, hi: number): number | null => {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
	return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_BRACKETS = 20;
const MAX_CUSTOMS = 30;

/** Tolerant parse for stored/posted JSON. Problems are returned as messages; the config is always usable. */
export function parseConfig(raw: unknown): { cfg: AwardConfig; errors: string[] } {
	const errors: string[] = [];
	const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
	const cfg: AwardConfig = { reveal: flag(src.reveal, true), showSingleGender: flag(src.showSingleGender, false), categories: {}, customs: [] };

	for (const [key, v] of Object.entries(src.categories && typeof src.categories === 'object' ? src.categories : {})) {
		if (!/^\d+$/.test(key) || !v || typeof v !== 'object') continue;
		const c = v as Record<string, any>;
		const out: CatAwardCfg = {};
		if (c.places !== undefined && c.places !== null && c.places !== '') {
			const p = int(c.places, 1, 10);
			if (p === null) errors.push('Places must be a whole number from 1 to 10');
			else out.places = p;
		}
		for (const k of ['overall', 'men', 'women', 'ageGroups', 'youngest', 'oldest'] as const) if (typeof c[k] === 'boolean') out[k] = c[k];
		if (Array.isArray(c.brackets)) {
			const list: BracketCfg[] = [];
			for (const b of c.brackets.slice(0, MAX_BRACKETS)) {
				const min = int(b?.min, 0, 120);
				const max = b?.max === null || b?.max === '' || b?.max === undefined ? null : int(b.max, 0, 120);
				if (min === null || (b?.max !== null && b?.max !== '' && b?.max !== undefined && max === null)) {
					errors.push('Each age bracket needs a starting age (0-120) and an optional ending age');
					continue;
				}
				if (max !== null && max < min) {
					errors.push(`Age bracket ${min}-${max} ends before it starts`);
					continue;
				}
				list.push({ min, max, men: flag(b.men, true), women: flag(b.women, true), ...(typeof b.all === 'boolean' ? { all: b.all } : {}) });
			}
			list.sort((a, b) => a.min - b.min);
			out.brackets = list;
		}
		cfg.categories[key] = out;
	}

	for (const v of Array.isArray(src.customs) ? src.customs.slice(0, MAX_CUSTOMS) : []) {
		if (!v || typeof v !== 'object') continue;
		const name = text(v.name, 60);
		if (!name) {
			errors.push('Every custom award needs a name');
			continue;
		}
		const ageMin = v.ageMin === null || v.ageMin === '' || v.ageMin === undefined ? null : int(v.ageMin, 0, 120);
		const ageMax = v.ageMax === null || v.ageMax === '' || v.ageMax === undefined ? null : int(v.ageMax, 0, 120);
		if ((v.ageMin !== null && v.ageMin !== '' && v.ageMin !== undefined && ageMin === null) || (v.ageMax !== null && v.ageMax !== '' && v.ageMax !== undefined && ageMax === null)) {
			errors.push(`"${name}": ages must be whole numbers from 0 to 120`);
			continue;
		}
		if (ageMin !== null && ageMax !== null && ageMax < ageMin) {
			errors.push(`"${name}": the oldest age is below the youngest`);
			continue;
		}
		const field = text(v.field, 60);
		const value = text(v.value, 60);
		if (field && !value) {
			errors.push(`"${name}": pick a value for ${field}`);
			continue;
		}
		const places = int(v.places ?? 1, 1, 10);
		if (places === null) {
			errors.push(`"${name}": places must be 1 to 10`);
			continue;
		}
		cfg.customs.push({
			id: text(v.id, 40) || `c${cfg.customs.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
			name,
			gender: v.gender === 'M' || v.gender === 'F' ? v.gender : '',
			ageMin,
			ageMax,
			field,
			value,
			places,
			categoryIds: Array.isArray(v.categoryIds) ? v.categoryIds.map((n: unknown) => int(n, 1, 2_000_000_000)).filter((n: number | null): n is number => n !== null) : []
		});
	}
	return { cfg, errors };
}
