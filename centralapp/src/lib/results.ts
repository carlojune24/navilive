// Pure ranking logic: no DB, so it is unit-tested. The server feeds it rows.
import { DEFAULT_BRACKETS, DEFAULT_CONFIG, resolveOptions, type CategoryOptions } from './awardcfg';
import { buildProgress, resolveCourse, type CourseStation, type Person, type ProgressRow } from './progress';

export type { CourseStation, ProgressRow } from './progress';

export { DEFAULT_BRACKETS, parseBrackets, type Bracket } from './awardcfg';

export type Mode = 'gun' | 'own';
export type P = {
	id: number;
	bib: string;
	name: string;
	category_id: number | null;
	gender?: string;
	age?: number | null;
	extra?: Record<string, string>;
	photo?: number | null; // when the winner photo was last changed (ms), null = none
};
export type S = { id: number; name: string; kind: string; ord: number };
export type R = { pid: number; station_id: number; read_at_ms: number };
export type Split = { station: string; elapsed: number };
export type Row = {
	rank: number | null;
	bib: string;
	name: string;
	time: number | null;
	finishAt: number | null;
	splits: Split[];
	gender: string;
	age: number | null;
	extra: Record<string, string>;
	photo: number | null;
};
export type Winner = { place: number; bib: string; name: string; time: number; detail?: string; photo?: number | null };
export type Award = { key: string; name: string; winners: Winner[] };
export type Cat = {
	id: number;
	name: string;
	rows: Row[];
	started: number;
	total: number;
	awards: Award[];
	places: number;
	course: CourseStation[]; // the stations this category passes, in order
	progress: ProgressRow[]; // everyone in the category and how far they have got
	gunMs: number | null; // when the category's clock started (null = not started yet)
	gunManual: boolean; // true when the organizer pressed Start on the live board
	underway: boolean; // someone already has a counted checkpoint or finish read, so the clock can no longer be started
};

const DEFAULT_OPTIONS = (catId: number) => resolveOptions({ places: 3, brackets: DEFAULT_BRACKETS, exclusive: false }, DEFAULT_CONFIG, catId);

/** `rows` are the category's finishers, already ranked. Which awards exist is decided by `o` (the organizer's ticks). */
export function buildAwards(rows: Row[], o: CategoryOptions): Award[] {
	const win = (r: Row, place: number, detail?: string): Winner => ({ place, bib: r.bib, name: r.name, time: r.time!, photo: r.photo, ...(detail ? { detail } : {}) });
	const top = (list: Row[], n = o.places): Winner[] => list.slice(0, n).map((r, i) => win(r, i + 1));
	const podium = new Set(rows.slice(0, o.places).map((r) => r.bib));
	const out: Award[] = [];

	if (o.overall && rows.length) out.push({ key: 'overall', name: 'Overall', winners: top(rows) });
	for (const [g, label, on] of [['M', 'Men', o.men], ['F', 'Women', o.women]] as const) {
		if (!on) continue;
		const list = rows.filter((r) => r.gender === g);
		// a single-gender category would just repeat Overall, unless the organizer wants it shown anyway
		if (list.length && (o.showSingleGender || list.length < rows.length)) out.push({ key: g, name: label, winners: top(list) });
	}

	const anyGender = rows.some((r) => r.gender);
	for (const gr of o.groups) {
		const inAge = (r: Row) => r.age !== null && r.age >= gr.min && r.age <= gr.max;
		const add = (key: string, name: string, list: Row[]) => {
			if (o.exclusive) list = list.filter((r) => !podium.has(r.bib)); // overall podium keeps its prize; the age group goes to the next runner
			if (list.length) out.push({ key, name, winners: top(list) });
		};
		if (gr.men) add(`M:${gr.label}`, `Men ${gr.label}`, rows.filter((r) => r.gender === 'M' && inAge(r)));
		if (gr.women) add(`F:${gr.label}`, `Women ${gr.label}`, rows.filter((r) => r.gender === 'F' && inAge(r)));
		// everyone in the bracket: when asked for, or (legacy) when nobody in the category has a gender
		if (gr.all === true || (gr.all === undefined && !anyGender)) add(`A:${gr.label}`, gr.label, rows.filter(inAge));
	}

	const aged = rows.filter((r) => r.age !== null);
	if (o.youngest && aged.length) {
		const r = [...aged].sort((a, b) => a.age! - b.age! || a.time! - b.time!)[0];
		out.push({ key: 'youngest', name: 'Youngest finisher', winners: [win(r, 1, `age ${r.age}`)] });
	}
	if (o.oldest && aged.length) {
		const r = [...aged].sort((a, b) => b.age! - a.age! || a.time! - b.time!)[0];
		out.push({ key: 'oldest', name: 'Oldest finisher', winners: [win(r, 1, `age ${r.age}`)] });
	}

	for (const c of o.customs) {
		const want = c.value.toLowerCase();
		const list = rows.filter(
			(r) =>
				(!c.gender || r.gender === c.gender) &&
				(c.ageMin === null || (r.age !== null && r.age >= c.ageMin)) &&
				(c.ageMax === null || (r.age !== null && r.age <= c.ageMax)) &&
				(!c.field || (r.extra[c.field] ?? '').trim().toLowerCase() === want)
		);
		if (list.length) out.push({ key: `custom:${c.id}`, name: c.name, winners: top(list, c.places) });
	}
	return out;
}

/**
 * gun: everyone in a category is timed from the gun start the organizer set for it (categories.gun_ms), else from the category's first start read.
 * An organizer-set gun start also stands in for a runner with no start read of their own.
 * own: each runner is timed from their own first start read; no start read => unranked.
 * Finish = first finish read after the start; checkpoint splits are first read per station after the start.
 */
export function computeResults(
	cats: { id: number; name: string; gun_ms?: number | null }[],
	ps: P[],
	stations: S[],
	reads: R[],
	mode: Mode,
	optionsFor: (categoryId: number) => CategoryOptions = DEFAULT_OPTIONS,
	/** station ids a category passes, in order; nothing configured = every station (start, checkpoints, finish) */
	courseFor: (categoryId: number) => number[] | null | undefined = () => null
): Cat[] {
	const kind = new Map(stations.map((s) => [s.id, s]));
	const byP = new Map<number, R[]>();
	for (const r of reads) (byP.get(r.pid) ?? byP.set(r.pid, []).get(r.pid)!).push(r);

	const firstStart = (pid: number) => {
		const t = (byP.get(pid) ?? []).filter((r) => kind.get(r.station_id)?.kind === 'start').map((r) => r.read_at_ms);
		return t.length ? Math.min(...t) : null;
	};
	const ownStart = new Map(ps.map((p) => [p.id, firstStart(p.id)]));
	const gun = new Map<number, number>();
	for (const p of ps) {
		const s = ownStart.get(p.id);
		const c = p.category_id ?? 0;
		if (s !== null && s !== undefined && (!gun.has(c) || s < gun.get(c)!)) gun.set(c, s);
	}

	for (const c of cats) if (c.gun_ms !== null && c.gun_ms !== undefined) gun.set(c.id, Number(c.gun_ms)); // set by hand: wins over the reads
	const manual = new Map(cats.filter((c) => c.gun_ms !== null && c.gun_ms !== undefined).map((c) => [c.id, Number(c.gun_ms)]));
	const startOf = (p: P) => ownStart.get(p.id) ?? manual.get(p.category_id ?? 0) ?? null;

	const list = [...cats, ...(ps.some((p) => p.category_id === null) ? [{ id: 0, name: 'No category' }] : [])];
	return list
		.map((cat) => {
			const members = ps.filter((p) => (p.category_id ?? 0) === cat.id);
			const course = resolveCourse(stations, courseFor(cat.id));
			const inCourse = new Set(course.map((s) => s.id));
			const track = new Map<string, Pick<Person, 'start' | 'first'>>(); // per runner, for the progress view
			const rows: Row[] = members.map((p) => {
				const start = mode === 'own' ? startOf(p) : gun.get(cat.id) ?? null;
				const mine = (byP.get(p.id) ?? []).filter((r) => start !== null && r.read_at_ms > start);
				const fin = mine.filter((r) => kind.get(r.station_id)?.kind === 'finish').map((r) => r.read_at_ms);
				const finishAt = fin.length ? Math.min(...fin) : null;
				// first valid read per station: the start station's own read counts, everything else must come after the start
				const first = new Map<number, number>();
				for (const r of byP.get(p.id) ?? []) {
					if (kind.get(r.station_id)?.kind !== 'start' && start !== null && r.read_at_ms <= start) continue;
					first.set(r.station_id, Math.min(first.get(r.station_id) ?? Infinity, r.read_at_ms));
				}
				track.set(p.bib, { start, first });
				const seen = new Map<number, number>();
				for (const r of mine)
					if (kind.get(r.station_id)?.kind === 'checkpoint' && inCourse.has(r.station_id)) seen.set(r.station_id, Math.min(seen.get(r.station_id) ?? Infinity, r.read_at_ms));
				const splits = [...seen]
					.map(([id, at]) => ({ station: kind.get(id)!.name, ord: kind.get(id)!.ord, elapsed: at - start! }))
					.sort((a, b) => a.ord - b.ord)
					.map(({ station, elapsed }) => ({ station, elapsed }));
				return {
					rank: null,
					bib: p.bib,
					name: p.name,
					time: finishAt !== null ? finishAt - start! : null,
					finishAt,
					splits,
					gender: p.gender ?? '',
					age: p.age ?? null,
					extra: p.extra ?? {},
					photo: p.photo ?? null
				};
			});
			const done = rows.filter((r) => r.time !== null).sort((a, b) => a.time! - b.time! || a.bib.localeCompare(b.bib, undefined, { numeric: true }));
			done.forEach((r, i) => (r.rank = i + 1));
			const started = members.filter((p) => startOf(p) !== null).length;
			const o = optionsFor(cat.id);
			const rankOf = new Map(done.map((r) => [r.bib, r.rank]));
			const progress = buildProgress(
				course,
				members.map((p) => ({ bib: p.bib, name: p.name, start: track.get(p.bib)!.start, first: track.get(p.bib)!.first, finished: rankOf.has(p.bib), rank: rankOf.get(p.bib) ?? null }))
			);
			return { id: cat.id, name: cat.name, rows: done, started, total: members.length, awards: buildAwards(done, o), places: o.places, course, progress, gunMs: gun.get(cat.id) ?? null, gunManual: manual.has(cat.id), underway: members.some((p) => (byP.get(p.id) ?? []).some((r) => kind.get(r.station_id)?.kind !== 'start')) };
		})
		.filter((c) => c.total > 0);
}

export function fmt(ms: number) {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
	return `${h ? h + ':' : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}
