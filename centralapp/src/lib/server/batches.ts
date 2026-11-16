import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { pool, q } from './db';

/** Puts runners into the category's next numbered batch ("1", "2", ...). Call inside a transaction that holds the category row lock. */
export async function newBatch(c: pg.PoolClient, cat: number, ids: number[]) {
	const next = await c.query("select coalesce(max(name::int), 0) + 1 as n from batches where category_id=$1 and name ~ '^[0-9]{1,9}$'", [cat]);
	const name = String(next.rows[0].n);
	const b = await c.query('insert into batches(category_id, name) values($1,$2) returning id', [cat, name]);
	await c.query('update participants set batch_id=$1 where id = any($2)', [b.rows[0].id, ids]);
	return { id: b.rows[0].id as number, name };
}

/** No ms typed = Start pressed now, only if not started yet. Returns false when the batch is not this event's or already started. */
export async function startBatch(eventId: number, batchId: number, ms: number, typed: boolean) {
	const done = await q('update batches set gun_ms=$3 where id=$1 and category_id in (select id from categories where event_id=$2) and ($4 or gun_ms is null) returning id', [batchId, eventId, ms, typed]);
	if (done.length) await q("select pg_notify('reads', $1)", [String(eventId)]); // open boards refetch
	return done.length > 0;
}

/** k distinct items picked at random, in pick order (crypto random: a raffle must not be guessable). */
export function pickRandom<T>(items: T[], k: number) {
	const a = [...items];
	for (let i = 0; i < Math.min(k, a.length); i++) {
		const j = i + randomInt(a.length - i);
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a.slice(0, Math.min(k, a.length));
}

/** Live Start view: rolls up to `size` free runners of the category (one gender when given) into the next batch. */
export async function rollBatch(eventId: number, cat: number, size: number, gender: 'M' | 'F' | null) {
	const c = await pool.connect();
	try {
		await c.query('begin');
		await c.query('select 1 from categories where id=$1 for update', [cat]); // two rolls at once cannot take the same runners or number
		const free = await c.query<{ id: number; bib: string; name: string; gender: string }>(
			"select id, bib, name, coalesce(gender,'') as gender from participants where event_id=$1 and category_id=$2 and batch_id is null and ($3::text is null or gender=$3)",
			[eventId, cat, gender]
		);
		const picks = pickRandom(free.rows, size);
		if (!picks.length) {
			await c.query('rollback');
			return null;
		}
		const batch = await newBatch(c, cat, picks.map((p) => p.id));
		await c.query('commit');
		return { batch, picks: picks.map(({ bib, name, gender }) => ({ bib, name, gender })) };
	} catch (err) {
		await c.query('rollback');
		throw err;
	} finally {
		c.release();
	}
}

export type StartRunner = { bib: string; name: string; gender: string };
export type StartCat = { id: number; name: string; free: StartRunner[]; freeCount: number; batches: { id: number; name: string; gun_ms: number | null; members: StartRunner[] }[] };

/** What the live Start view shows. The free (not yet rolled) runners' names go to the organizer only. */
export async function loadStarts(slug: string, admin: boolean) {
	const [ev] = await q<{ id: number; live_start: boolean; roll_size: number }>('select id, live_start, roll_size from events where slug=$1', [slug]);
	if (!ev?.live_start) return null;
	const [cats, ps, bs] = await Promise.all([
		q<{ id: number; name: string }>('select id, name from categories where event_id=$1 and archived_at is null order by name', [ev.id]),
		q<{ category_id: number; batch_id: number | null } & StartRunner>("select category_id, batch_id, bib, name, coalesce(gender,'') as gender from participants where event_id=$1 order by bib", [ev.id]),
		q<{ id: number; name: string; category_id: number; gun_ms: number | null }>('select b.id, b.name, b.category_id, b.gun_ms from batches b join categories c on c.id=b.category_id where c.event_id=$1 order by b.id desc', [ev.id])
	]);
	const strip = ({ bib, name, gender }: StartRunner) => ({ bib, name, gender });
	const categories: StartCat[] = cats.map((c) => {
		const free = ps.filter((p) => p.category_id === c.id && !p.batch_id);
		return {
			...c,
			freeCount: free.length,
			free: admin ? free.map(strip) : [],
			batches: bs.filter((b) => b.category_id === c.id).map((b) => ({ id: b.id, name: b.name, gun_ms: b.gun_ms, members: ps.filter((p) => p.batch_id === b.id).map(strip) }))
		};
	});
	return { size: ev.roll_size, serverMs: Date.now(), categories };
}
