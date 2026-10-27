import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { loadResults } from '$lib/server/live';
import { MATCH } from '$lib/server/stationdata';
import { fmt, type Row } from '$lib/results';
import { parseConfig, resolveOptions } from '$lib/awardcfg';
import { toCsv } from '$lib/csv';

// Under /admin, so the session check in hooks.server.ts already protects it.
export const GET = async ({ params, url }) => {
	const kind = url.searchParams.get('kind') ?? 'results';
	const mode = url.searchParams.get('mode') === 'own' ? 'own' : 'gun';
	let rows: (string | number | null)[][];
	let name: string;

	if (kind === 'reads') {
		const [ev] = await q<{ id: number }>('select id from events where slug=$1', [params.slug]);
		if (!ev) error(404, 'Event not found');
		const reads = await q(
			`select r.read_at_ms, s.name as station, coalesce(r.bib, p.bib) as bib, p.name, r.tag, r.device_id, r.voided
			 from reads r left join stations s on s.id=r.station_id
			 left join participants p on ${MATCH}
			 where r.event_id=$1 order by r.read_at_ms, r.id`,
			[ev.id]
		);
		rows = [
			['time_iso', 'time_ms', 'station', 'bib', 'name', 'tag', 'device', 'voided'],
			...reads.map((r) => [new Date(r.read_at_ms).toISOString(), r.read_at_ms, r.station, r.bib, r.name, r.tag, r.device_id, r.voided ? 'yes' : ''])
		];
		name = 'reads';
	} else if (kind === 'template') {
		rows = [['bib', 'name', 'gender', 'age', 'tag'], ['101', 'Jane Doe', 'F', 34, '0000000001'], ['102', 'John Smith', 'M', 41, '']];
		name = 'participants-template';
	} else if (kind === 'participants') {
		const [ev] = await q<{ id: number }>('select id from events where slug=$1', [params.slug]);
		if (!ev) error(404, 'Event not found');
		const ps = await q(
			`select p.bib, p.name, c.name as category, p.gender, p.age, p.tag from participants p left join categories c on c.id=p.category_id
			 where p.event_id=$1 order by c.name nulls last, nullif(regexp_replace(p.bib, '\\D', '', 'g'), '')::numeric nulls last, p.bib`,
			[ev.id]
		);
		rows = [['bib', 'name', 'category', 'gender', 'age', 'tag'], ...ps.map((p) => [p.bib, p.name, p.category, p.gender, p.age, p.tag])];
		name = 'participants';
	} else if (kind === 'winners') {
		const res = await loadResults(params.slug, mode, { includeHiddenAwards: true });
		if (!res) error(404, 'Event not found');
		rows = [['category', 'award', 'place', 'bib', 'name', 'time', 'time_ms', 'gun_start_iso']];
		for (const c of res.categories) for (const a of c.awards) for (const w of a.winners) rows.push([c.name, a.name, w.place, w.bib, w.name, fmt(w.time), w.time, mode === 'gun' && c.gunMs ? new Date(c.gunMs).toISOString() : '']);
		name = `winners-${mode === 'gun' ? 'gun-time' : 'own-start'}`;
	} else {
		const res = await loadResults(params.slug, mode, { includeHiddenAwards: true });
		if (!res) error(404, 'Event not found');
		const [ev] = await q<{ award_places: number; age_brackets: string; award_exclusive: boolean; award_config: unknown }>(
			'select award_places, age_brackets, award_exclusive, award_config from events where slug=$1',
			[params.slug]
		);
		const defaults = { places: ev?.award_places ?? 3, brackets: ev?.age_brackets ?? '', exclusive: ev?.award_exclusive ?? false };
		const { cfg } = parseConfig(ev?.award_config);
		const splitCols: string[] = [];
		for (const c of res.categories) for (const r of c.rows) for (const s of r.splits) if (!splitCols.includes(s.station)) splitCols.push(s.station);
		rows = [['category', 'rank', 'bib', 'name', 'gender', 'age', 'gender_rank', 'age_group', 'age_group_rank', 'time', 'time_ms', 'start_iso', 'start_basis', 'finish_time_iso', ...splitCols.map((s) => `split_${s}`)]];
		for (const c of res.categories) {
			// rank within the runner's own gender and age group (rows are already in finishing order); brackets are this category's own
			const brackets = resolveOptions(defaults, cfg, c.id).groups;
			const rankIn = (r: Row, same: (o: Row) => boolean) => c.rows.filter(same).indexOf(r) + 1;
			for (const r of c.rows) {
				const b = r.age === null ? undefined : brackets.find((x) => r.age! >= x.min && r.age! <= x.max);
				rows.push([
					c.name, r.rank, r.bib, r.name, r.gender, r.age,
					r.gender ? rankIn(r, (o) => o.gender === r.gender) : '',
					b?.label ?? '',
					b ? rankIn(r, (o) => o.gender === r.gender && o.age !== null && o.age >= b.min && o.age <= b.max) : '',
					fmt(r.time!), r.time,
						new Date(r.finishAt! - r.time!).toISOString(), // the start this runner's time was measured from
						mode === 'own' ? 'own start read' : c.gunManual ? 'gun (Start pressed on live board)' : 'gun (first Start read)',
						new Date(r.finishAt!).toISOString(),
					...splitCols.map((s) => { const x = r.splits.find((p) => p.station === s); return x ? fmt(x.elapsed) : ''; })
				]);
			}
		}
		name = `results-${mode === 'gun' ? 'gun-time' : 'own-start'}`;
	}

	return new Response(toCsv(rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${params.slug}-${name}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
