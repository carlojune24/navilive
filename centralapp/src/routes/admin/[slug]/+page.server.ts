import { error, fail } from '@sveltejs/kit';
import { pool, q } from '$lib/server/db';
import { hashKey, newKey } from '$lib/server/apikey';
import { lanAddresses } from '$lib/server/network';
import { parseBibs, parseCsv, normGender, parseAge } from '$lib/import';
import { parseBrackets } from '$lib/results';
import { parseConfig } from '$lib/awardcfg';
import { MAX_PHOTO_BYTES, sniffImage } from '$lib/image';
import { loadResults } from '$lib/server/live';
import { importBibs, importRows } from '$lib/server/participants';
import { stationOverview, MATCH } from '$lib/server/stationdata';
import { loadLaptops } from '$lib/server/monitor';
import { insertReads } from '$lib/server/ingest';
import { parseReadsFile } from '$lib/readfile';
import { buildTrack, isTrack, type RawPoint, type Track } from '$lib/gpx';
import { SERVICE_KEYS } from '$lib/services';
import { defaultCourse } from '$lib/progress';
import { PUBLIC_URL } from '$app/env/private';

async function ev(slug: string) {
	const [e] = await q<{ id: number; name: string; slug: string; api_key: string | null; award_places: number; age_brackets: string; award_exclusive: boolean; award_config: unknown }>(
		'select id, name, slug, api_key, award_places, age_brackets, award_exclusive, award_config from events where slug=$1',
		[slug]
	);
	if (!e) error(404, 'Event not found');
	return e;
}

/** The category a route form is about, only if it belongs to this event. */
async function categoryOf(eventId: number, f: FormData) {
	const id = Number(f.get('category'));
	return Number.isInteger(id) && (await q('select 1 from categories where id=$1 and event_id=$2', [id, eventId])).length ? id : null;
}

async function setCourse(cat: number, ids: number[]) {
	await q('delete from category_courses where category_id=$1', [cat]);
	for (let i = 0; i < ids.length; i++) await q('insert into category_courses(category_id, station_id, ord) values($1,$2,$3)', [cat, ids[i], i]);
}

const id = async (request: Request) => Number((await request.formData()).get('id'));

export const load = async ({ params, url }) => {
	const e = await ev(params.slug);
	const [categories, archived, batches, participants, stations, reads] = await Promise.all([
		q('select c.id, c.name, c.gun_ms, c.rank_by, count(p.id)::int as n from categories c left join participants p on p.category_id=c.id where c.event_id=$1 and c.archived_at is null group by c.id order by c.name', [e.id]),
		q('select id, name from categories where event_id=$1 and archived_at is not null order by name', [e.id]),
		q('select b.id, b.category_id, b.name, b.gun_ms, count(p.id)::int as n from batches b join categories c on c.id=b.category_id left join participants p on p.batch_id=b.id where c.event_id=$1 group by b.id order by b.name', [e.id]),
		q('select p.id, p.bib, p.name, p.tag, p.gender, p.age, p.category_id, p.batch_id, c.name as category, (select (extract(epoch from ph.updated_at)*1000)::bigint from participant_photos ph where ph.participant_id=p.id) as photo from participants p left join categories c on c.id=p.category_id where p.event_id=$1 order by p.bib', [e.id]),
		q('select id, name, kind, ord, services from stations where event_id=$1 order by ord, id', [e.id]),
		q(
			`select r.id, r.read_at_ms, r.tag, r.device_id, r.voided, s.name as station,
			        coalesce(r.bib, p.bib) as bib, p.name
			 from reads r left join stations s on s.id=r.station_id
			 left join participants p on ${MATCH}
			 where r.event_id=$1 order by r.read_at_ms desc, r.id desc limit 300`,
			[e.id]
		)
	]);
	const stationData = await stationOverview(e.id);
	const laptops = await loadLaptops(e.id);
	const port = process.env.PORT ?? (url.port || '3000');
	const awards = { places: e.award_places, brackets: e.age_brackets, exclusive: e.award_exclusive, config: parseConfig(e.award_config).cfg };
	// runner columns kept as extra data (team, club, city...) and their values, for custom awards
	const extraRows = await q<{ k: string; vals: string[] }>(
		`select x.k, array_agg(distinct x.v order by x.v) as vals from participants p, jsonb_each_text(p.extra) as x(k, v)
		 where p.event_id=$1 and x.v <> '' group by x.k order by x.k limit 30`,
		[e.id]
	);
	const extraFields = Object.fromEntries(extraRows.map((r) => [r.k, r.vals.slice(0, 100)]));
	// what the organizer would see on the board, even while the awards are hidden from the public
	const full = (await loadResults(e.slug, 'gun', { includeHiddenAwards: true }))?.categories ?? [];
	const awardPreview = full.map((c) => ({ id: c.id, name: c.name, finished: c.rows.length, total: c.total, awards: c.awards }));
	// the ranked results and award podiums for the Results and Award list pages (print / export)
	const resultsData = full.map((c) => ({
		id: c.id, name: c.name, rankBy: c.rankBy, total: c.total,
		rows: c.rows.map((r) => ({ rank: r.rank, bib: r.bib, name: r.name, gender: r.gender, age: r.age, time: r.time })),
		awards: c.awards
	}));
	// who has reached which station, for the Progress page
	const progressData = full.map((c) => ({ id: c.id, name: c.name, total: c.total, started: c.started, finished: c.rows.length, course: c.course, progress: c.progress }));
	const courseRows = await q<{ category_id: number; station_id: number }>('select cc.category_id, cc.station_id from category_courses cc join categories c on c.id=cc.category_id where c.event_id=$1 order by cc.category_id, cc.ord', [e.id]);
	const courses: Record<string, number[]> = {};
	for (const r of courseRows) (courses[r.category_id] ??= []).push(r.station_id);
	// routes are per category; station km are per category too
	const routes: Record<number, { track: Track | null; name: string }> = {};
	for (const r of await q<{ id: number; gpx: unknown; gpx_name: string | null }>('select id, gpx, gpx_name from categories where event_id=$1', [e.id])) routes[r.id] = { track: isTrack(r.gpx) ? r.gpx : null, name: r.gpx_name ?? '' };
	const stationKm: Record<number, Record<number, number>> = {};
	for (const r of await q<{ category_id: number; station_id: number; km: number }>('select k.category_id, k.station_id, k.km::float8 as km from category_station_km k join categories c on c.id=k.category_id where c.event_id=$1', [e.id])) (stationKm[r.category_id] ??= {})[r.station_id] = r.km;
	return { routes, stationKm, event: { id: e.id, name: e.name, slug: e.slug }, awards, extraFields, awardPreview, resultsData, progressData, courses, apiKey: e.api_key, port, addresses: lanAddresses(), publicUrl: PUBLIC_URL ?? null, stationData, laptops, categories, archived, batches, participants, stations, reads };
};

export const actions = {
	addCategory: async ({ request, params }) => {
		const e = await ev(params.slug);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Category name required' });
		await q('insert into categories(event_id, name) values($1,$2) on conflict do nothing', [e.id, name]);
	},
	// categories are archived, never deleted: results, reads and batches stay intact and Restore brings it back
	archiveCategory: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('update categories set archived_at=now() where id=$1 and event_id=$2', [await id(request), e.id]);
	},
	restoreCategory: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('update categories set archived_at=null where id=$1 and event_id=$2', [await id(request), e.id]);
	},
	setRankBy: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const by = String(f.get('rank_by'));
		if (!['elapsed', 'chip', 'finish'].includes(by)) return fail(400, { error: 'Unknown ranking' });
		await q('update categories set rank_by=$3 where id=$1 and event_id=$2', [Number(f.get('id')), e.id, by]);
		await q("select pg_notify('reads', $1)", [String(e.id)]);
	},
	addBatch: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const cat = await categoryOf(e.id, f);
		const name = String(f.get('name') ?? '').trim();
		if (!cat || !name) return fail(400, { error: 'Batch name required' });
		await q('insert into batches(category_id, name) values($1,$2) on conflict do nothing', [cat, name]);
	},
	deleteBatch: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('delete from batches where id=$1 and category_id in (select id from categories where event_id=$2)', [await id(request), e.id]);
	},
	// Put runners (by bib) into a batch of their category; "none" takes them out of any batch.
	assignBatch: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const cat = await categoryOf(e.id, f);
		const batch = Number(f.get('batch')) || null;
		if (!cat) return fail(400, { error: 'Unknown category' });
		if (batch && !(await q('select 1 from batches where id=$1 and category_id=$2', [batch, cat])).length) return fail(400, { error: 'Unknown batch' });
		const { bibs, errors } = parseBibs(String(f.get('bibs') ?? ''));
		if (errors.length) return fail(400, { error: errors.join('; ') });
		if (!bibs.length) return fail(400, { error: 'No bib numbers found' });
		// all or nothing: a bib that is not in this category stops the whole assignment, so a typo is never half-applied
		const found = await q<{ bib: string }>('select bib from participants where event_id=$1 and category_id=$2 and bib = any($3)', [e.id, cat, bibs]);
		const missing = bibs.filter((b) => !found.some((r) => r.bib === b));
		if (missing.length) return fail(400, { error: `Nothing assigned. Not in this category: ${missing.join(', ')}` });
		if (batch) {
			const taken = await q<{ bib: string; batch: string }>('select p.bib, b.name as batch from participants p join batches b on b.id=p.batch_id where p.event_id=$1 and p.category_id=$2 and p.bib = any($3) and p.batch_id<>$4', [e.id, cat, bibs, batch]);
			if (taken.length) return fail(400, { error: `Nothing assigned. Already in another batch (remove them there first): ${taken.map((t) => `${t.bib} in ${t.batch}`).join(', ')}` });
		}
		await q('update participants set batch_id=$3 where event_id=$1 and category_id=$2 and bib = any($4)', [e.id, cat, batch, bibs]);
		return { batchAssigned: found.length };
	},
	removeFromBatch: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('update participants set batch_id=null where id=$1 and event_id=$2', [await id(request), e.id]);
	},
	// Back to "not started" (a category reset also resets the batches that follow it)
	clearGun: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const target = Number(f.get('id'));
		if (f.get('kind') === 'batch') await q('update batches set gun_ms=null where id=$1 and category_id in (select id from categories where event_id=$2)', [target, e.id]);
		else {
			const [c] = await q<{ gun_ms: string | null }>('update categories set gun_ms=null where id=$1 and event_id=$2 returning (select gun_ms from categories where id=$1) as gun_ms', [target, e.id]);
			if (c?.gun_ms) await q('update batches set gun_ms=null where category_id=$1 and gun_ms=$2', [target, c.gun_ms]);
		}
		await q("select pg_notify('reads', $1)", [String(e.id)]);
	},
	// ms given = the organizer typed the time (a forgotten start, may overwrite); no ms = Start pressed now (first press only).
	// A category start also starts every batch that has not started or still follows the category's old time.
	startGun: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const typed = String(f.get('ms') ?? '') !== '';
		const ms = typed ? Number(f.get('ms')) : Date.now();
		if (!Number.isFinite(ms) || ms <= 0) return fail(400, { error: 'Enter a valid start time' });
		const target = Number(f.get('id'));
		if (f.get('kind') === 'batch') {
			const done = await q('update batches set gun_ms=$3 where id=$1 and category_id in (select id from categories where event_id=$2) and ($4 or gun_ms is null) returning id', [target, e.id, ms, typed]);
			if (!done.length) return fail(409, { error: 'That batch has already started' });
		} else {
			const [c] = await q<{ gun_ms: string | null }>('select gun_ms from categories where id=$1 and event_id=$2', [target, e.id]);
			if (!c) return fail(400, { error: 'Unknown category' });
			if (c.gun_ms !== null && !typed) return fail(409, { error: 'That category has already started' });
			await q('update categories set gun_ms=$2 where id=$1', [target, ms]);
			await q('update batches set gun_ms=$2 where category_id=$1 and (gun_ms is null or gun_ms=$3)', [target, ms, c.gun_ms]);
		}
		await q("select pg_notify('reads', $1)", [String(e.id)]); // open boards refetch
	},
	importBibs: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const cat = Number(f.get('category'));
		if (!cat) return fail(400, { error: 'Pick a category first' });
		const ok = await q('select 1 from categories where id=$1 and event_id=$2', [cat, e.id]);
		if (!ok.length) return fail(400, { error: 'Unknown category' });
		const { bibs, errors } = parseBibs(String(f.get('bibs') ?? ''));
		if (errors.length) return fail(400, { error: errors.join('; ') });
		if (!bibs.length) return fail(400, { error: 'No bib numbers found' });
		const gender = normGender(String(f.get('gender') ?? ''));
		return { imported: await importBibs(e.id, cat, bibs, gender) };
	},
	// One runner with every field, for walk-up registrations and corrections.
	addParticipant: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const bib = String(f.get('bib') ?? '').trim();
		const ageText = String(f.get('age') ?? '').trim();
		if (!bib) return fail(400, { error: 'Bib number is required' });
		if (ageText && parseAge(ageText) === null) return fail(400, { error: 'Age must be a whole number from 1 to 120' });
		const cat = Number(f.get('category')) || null;
		if (cat && !(await q('select 1 from categories where id=$1 and event_id=$2', [cat, e.id])).length) return fail(400, { error: 'Unknown category' });
		try {
			await importRows(
				e.id,
				[{ bib, name: String(f.get('name') ?? '').trim(), category: '', tag: String(f.get('tag') ?? '').trim(), gender: normGender(String(f.get('gender') ?? '')), age: ageText ? parseAge(ageText) : null, extra: {} }],
				cat
			);
		} catch (err: any) {
			if (err.code === '23505') return fail(400, { error: 'That tag is already assigned to another participant' });
			throw err;
		}
		return { imported: 1 };
	},
	importCsv: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const file = f.get('file');
		// the category is picked in the form, so files never need category names in them
		const catRaw = String(f.get('category') ?? '');
		if (catRaw === '') return fail(400, { error: 'Choose a category for this file, or "Don\'t change categories".' });
		const text = file instanceof File && file.size ? await file.text() : String(f.get('csv') ?? '');
		const { rows, errors } = parseCsv(text);
		if (!rows.length) return fail(400, { error: errors.join('; ') || 'No rows found' });
		const def = Number(catRaw) || null; // "keep" -> null: existing categories are left as they are
		if (def && !(await q('select 1 from categories where id=$1 and event_id=$2', [def, e.id])).length) return fail(400, { error: 'Unknown category' });
		return { imported: await importRows(e.id, rows, def), skipped: errors };
	},
	// A station app export file uploaded by hand (e.g. a laptop that was offline). Same insert as the live upload, so re-uploading is harmless.
	uploadReads: async ({ request, params }) => {
		const e = await ev(params.slug);
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose a station app export file (.csv or .json).' });
		if (file.size > 20_000_000) return fail(400, { error: 'File is too large (max 20 MB).' });
		const { reads, error: bad } = parseReadsFile(file.name, await file.text());
		if (bad) return fail(400, { error: `Nothing uploaded. ${bad}` });
		const res = { received: 0, inserted: 0, updated: 0, duplicates: 0 };
		for (let i = 0; i < reads.length; i += 2000) {
			const r = await insertReads(e.id, reads.slice(i, i + 2000));
			for (const k of Object.keys(res) as (keyof typeof res)[]) res[k] += r[k];
		}
		await q("select pg_notify('reads', $1)", [String(e.id)]); // open boards refetch
		return { readsUploaded: res };
	},
	updateParticipant: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const pid = Number(f.get('id'));
		const bib = String(f.get('bib') ?? '').trim();
		const cat = Number(f.get('category')) || null;
		if (!bib) return fail(400, { error: 'Bib number is required' });
		const c = await pool.connect();
		try {
			await c.query('begin');
			const old = await c.query('select bib from participants where id=$1 and event_id=$2 for update', [pid, e.id]);
			if (!old.rows[0]) {
				await c.query('rollback');
				return fail(404, { error: 'Participant not found' });
			}
			const ageText = String(f.get('age') ?? '').trim();
			if (ageText && parseAge(ageText) === null) {
				await c.query('rollback');
				return fail(400, { error: 'Age must be a whole number from 1 to 120' });
			}
			await c.query('update participants set bib=$3, name=$4, tag=$5, category_id=$6, gender=$7, age=$8, batch_id=(select id from batches where id=$9 and category_id=$6) where id=$1 and event_id=$2', [
				pid, e.id, bib, String(f.get('name') ?? '').trim(), String(f.get('tag') ?? '').trim(), cat,
				normGender(String(f.get('gender') ?? '')), ageText ? parseAge(ageText) : null, Number(f.get('batch')) || null
			]);
			// reads remember the bib they were matched to; keep them attached when the bib is renumbered
			if (old.rows[0].bib !== bib) await c.query('update reads set bib=$3 where event_id=$1 and bib=$2', [e.id, old.rows[0].bib, bib]);
			await c.query('commit');
		} catch (err: any) {
			await c.query('rollback');
			if (err.code === '23505') return fail(400, { error: `Bib ${bib} is already used by another participant` });
			throw err;
		} finally {
			c.release();
		}
		return { saved: true };
	},
	saveAwards: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const places = Number(f.get('places'));
		const brackets = String(f.get('brackets') ?? '').trim();
		if (!Number.isInteger(places) || places < 1 || places > 10) return fail(400, { error: 'Places must be a whole number from 1 to 10' });
		if (parseBrackets(brackets) === null) return fail(400, { error: 'Age brackets look like 18-29, 30-39, 60+ (comma separated, low to high)' });
		let raw: unknown = {};
		try {
			raw = JSON.parse(String(f.get('config') ?? '{}'));
		} catch {
			return fail(400, { error: 'Could not read the award choices. Reload the page and try again.' });
		}
		const { cfg, errors } = parseConfig(raw);
		if (errors.length) return fail(400, { error: errors[0] });
		// only this event's categories; the reveal switch has its own button so a stale page cannot flip it
		const valid = new Set((await q<{ id: number }>('select id from categories where event_id=$1', [e.id])).map((c) => c.id));
		for (const k of Object.keys(cfg.categories)) if (!valid.has(Number(k))) delete cfg.categories[k];
		for (const c of cfg.customs) c.categoryIds = c.categoryIds.filter((id) => valid.has(id));
		cfg.reveal = parseConfig(e.award_config).cfg.reveal;
		await q('update events set award_places=$2, age_brackets=$3, award_exclusive=$4, award_config=$5 where id=$1', [e.id, places, brackets, f.get('exclusive') === 'on', JSON.stringify(cfg)]);
		await q("select pg_notify('reads', $1)", [String(e.id)]); // open boards refetch
		return { awardsSaved: true };
	},
	// hide the awards from the public board until the ceremony, or show them
	setReveal: async ({ request, params }) => {
		const e = await ev(params.slug);
		const reveal = (await request.formData()).get('reveal') === 'true';
		const { cfg } = parseConfig(e.award_config);
		cfg.reveal = reveal;
		await q('update events set award_config=$2 where id=$1', [e.id, JSON.stringify(cfg)]);
		await q("select pg_notify('reads', $1)", [String(e.id)]);
		return { revealSet: reveal };
	},
	// Winner photos. The browser shrinks them first; the server still checks size and the real file type.
	uploadPhoto: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const pid = Number(f.get('id'));
		const file = f.get('photo');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose a photo.' });
		if (file.size > MAX_PHOTO_BYTES) return fail(400, { error: 'That photo is too large.' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImage(bytes);
		if (!mime) return fail(400, { error: 'Use a JPG, PNG or WebP photo.' });
		if (!(await q('select 1 from participants where id=$1 and event_id=$2', [pid, e.id])).length) return fail(404, { error: 'Participant not found.' });
		await q(
			`insert into participant_photos(participant_id, mime, data) values($1,$2,$3)
			 on conflict(participant_id) do update set mime=excluded.mime, data=excluded.data, updated_at=now()`,
			[pid, mime, Buffer.from(bytes)]
		);
		await q("select pg_notify('reads', $1)", [String(e.id)]); // open boards refetch
		return { photoSaved: true };
	},
	deletePhoto: async ({ request, params }) => {
		const e = await ev(params.slug);
		const pid = Number((await request.formData()).get('id'));
		await q('delete from participant_photos where participant_id=$1 and participant_id in (select id from participants where event_id=$2)', [pid, e.id]);
		await q("select pg_notify('reads', $1)", [String(e.id)]);
		return { photoRemoved: true };
	},
	deleteParticipant: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('delete from participants where id=$1 and event_id=$2', [await id(request), e.id]);
	},
	// the GPX route of one category: the browser parses the file and sends compact points; the server builds distance and elevation itself
	saveRoute: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const cat = await categoryOf(e.id, f);
		if (!cat) return fail(400, { error: 'Pick a category for this route.' });
		let raw: unknown;
		try {
			raw = JSON.parse(String(f.get('pts') ?? ''));
		} catch {
			return fail(400, { error: 'That file could not be read as a GPX route.' });
		}
		const ok = Array.isArray(raw) && raw.length <= 8000 && raw.every((p) => Array.isArray(p) && p.length === 3 && typeof p[0] === 'number' && typeof p[1] === 'number');
		const track = ok ? buildTrack((raw as unknown[][]).map((p) => [p[0], p[1], typeof p[2] === 'number' ? p[2] : NaN] as RawPoint)) : null;
		if (!track) return fail(400, { error: 'That GPX has no usable route (it needs at least two track points).' });
		await q('update categories set gpx=$2, gpx_name=$3 where id=$1', [cat, JSON.stringify(track), String(f.get('name') ?? '').slice(0, 120)]);
		await q("select pg_notify('reads', $1)", [String(e.id)]);
		return { routeSaved: true };
	},
	clearRoute: async ({ request, params }) => {
		const e = await ev(params.slug);
		const cat = await categoryOf(e.id, await request.formData());
		if (cat) await q('update categories set gpx=null, gpx_name=null where id=$1', [cat]);
		await q("select pg_notify('reads', $1)", [String(e.id)]);
	},
	// where a station sits on one category's route (km from the start); what it offers is the same for every category
	setStationRoute: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const cat = await categoryOf(e.id, f);
		const sid = Number(f.get('id'));
		if (!cat || !(await q('select 1 from stations where id=$1 and event_id=$2', [sid, e.id])).length) return fail(400, { error: 'Unknown station or category.' });
		const raw = String(f.get('km') ?? '').trim().replace(',', '.');
		const km = raw === '' ? null : Number(raw);
		if (km !== null && (!Number.isFinite(km) || km < 0 || km > 1000)) return fail(400, { error: 'Distance must be a number of km, like 15.4' });
		const services = f.getAll('services').map(String).filter((k) => SERVICE_KEYS.includes(k));
		if (km === null) await q('delete from category_station_km where category_id=$1 and station_id=$2', [cat, sid]);
		else await q('insert into category_station_km(category_id, station_id, km) values($1,$2,$3) on conflict (category_id, station_id) do update set km=$3', [cat, sid, km]);
		await q('update stations set services=$2 where id=$1', [sid, services]);
		// "on this category" checkbox = membership in the category's course (no rows = every station)
		const all = defaultCourse(await q<{ id: number; kind: string; ord: number }>('select id, kind, ord from stations where event_id=$1', [e.id])).map((s) => s.id);
		const cur = (await q<{ station_id: number }>('select station_id from category_courses where category_id=$1 order by ord', [cat])).map((r) => r.station_id);
		const has = (cur.length ? cur : all).includes(sid);
		if (f.get('on') && !has) {
			// shortcut: re-adding resets a custom order to the default order; upgrade if organizers reorder courses a lot
			const keep = new Set([...cur, sid]);
			await setCourse(cat, all.filter((id) => keep.has(id)));
		} else if (!f.get('on') && has) {
			const next = (cur.length ? cur : all).filter((id) => id !== sid);
			if (!next.length) return fail(400, { error: 'A category needs at least one station.' });
			await setCourse(cat, next);
		}
		await q("select pg_notify('reads', $1)", [String(e.id)]);
		return { stationRouteSaved: true };
	},
	addStation: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		const kind = String(f.get('kind'));
		if (!name || !['start', 'checkpoint', 'finish'].includes(kind)) return fail(400, { error: 'Station needs a name and a kind' });
		await q('insert into stations(event_id, name, kind, ord) values($1,$2,$3,(select coalesce(max(ord)+1,0) from stations where event_id=$1)) on conflict do nothing', [e.id, name, kind]);
		// reads that arrived earlier under this name (station was missing or misspelled) now count
		await q('update reads r set station_id=s.id from stations s where s.event_id=$1 and s.name=$2 and r.event_id=$1 and r.station_id is null and lower(r.station_name_sent)=lower(s.name)', [e.id, name]);
	},
	// checkpoints can be put in order; start is always first and finish last
	moveStation: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const sid = Number(f.get('id'));
		const delta = f.get('dir') === 'up' ? -1 : 1;
		const cps = await q<{ id: number }>("select id from stations where event_id=$1 and kind='checkpoint' order by ord, id", [e.id]);
		const i = cps.findIndex((s) => s.id === sid);
		if (i < 0 || i + delta < 0 || i + delta >= cps.length) return;
		[cps[i], cps[i + delta]] = [cps[i + delta], cps[i]];
		for (let k = 0; k < cps.length; k++) await q('update stations set ord=$2 where id=$1', [cps[k].id, k + 1]);
	},
	// which stations each category passes, in order; null/empty = every station
	saveCourses: async ({ request, params }) => {
		const e = await ev(params.slug);
		let raw: unknown;
		try {
			raw = JSON.parse(String((await request.formData()).get('courses') ?? '{}'));
		} catch {
			return fail(400, { error: 'Could not read the course choices. Reload the page and try again.' });
		}
		if (!raw || typeof raw !== 'object') return fail(400, { error: 'Could not read the course choices.' });
		const cats = new Set((await q<{ id: number }>('select id from categories where event_id=$1', [e.id])).map((c) => c.id));
		const stations = new Set((await q<{ id: number }>('select id from stations where event_id=$1', [e.id])).map((s) => s.id));
		const plan: [number, number[]][] = [];
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			const cid = Number(k);
			if (!cats.has(cid)) continue;
			const ids = Array.isArray(v) ? v.map(Number) : [];
			if (ids.some((id) => !Number.isInteger(id) || !stations.has(id)) || new Set(ids).size !== ids.length || ids.length > 50) return fail(400, { error: 'A course lists a station that does not exist, or lists one twice.' });
			plan.push([cid, ids]);
		}
		const c = await pool.connect();
		try {
			await c.query('begin');
			for (const [cid, ids] of plan) {
				await c.query('delete from category_courses where category_id=$1', [cid]);
				for (let i = 0; i < ids.length; i++) await c.query('insert into category_courses(category_id, station_id, ord) values($1,$2,$3)', [cid, ids[i], i]);
			}
			await c.query('commit');
		} catch (err) {
			await c.query('rollback');
			throw err;
		} finally {
			c.release();
		}
		await q("select pg_notify('reads', $1)", [String(e.id)]); // boards refetch
		return { coursesSaved: true };
	},
	deleteStation: async ({ request, params }) => {
		const e = await ev(params.slug);
		await q('delete from stations where id=$1 and event_id=$2', [await id(request), e.id]);
	},
	rotateKey: async ({ params }) => {
		const e = await ev(params.slug);
		const key = newKey();
		await q('update events set api_key_hash=$1, api_key=$2 where id=$3', [hashKey(key), key, e.id]);
	},
	// Reads are never deleted one by one: void/restore keeps an audit trail.
	voidRead: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		await q('update reads set voided=$3 where id=$1 and event_id=$2', [Number(f.get('id')), e.id, f.get('voided') === 'true']);
	},
	manualRead: async ({ request, params }) => {
		const e = await ev(params.slug);
		const f = await request.formData();
		const bib = String(f.get('bib') ?? '').trim();
		const station = Number(f.get('station'));
		const when = String(f.get('time') ?? '').trim();
		const at = when ? new Date(when).getTime() : Date.now();
		if (!bib || !station) return fail(400, { error: 'Bib and station are required' });
		if (!Number.isFinite(at)) return fail(400, { error: 'Time is not valid' });
		const [p] = await q<{ bib: string; tag: string }>('select bib, tag from participants where event_id=$1 and bib=$2', [e.id, bib]);
		if (!p) return fail(400, { error: `No participant with bib ${bib}` });
		const ok = await q('select 1 from stations where id=$1 and event_id=$2', [station, e.id]);
		if (!ok.length) return fail(400, { error: 'Unknown station' });
		const res = await q(
			`insert into reads(event_id, station_id, tag, bib, read_at_ms, device_id) values($1,$2,$3,$4,$5,'MANUAL-CENTRAL')
			 on conflict do nothing returning id`,
			[e.id, station, (p.tag || 'BIB-' + p.bib).toUpperCase(), p.bib, at]
		);
		if (!res.length) return fail(400, { error: 'That exact read already exists' });
		return { manualAdded: true };
	},
	// For wiping test data before the event. Station apps keep their own copies and would upload them again.
	clearReads: async ({ request, params }) => {
		const e = await ev(params.slug);
		if (String((await request.formData()).get('confirm') ?? '').trim() !== 'CLEAR') return fail(400, { error: 'Type CLEAR to confirm' });
		const r = await pool.query('delete from reads where event_id=$1', [e.id]);
		return { cleared: r.rowCount ?? 0 };
	}
};
