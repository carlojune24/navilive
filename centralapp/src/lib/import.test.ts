import { describe, expect, it } from 'vitest';
import { parseBibs, parseCsv, parseTeamCsv, isTeamCsv } from './import';

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
		expect(r.errors).toHaveLength(2);
		// a shared bib is kept (second becomes 1-2) and both are flagged
		expect(r.rows.map((x) => [x.bib, x.extra['bib flag']])).toEqual([['1', 'shared bib 1, change it'], ['1-2', 'shared bib 1, change it']]);
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

describe('parseTeamCsv (client relay/duo listing)', () => {
	const csv = `Bib,First Name,Last Name,Team Name,Email,Phone,DOB,Gender,Category
,Eric,Zamora,CROSSFIT CRANIUM,e@x.com,917,1984-03-21,male,RELAY
,Cris,Jay A. Gonzales,crossfit cranium,c@x.com,917,1990-01-01,male,RELAY
,Jayvee,Uy,Davao Durian Strong,t@x.com,917,1985-05-08,male,DUO
,Kevin,Tan,Davao Durian Strong,k@x.com,917,1986-05-08,male,DUO`;
	it('detects the client file and groups runners by category + team name', () => {
		expect(isTeamCsv(csv)).toBe(true);
		expect(isTeamCsv('bib,name\n1,x')).toBe(false);
		const { teams, errors } = parseTeamCsv(csv, new Date('2026-11-01'));
		expect(errors).toEqual([]);
		expect(teams.map((t) => [t.team, t.category, t.members.map((m) => m.name)])).toEqual([
			['CROSSFIT CRANIUM', 'RELAY', ['Eric Zamora', 'Cris Jay A. Gonzales']],
			['Davao Durian Strong', 'DUO', ['Jayvee Uy', 'Kevin Tan']]
		]);
		expect(teams[0].members[0]).toMatchObject({ gender: 'M', age: 42, extra: { email: 'e@x.com', phone: '917' } });
	});
	it('reads the SOLO / DUO sheets: solo stays solo, duo groups by bib, age from Age or DOB', () => {
		const solo = 'Bib,First Name,Last Name,Role,DOB,Age,Gender,Team Name,Age Group\nS177,Zeny,fe Sopoco,Solo,1996-10-28,30,female,Garage Training,30-34\nS181,Kyrr,Justino Zerrudo,Solo,2000-03-05,,male,,25-29';
		expect(isTeamCsv(solo)).toBe(false);
		const s = parseCsv(solo, new Date('2026-11-01'));
		expect(s.errors).toEqual([]);
		expect(s.rows[0]).toMatchObject({ bib: 'S177', name: 'Zeny fe Sopoco', gender: 'F', age: 30, extra: { 'team name': 'Garage Training', 'age group': '30-34' } });
		expect(s.rows[1].age).toBe(26);
		const duo = 'Bib,First Name,Last Name,Role,DOB,Age,Gender,Team Name\nD136,Gelo,Cagape,Captain,1997-08-28,29,male,\nD136,Jose,Carlo Cagape,Teammate,1992-06-20,34,male,\nD184,Ryan,Bonete,Captain,1989-04-11,37,male,TEAM ULTRA\nD184,Aljon,Mar Omandac,Teammate,1989-04-11,,male,TEAM ULTRA';
		expect(isTeamCsv(duo)).toBe(true);
		const d = parseTeamCsv(duo, new Date('2026-11-01'));
		expect(d.errors).toEqual([]);
		expect(d.teams.map((t) => [t.bib, t.team, t.members.map((m) => [m.name, m.age])])).toEqual([
			['D136', 'D136', [['Gelo Cagape', 29], ['Jose Carlo Cagape', 34]]],
			['D184', 'TEAM ULTRA', [['Ryan Bonete', 37], ['Aljon Mar Omandac', 37]]]
		]);
	});
	it('rejects duplicate tags and duplicate runners', () => {
		const r = parseTeamCsv('Team Name,First Name,Tag\nA,x,T1\nA,y,t1\nA,x,');
		expect(r.errors).toHaveLength(2);
		expect(r.teams[0].members).toHaveLength(1);
	});
});
