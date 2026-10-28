import { pool } from './db';
import { stampFor } from '$lib/marshal';

export type InRead = { tag: string; read_at_ms: number; device_id?: unknown; station?: unknown; bib?: unknown; voided?: unknown; server_time?: unknown; src?: unknown };

/** The one place reads enter the database: the live station upload and the manual file upload both use it, so duplicates are judged identically. */
export async function insertReads(eventId: number, reads: InRead[]) {
	const c = await pool.connect();
	try {
		await c.query('begin');
		let inserted = 0;
		let updated = 0;
		for (const r of reads) {
			// a marshal tap: the server's clock decides the time, the phone's stamp only keys resends and Undo
			const marshal = r.server_time === true;
			const at = marshal ? stampFor(r.read_at_ms, Date.now()) : r.read_at_ms;
			if (marshal) {
				// station matched by name (case-insensitive); unknown/blank -> null, still stored
				const res = await c.query(
					`insert into reads(event_id, station_id, tag, bib, read_at_ms, device_id, voided, station_name_sent, client_ms)
					 values($1,(select id from stations where event_id=$1 and lower(name)=lower($2)),$3,
					        coalesce($4,(select bib from participants where event_id=$1 and tag<>'' and upper(tag)=upper($3) limit 1),(select bib from participants where event_id=$1 and bib=$3 limit 1)),$5,$6,$7,$8,$9)
					 on conflict (event_id, device_id, tag, client_ms) where client_ms is not null do update set voided = excluded.voided
					   where reads.voided is distinct from excluded.voided and not reads.voided_by_admin
					 returning (xmax = 0) as inserted`, // an existing read only changes when the station voids/restores it
					[eventId, String(r.station ?? ''), r.tag, r.bib ? String(r.bib) : null, at, String(r.device_id ?? ''), r.voided === true, String(r.station ?? '').trim().slice(0, 80), r.read_at_ms]
				);
				if (res.rows[0]?.inserted) inserted++;
				else if (res.rows[0]) updated++;
				continue;
			}
			const station = String(r.station ?? '').trim().slice(0, 80);
			const device = String(r.device_id ?? '');
			const src = String(r.src ?? '').slice(0, 100);
			const voided = r.voided === true;
			// The same read already stored? With an identity (src) it must match exactly, or be a row stored before identities
			// existed at the same station. Without one (file upload, older station app) device + time + tag decide, as before.
			const [old] = (
				await c.query(
					`select id, src, voided, voided_by_admin from reads
					 where event_id=$1 and device_id=$2 and read_at_ms=$3 and tag=$4
					   and (src=$5 or $5='' or (src='' and lower(station_name_sent)=lower($6)))
					 order by (src=$5) desc, (lower(station_name_sent)=lower($6)) desc limit 1`,
					[eventId, device, r.read_at_ms, r.tag, src, station]
				)
			).rows;
			if (old) {
				const adopt = src !== '' && old.src === '';
				const flip = old.voided !== voided && !old.voided_by_admin; // an existing read only changes when the station voids/restores it
				if (adopt || flip) await c.query('update reads set src=$2, voided=$3 where id=$1', [old.id, adopt ? src : old.src, flip ? voided : old.voided]);
				if (flip) updated++;
				continue;
			}
			// station matched by name (case-insensitive); unknown/blank -> null, still stored. The runner: the central app's own
			// tag mapping first (a station's roster copy can be stale), then the bib the station sent, then a bib typed as the tag.
			const res = await c.query(
				`insert into reads(event_id, station_id, tag, bib, read_at_ms, device_id, voided, station_name_sent, src)
				 values($1,(select id from stations where event_id=$1 and lower(name)=lower($2)),$3,
				        coalesce((select bib from participants where event_id=$1 and tag<>'' and upper(tag)=upper($3) limit 1),$4,(select bib from participants where event_id=$1 and bib=$3 limit 1)),$5,$6,$7,$2,$8)
				 on conflict do nothing returning id`,
				[eventId, station, r.tag, r.bib ? String(r.bib) : null, r.read_at_ms, device, voided, src]
			);
			if (res.rows[0]) inserted++;
		}
		await c.query('commit');
		if (updated) await pool.query("select pg_notify('reads', $1)", [String(eventId)]); // the insert trigger covers new reads, not a void or restore
		return { received: reads.length, inserted, updated, duplicates: reads.length - inserted - updated };
	} catch (err) {
		await c.query('rollback');
		throw err;
	} finally {
		c.release();
	}
}
