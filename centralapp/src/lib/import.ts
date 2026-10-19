// Pure parsers for the two import modes. No DB here so they are unit-testable.
export const MAX_BIBS = 5000;

/** "101-150, 201, 205" or one per line -> bibs. Ranges of digits only expand; anything else is a literal bib. */
export function parseBibs(text: string): { bibs: string[]; errors: string[] } {
	const bibs: string[] = [];
	const errors: string[] = [];
	for (const raw of text.split(/[\n,;]+/)) {
		const t = raw.trim();
		if (!t) continue;
		const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
		if (m) {
			const [a, b] = [Number(m[1]), Number(m[2])];
			if (b < a || b - a + 1 > MAX_BIBS) {
				errors.push(`Bad range "${t}"`);
				continue;
			}
			const width = m[1].length; // keeps leading zeros: 001-003
			for (let n = a; n <= b; n++) bibs.push(String(n).padStart(width, '0'));
		} else bibs.push(t);
	}
	if (bibs.length > MAX_BIBS) return { bibs: [], errors: [`Too many bibs (max ${MAX_BIBS})`] };
	return { bibs, errors };
}

export type Row = { bib: string; name: string; category: string; tag: string; gender: string; age: number | null; extra: Record<string, string> };

/** m/male/man/men -> 'M', f/female/woman/women -> 'F'; anything else is left blank rather than guessed. */
export function normGender(s: string): string {
	const t = s.trim().toLowerCase();
	return /^(m|male|man|men|boy)$/.test(t) ? 'M' : /^(f|female|woman|women|girl)$/.test(t) ? 'F' : '';
}

/** Whole number 1-120, else null. */
export function parseAge(s: string): number | null {
	const n = /^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : NaN;
	return n >= 1 && n <= 120 ? n : null;
}

export function splitLine(line: string, d: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') (cur += '"', i++);
			else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === d) (out.push(cur), (cur = ''));
		else cur += c;
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

/** CSV with a header row. `bib` is required; name/category/tag optional; other columns kept in extra. */
export function parseCsv(text: string): { rows: Row[]; errors: string[] } {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return { rows: [], errors: ['Empty file'] };
	const d = [',', ';', '\t'].reduce((best, c) => (lines[0].split(c).length > lines[0].split(best).length ? c : best));
	const head = splitLine(lines[0], d).map((h) => h.toLowerCase());
	const bi = head.indexOf('bib');
	if (bi < 0) return { rows: [], errors: ['Header row needs a "bib" column'] };
	const idx = (n: string) => head.indexOf(n);
	const rows: Row[] = [];
	const errors: string[] = [];
	const seen = new Set<string>();
	lines.slice(1).forEach((line, i) => {
		const c = splitLine(line, d);
		const bib = c[bi] ?? '';
		if (!bib) return errors.push(`Line ${i + 2}: empty bib`);
		if (seen.has(bib)) return errors.push(`Line ${i + 2}: duplicate bib ${bib}`);
		seen.add(bib);
		const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? '') : '');
		const gi = idx('gender') >= 0 ? 'gender' : 'sex';
		const rawGender = get(gi);
		const rawAge = get('age');
		const gender = normGender(rawGender);
		const age = parseAge(rawAge);
		// the row is still imported; a value we cannot read is reported instead of guessed
		if (rawGender && !gender) errors.push(`Line ${i + 2}: gender "${rawGender}" not understood (use M or F), left blank`);
		if (rawAge && age === null) errors.push(`Line ${i + 2}: age "${rawAge}" not understood (use a number), left blank`);
		const extra: Record<string, string> = {};
		head.forEach((h, k) => {
			if (!['bib', 'name', 'category', 'tag', gi, 'age'].includes(h) && h && c[k]) extra[h] = c[k];
		});
		rows.push({ bib, name: get('name'), category: get('category'), tag: get('tag'), gender, age, extra });
	});
	return { rows, errors };
}
