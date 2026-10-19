import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

// bigint (reads.read_at_ms) arrives as string by default; ms timestamps fit in a JS number
pg.types.setTypeParser(20, (v) => Number(v));

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
	return (await pool.query<T>(sql, params)).rows;
}
