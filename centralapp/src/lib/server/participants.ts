import { pool } from './db';
import type { Row } from '$lib/import';

/** Bibs only into one category: new bibs inserted; existing bibs keep name/tag and just move category. A gender, if given, applies to all. */
export async function importBibs(eventId: number, categoryId: number | null, bibs: string[], gender = '') {
	const c = await pool.connect();
	try {
		await c.query('begin');
		for (const bib of bibs)
			await c.query(
				`insert into participants(event_id, category_id, bib, gender) values($1,$2,$3,$4)
				 on conflict(event_id, bib) do update set
				   category_id = coalesce(excluded.category_id, participants.category_id),
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
