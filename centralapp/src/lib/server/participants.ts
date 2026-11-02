import { pool } from './db';
import type { Row, TeamRow } from '$lib/import';

/** Bibs only into one category: new bibs inserted; existing bibs keep name/tag and just move category. A gender, if given, applies to all. */
// a batch belongs to one category: a runner moved to another category by an import leaves it, or they would be timed
// from the old category's wave
const KEEP_BATCH = `case when excluded.category_id is null or excluded.category_id = participants.category_id then participants.batch_id end`;

export async function importBibs(eventId: number, categoryId: number | null, bibs: string[], gender = '') {
	const c = await pool.connect();
	try {
		await c.query('begin');
		for (const bib of bibs)
			await c.query(
				`insert into participants(event_id, category_id, bib, gender) values($1,$2,$3,$4)
				 on conflict(event_id, bib) do update set
				   category_id = coalesce(excluded.category_id, participants.category_id),
				   batch_id = ${KEEP_BATCH},
				   gender = coalesce(nullif(excluded.gender,''), participants.gender)`,
				[eventId, categoryId, bib, gender]
			);
		await c.query('commit');
		return bibs.length;
	} catch (e) {
		await c.query('rollback');
		throw e;
	} finally {
		c.release();
	}
}

/** Full detail rows: category names are created on demand; blank cells never erase existing data. */
export async function importRows(eventId: number, rows: Row[], defaultCategoryId: number | null) {
	const c = await pool.connect();
	try {
		await c.query('begin');
		const cats = new Map<string, number>();
		for (const r of rows) {
			let cid = defaultCategoryId;
			if (r.category) {
				cid = cats.get(r.category) ?? null;
				if (cid === null) {
					const res = await c.query(
						`insert into categories(event_id, name) values($1,$2)
						 on conflict(event_id, name) do update set name = excluded.name returning id`,
						[eventId, r.category]
					);
					cid = res.rows[0].id as number;
					cats.set(r.category, cid);
				}
			}
			await c.query(
				`insert into participants(event_id, category_id, bib, name, tag, gender, age, extra) values($1,$2,$3,$4,$5,$6,$7,$8)
				 on conflict(event_id, bib) do update set
				   category_id = coalesce(excluded.category_id, participants.category_id),
				   batch_id = ${KEEP_BATCH},
				   name = coalesce(nullif(excluded.name,''), participants.name),
				   tag = coalesce(nullif(excluded.tag,''), participants.tag),
				   gender = coalesce(nullif(excluded.gender,''), participants.gender),
				   age = coalesce(excluded.age, participants.age),
				   extra = participants.extra || excluded.extra`,
				[eventId, cid, r.bib, r.name, r.tag, r.gender, r.age, JSON.stringify(r.extra)]
			);
		}
		await c.query('commit');
		return rows.length;
	} catch (e) {
		await c.query('rollback');
		throw e;
	} finally {
		c.release();
	}
}

/**
 * Teams (relay/duo): one participants row per team (bib = team bib, name = team name), one team_members row per runner.
 * A given bib is used as is; otherwise the team is found by name + category, else gets the next free numeric bib.
 * Re-importing updates members by name, so tags can be filled in later. Blank cells never erase data.
 */
export async function importTeams(eventId: number, teams: TeamRow[], defaultCategoryId: number | null) {
	const c = await pool.connect();
	try {
		await c.query('begin');
		let members = 0;
		for (const t of teams) {
			let cid = defaultCategoryId;
			if (t.category) {
				const res = await c.query(
					`insert into categories(event_id, name) values($1,$2) on conflict(event_id, name) do update set name = excluded.name returning id`,
					[eventId, t.category]
				);
				cid = res.rows[0].id as number;
			}
			let bib = t.bib;
			if (!bib) {
				const ex = await c.query(
					`select p.bib from participants p where p.event_id=$1 and lower(p.name)=lower($2) and p.category_id is not distinct from $3
					 and exists (select 1 from team_members m where m.participant_id=p.id) limit 1`,
					[eventId, t.team, cid]
				);
				bib = ex.rows[0]?.bib;
			}
			if (!bib) {
				const mx = await c.query(`select coalesce(max(bib::int), 0) + 1 as n from participants where event_id=$1 and bib ~ '^[0-9]{1,9}$'`, [eventId]);
				bib = String(mx.rows[0].n);
			}
			const genders = new Set(t.members.map((m) => m.gender));
			const pr = await c.query(
				`insert into participants(event_id, category_id, bib, name, gender) values($1,$2,$3,$4,$5)
				 on conflict(event_id, bib) do update set
				   category_id = coalesce(excluded.category_id, participants.category_id),
				   batch_id = ${KEEP_BATCH},
				   name = excluded.name,
				   gender = excluded.gender
				 returning id`,
				[eventId, cid, bib, t.team, genders.size === 1 ? [...genders][0] : '']
			);
			const pid = pr.rows[0].id as number;
			const have = await c.query('select coalesce(max(leg),0) as n from team_members where participant_id=$1', [pid]);
			let leg = Number(have.rows[0].n);
			for (const m of t.members) {
				if (m.tag && (await c.query(`select 1 from participants where event_id=$1 and upper(tag)=upper($2)`, [eventId, m.tag])).rowCount)
					throw new Error(`Tag ${m.tag} (${m.name}) is already assigned to a participant`);
				await c.query(
					`insert into team_members(event_id, participant_id, name, gender, age, leg, tag, extra) values($1,$2,$3,$4,$5,$6,$7,$8)
					 on conflict(participant_id, lower(name)) do update set
					   gender = coalesce(nullif(excluded.gender,''), team_members.gender),
					   age = coalesce(excluded.age, team_members.age),
					   tag = coalesce(nullif(excluded.tag,''), team_members.tag),
					   extra = team_members.extra || excluded.extra`,
					[eventId, pid, m.name, m.gender, m.age, ++leg, m.tag, JSON.stringify(m.extra)]
				);
				members++;
			}
		}
		await c.query('commit');
		return { teams: teams.length, members };
	} catch (e: any) {
		await c.query('rollback');
		if (e.code === '23505') throw new Error('A tag in this file is already used by another runner');
		throw e;
	} finally {
		c.release();
	}
}
