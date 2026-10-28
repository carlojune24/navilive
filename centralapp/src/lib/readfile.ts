// Reads from a station app export file (reads CSV, all-reads JSON, or the station "merge" JSON) -> the shape the reads API takes.
// The duplicate check on the server is (event, device, read time, tag), so those must come through EXACTLY as the live upload sent them.
import { splitLine } from './import';

export type FileRead = { tag: string; bib: string | null; station: string; read_at_ms: number; device_id: string; voided: boolean; src: string };

const MAX_ROWS = 50_000;

// the station app's CSV writer prefixes a quote to cells starting with = + - @; undo it so the tag matches the live upload
const unquote = (s: string) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

function fromObject(o: Record<string, unknown>): FileRead | string {
	const tag = unquote(String(o.tag ?? '').trim());
	const t = Number(o.read_at_ms ?? o.time_ms ?? o.epoch_ms);
	const dev = o.device_id ?? o.device;
	if (!tag) return 'a read has no tag';
	if (!Number.isFinite(t) || t <= 0) return `tag ${tag}: bad read time`;
	if (dev === undefined || dev === null) return 'the file has no device column, so duplicates cannot be detected safely';
	const bib = String(o.bib ?? '').trim();
	return {
		tag,
		bib: bib || null,
		station: String(o.station ?? '').trim(),
		read_at_ms: Math.round(t),
		device_id: unquote(String(dev)),
		// the station "merge" export carries the read's own identity, the same one the live upload sends
		src: o.boot_id !== undefined && o.seq !== undefined ? `${o.boot_id}:${o.seq}` : '',
		voided: o.voided === true || o.voided === 1 || o.voided === 'true' || o.voided === '1'
	};
}

/** Strict: one bad row rejects the whole file, so a half-understood file never uploads. */
export function parseReadsFile(name: string, text: string): { reads: FileRead[]; error?: string } {
	let rows: Record<string, unknown>[];
	const clean = text.replace(/^﻿/, '');
	if (name.toLowerCase().endsWith('.json') || clean.trimStart().startsWith('{')) {
		let doc: any;
		try {
			doc = JSON.parse(clean);
		} catch {
			return { reads: [], error: 'Not a valid JSON file' };
		}
		const list = doc?.reads ?? doc?.passings;
		if (!Array.isArray(list)) return { reads: [], error: 'No "reads" list found. Use the station app export: Results → Export → All reads, or Setup → Export this station.' };
		rows = list;
	} else {
		const lines = clean.split(/\r?\n/).filter((l) => l.trim());
		if (lines.length < 2) return { reads: [], error: 'The file has no rows' };
		const head = splitLine(lines[0], ',').map((h) => h.trim().toLowerCase());
		if (!head.includes('tag') || !head.includes('epoch_ms')) return { reads: [], error: 'Header row needs "epoch_ms" and "tag" columns (the station app reads CSV)' };
		rows = lines.slice(1).map((l) => Object.fromEntries(splitLine(l, ',').map((c, i) => [head[i], c])));
	}
	if (!rows.length) return { reads: [], error: 'The file has no reads' };
	if (rows.length > MAX_ROWS) return { reads: [], error: `Too many rows (max ${MAX_ROWS})` };
	const reads: FileRead[] = [];
	for (const [i, r] of rows.entries()) {
		const x = fromObject(r ?? {});
		if (typeof x === 'string') return { reads: [], error: `Row ${i + 1}: ${x}` };
		reads.push(x);
	}
	return { reads };
}
