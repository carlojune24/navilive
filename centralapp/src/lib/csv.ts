/** CSV with a leading BOM (Excel) and a guard so cells starting with = + - @ are not run as formulas. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
	const cell = (v: string | number | null | undefined) => {
		let s = v === null || v === undefined ? '' : String(v);
		if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
		return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
