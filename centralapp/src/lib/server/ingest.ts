import { pool } from './db';

export type InRead = { tag: string; read_at_ms: number; device_id?: unknown; station?: unknown; bib?: unknown; voided?: unknown };

/** The one place reads enter the database: the live station upload and the manual file upload both use it, so duplicates are judged identically. */
export async function insertReads(eventId: number, reads: InRead[]) {
	const c = await pool.connect();
	try {
		await c.query('begin');
		let inserted = 0;
		let updated = 0;
		for (const r of reads) {
			// station matched by name (case-insensitive); unknown/blank -> null, still stored
			const res = await c.query(
				`insert into reads(event_id, station_id, tag, bib, read_at_ms, device_id, voided, station_name_sent)
				 values($1,(select id from stations where event_id=$1 and lower(name)=lower($2)),$3,
				        coalesce($4,(select bib from participants where event_id=$1 and tag<>'' and upper(tag)=upper($3) limit 1),(select bib from participants where event_id=$1 and bib=$3 limit 1)),$5,$6,$7,$8)
				 on conflict(event_id, device_id, read_at_ms, tag) do update set voided = excluded.voided
				   where reads.voided is distinct from excluded.voided
				 returning (xmax = 0) as inserted`, // an existing read only changes when the station voids/restores it
				[eventId, String(r.station ?? ''), r.tag, r.bib ? String(r.bib) : null, r.read_at_ms, String(r.device_id ?? ''), r.voided === true, String(r.station ?? '').trim().slice(0, 80)]
			);
			if (res.rows[0]) res.rows[0].inserted ? inserted++ : updated++;
		}
		await c.query('commit');
		return { received: reads.length, inserted, updated, duplicates: reads.length - inserted - updated };
	} catch (err) {
		await c.query('rollback');
		throw err;
	} finally {
		c.release();
	}
}
