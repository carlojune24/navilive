import { describe, expect, it } from 'vitest';
import { parseBibs, parseCsv } from './import';

describe('parseBibs', () => {
	it('expands ranges, keeps literals and leading zeros', () => {
		expect(parseBibs('101-103, 205\nA7\n001-002').bibs).toEqual(['101', '102', '103', '205', 'A7', '001', '002']);
	});
	it('rejects reversed and oversized ranges', () => {
		expect(parseBibs('5-1').errors).toHaveLength(1);
		expect(parseBibs('1-999999').errors).toHaveLength(1);
	});
});

describe('parseCsv', () => {
	it('reads full detail, gender and age as fields, and keeps other columns as extra', () => {
		const r = parseCsv('bib,name,category,tag,gender,age,team\n101,"Doe, Jane",10K,0000000001,Female,34,Runners');
		expect(r.rows[0]).toMatchObject({ bib: '101', name: 'Doe, Jane', category: '10K', tag: '0000000001', gender: 'F', age: 34, extra: { team: 'Runners' } });
	});
	it('accepts "sex" as the gender header and M/male/men variants', () => {
		const r = parseCsv('bib,sex\n1,m\n2,MALE\n3,Women\n4,x');
		expect(r.rows.map((x) => x.gender)).toEqual(['M', 'M', 'F', '']);
		expect(r.errors).toHaveLength(1); // "x" is reported, row still imported
	});
	it('reports an unreadable age but still imports the row', () => {
		const r = parseCsv('bib,age\n1,abc\n2,0\n3,200\n4, 45 ');
		expect(r.rows.map((x) => x.age)).toEqual([null, null, null, 45]);
		expect(r.errors).toHaveLength(3);
	});
	it('reports missing bib header, empty and duplicate bibs', () => {
		expect(parseCsv('name\nx').errors[0]).toMatch(/bib/);
		const r = parseCsv('bib,name\n1,a\n,b\n1,c');
		expect(r.rows).toHaveLength(1);
		expect(r.errors).toHaveLength(2);
	});
	it('handles semicolon delimiter', () => {
		expect(parseCsv('bib;name\n7;Al').rows[0].name).toBe('Al');
	});
});

import { toCsv } from './csv';
describe('toCsv', () => {
	it('quotes, escapes and defuses formulas', () => {
		expect(toCsv([['a,b', 'say "hi"', '=SUM(1)', 5, null]])).toBe('﻿"a,b","say ""hi""",\'=SUM(1),5,\r\n');
	});
});
