import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import { q } from './db';
import { MATCH } from './stationdata';
import { computeResults, type Mode } from '$lib/results';
import { parseConfig, resolveOptions } from '$lib/awardcfg';

/**
 * `includeHiddenAwards` is for the organizer (admin pages, exports). The public board gets no awards while the
 * organizer has them hidden, and `awardsHidden` tells it why.
 */
export async function loadResults(slug: string, mode: Mode, opts: { includeHiddenAwards?: boolean } = {}) {
	const [ev] = await q<{ id: number; name: string; award_places: number; age_brackets: string; award_exclusive: boolean; award_config: unknown }>(
		'select id, name, award_places, age_brackets, award_exclusive, award_config from events where slug=$1',
		[slug]
	);
	if (!ev) return null;
	const [cats, ps, stations, reads, last, courseRows, batches] = await Promise.all([
		q('select id, name, gun_ms, rank_by from categories where event_id=$1 and archived_at is null order by name', [ev.id]),
		q("select p.id, p.bib, p.name, p.category_id, p.batch_id, p.gender, p.age, p.extra, (select (extract(epoch from ph.updated_at)*1000)::bigint from participant_photos ph where ph.participant_id=p.id) as photo from participants p where p.event_id=$1", [ev.id]),
		q('select id, name, kind, ord from stations where event_id=$1', [ev.id]),
		// a read belongs to the participant whose bib it carries, else whose tag matches
		q(
			`select p.id as pid, r.station_id, r.read_at_ms from reads r
			 join participants p on ${MATCH}
			 where r.event_id=$1 and not r.voided and r.station_id is not null`,
			[ev.id]
		),
		q<{ ago: number | null }>("select extract(epoch from now()-max(ingested_at))*1000 as ago from reads where event_id=$1", [ev.id]),
		q<{ category_id: number; station_id: number }>('select cc.category_id, cc.station_id from category_courses cc join categories c on c.id=cc.category_id where c.event_id=$1 order by cc.category_id, cc.ord', [ev.id]),
		q<{ id: number; gun_ms: number | null }>('select b.id, b.gun_ms from batches b join categories c on c.id=b.category_id where c.event_id=$1', [ev.id])
	]);
	const courses = new Map<number, number[]>();
	for (const r of courseRows) (courses.get(r.category_id) ?? courses.set(r.category_id, []).get(r.category_id)!).push(r.station_id);
	const { cfg } = parseConfig(ev.award_config); // always usable; bad stored values fall back to defaults
	const defaults = { places: ev.award_places, brackets: ev.age_brackets, exclusive: ev.award_exclusive };
	const hidden = !cfg.reveal && !opts.includeHiddenAwards;
	const categories = computeResults(cats, ps, stations, reads, mode, (id) => resolveOptions(defaults, cfg, id), (id) => courses.get(id), batches);
	return {
		event: ev.name,
		mode,
		serverMs: Date.now(), // lets a browser with a wrong clock still run the race clock correctly
		lastReadAgoMs: last[0]?.ago === null || last[0]?.ago === undefined ? null : Math.round(Number(last[0].ago)),
		awardsHidden: !cfg.reveal && !opts.includeHiddenAwards,
		categories: hidden ? categories.map((c) => ({ ...c, awards: [] })) : categories
	};
}

// One Postgres LISTEN connection for the whole process; every open board gets a ping.
const subs = new Set<(eventId: number) => void>();
const hbSubs = new Set<(eventId: number) => void>(); // admin monitor: heartbeats and reads
let started = false;
function start() {
	if (started) return;
	started = true;
	const connect = async () => {
		const c = new pg.Client({ connectionString: DATABASE_URL });
		c.on('notification', (m) => (m.channel === 'hb' ? [...hbSubs] : [...subs, ...hbSubs]).forEach((f) => f(Number(m.payload))));
		const retry = () => (c.removeAllListeners(), setTimeout(connect, 2000));
		c.on('error', retry);
		c.on('end', retry);
		try {
			await c.connect();
			await c.query('listen reads');
			await c.query('listen hb');
		} catch {
			retry();
		}
	};
	connect();
}

export function subscribe(f: (eventId: number) => void) {
	start();
	subs.add(f);
	return () => subs.delete(f);
}

/** Admin monitor: pinged on every heartbeat and every read of any event (filter by event id). */
export function subscribeMonitor(f: (eventId: number) => void) {
	start();
	hbSubs.add(f);
	return () => hbSubs.delete(f);
}
