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

/** Excel-safe export writes a tag as ="000123" so zeros survive; the leading = is not part of the tag. Zeros are kept. */
export const cleanTag = (t: string) => t.replace(/^=/, '').replace(/^"|"$/g, '').trim();

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
export function parseCsv(text: string, on = new Date()): { rows: Row[]; errors: string[] } {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return { rows: [], errors: ['Empty file'] };
	const d = [',', ';', '\t'].reduce((best, c) => (lines[0].split(c).length > lines[0].split(best).length ? c : best));
	const head = splitLine(lines[0], d).map((h) => h.toLowerCase());
	const bi = head.indexOf('bib');
	if (bi < 0) return { rows: [], errors: ['Header row needs a "bib" column'] };
	const idx = (n: string) => head.indexOf(n);
	const rows: Row[] = [];
	const errors: string[] = [];
	const split = lines.slice(1).map((l) => splitLine(l, d));
	const count = new Map<string, number>();
	for (const c of split) count.set(c[bi] ?? '', (count.get(c[bi] ?? '') ?? 0) + 1);
	const seen = new Map<string, number>();
	split.forEach((c, i) => {
		const bib0 = c[bi] ?? '';
		if (!bib0) return errors.push(`Line ${i + 2}: empty bib`);
		// a shared bib is kept, not dropped: later runners get "K109-2" and every sharer is flagged so the bibs can be fixed by hand
		const n = (seen.get(bib0) ?? 0) + 1;
		seen.set(bib0, n);
		const shared = count.get(bib0)! > 1;
		const bib = n > 1 ? `${bib0}-${n}` : bib0;
		if (n > 1) errors.push(`Line ${i + 2}: bib ${bib0} is shared, imported as ${bib} and flagged`);
		const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? '') : '');
		const gi = idx('gender') >= 0 ? 'gender' : 'sex';
		const rawGender = get(gi);
		const rawAge = get('age');
		const gender = normGender(rawGender);
		const age = parseAge(rawAge) ?? ageFromDob(get('dob'), on);
		// the row is still imported; a value we cannot read is reported instead of guessed
		if (rawGender && !gender) errors.push(`Line ${i + 2}: gender "${rawGender}" not understood (use M or F), left blank`);
		if (rawAge && age === null) errors.push(`Line ${i + 2}: age "${rawAge}" not understood (use a number), left blank`);
		const extra: Record<string, string> = {};
		head.forEach((h, k) => {
			if (!['bib', 'name', 'first name', 'last name', 'dob', 'category', 'tag', gi, 'age'].includes(h) && h && c[k]) extra[h] = c[k];
		});
		if (shared) extra['bib flag'] = `shared bib ${bib0}, change it`;
		const name = get('name') || `${get('first name')} ${get('last name')}`.replace(/\s+/g, ' ').trim();
		rows.push({ bib, name, category: get('category'), tag: cleanTag(get('tag')), gender, age, extra });
	});
	return { rows, errors };
}

export type TeamMember = { name: string; gender: string; age: number | null; tag: string; extra: Record<string, string> };
export type TeamRow = { bib: string; team: string; category: string; members: TeamMember[] };

/** The client's per-runner listing (First Name, Last Name, Team Name, DOB, ...). Rows with the same category + team name become one team. */
export function isTeamCsv(text: string): boolean {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!/(^|[,;\t])\s*"?team[ _]name"?\s*([,;\t]|$)/i.test(lines[0] ?? '')) return false;
	// a solo sheet also has Team Name (a club) plus Role=Solo; with a Role column it is a team file only if someone is Captain/Teammate
	const d = [',', ';', '\t'].reduce((best, c) => (lines[0].split(c).length > lines[0].split(best).length ? c : best));
	const ri = splitLine(lines[0], d).findIndex((h) => h.toLowerCase() === 'role');
	return ri < 0 || lines.slice(1).some((l) => /^(teammate|captain)$/i.test(splitLine(l, d)[ri] ?? ''));
}

/** Age in whole years on `on` from an ISO date (YYYY-MM-DD); anything else is null. */
export function ageFromDob(dob: string, on = new Date()): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim());
	if (!m) return null;
	let a = on.getFullYear() - Number(m[1]);
	if (on.getMonth() + 1 < Number(m[2]) || (on.getMonth() + 1 === Number(m[2]) && on.getDate() < Number(m[3]))) a--;
	return a >= 1 && a <= 120 ? a : null;
}

export function parseTeamCsv(text: string, on = new Date()): { teams: TeamRow[]; errors: string[] } {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return { teams: [], errors: ['Empty file'] };
	const d = [',', ';', '\t'].reduce((best, c) => (lines[0].split(c).length > lines[0].split(best).length ? c : best));
	const head = splitLine(lines[0], d).map((h) => h.toLowerCase().replace(/_/g, ' ').trim());
	const idx = (...n: string[]) => head.findIndex((h) => n.includes(h));
	const [bi, ti, fi, li, ni, ci, gi, di, ai, tgi] = [idx('bib'), idx('team name'), idx('first name'), idx('last name'), idx('name'), idx('category'), idx('gender', 'sex'), idx('dob', 'date of birth'), idx('age'), idx('tag')];
	if (ti < 0) return { teams: [], errors: ['Header row needs a "Team Name" column'] };
	const used = new Set([bi, ti, fi, li, ni, ci, gi, di, ai, tgi]);
	const teams = new Map<string, TeamRow>();
	const errors: string[] = [];
	const tags = new Set<string>();
	lines.slice(1).forEach((line, i) => {
		const c = splitLine(line, d);
		const at = (k: number) => (k >= 0 ? (c[k] ?? '') : '');
		const team = at(ti).trim();
		const name = (ni >= 0 && at(ni) ? at(ni) : `${at(fi)} ${at(li)}`).replace(/\s+/g, ' ').trim();
		if (!name) return errors.push(`Line ${i + 2}: runner has no name`);
		const category = at(ci).trim();
		const bib = at(bi).trim();
		if (!team && !bib) return errors.push(`Line ${i + 2}: row has neither Team Name nor Bib`);
		// the shared bib identifies a team; two teams may share a name, and a team may have no name
		const key = bib ? `bib|${category.toLowerCase()}|${bib.toLowerCase()}` : `${category.toLowerCase()}|${team.toLowerCase()}`;
		const t = teams.get(key) ?? teams.set(key, { bib, team: team || bib, category, members: [] }).get(key)!;
		if (team && t.team === t.bib) t.team = team;
		const tag = at(tgi).trim();
		if (tag && tags.has(tag.toUpperCase())) return errors.push(`Line ${i + 2}: tag ${tag} is used twice`);
		if (tag) tags.add(tag.toUpperCase());
		if (t.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return errors.push(`Line ${i + 2}: ${name} is listed twice in ${team}`);
		const extra: Record<string, string> = {};
		head.forEach((h, k) => h && !used.has(k) && c[k] && (extra[h] = c[k]));
		t.members.push({ name, gender: normGender(at(gi)), age: parseAge(at(ai)) ?? ageFromDob(at(di), on), tag, extra });
	});
	return { teams: [...teams.values()], errors };
}
