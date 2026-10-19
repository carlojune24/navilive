import { describe, expect, it } from 'vitest';
import { parseReadsFile } from './readfile';

const CSV = 'epoch_ms,station,bib,runner,tag,device,seq,voided,exact_time,note\n1760000000123,Checkpoint1,3,Ivan,AB12,MANUAL,1,false,true,\n1760000001000,"Check, 2",,,\'-5,R1,2,true,true,\n';

describe('parseReadsFile', () => {
	it('reads the station app CSV with the exact device, time and tag the live upload sends', () => {
		const { reads, error } = parseReadsFile('reads.csv', CSV);
		expect(error).toBeUndefined();
		expect(reads[0]).toEqual({ tag: 'AB12', bib: '3', station: 'Checkpoint1', read_at_ms: 1760000000123, device_id: 'MANUAL', voided: false });
		expect(reads[1]).toMatchObject({ tag: '-5', station: 'Check, 2', bib: null, device_id: 'R1', voided: true }); // formula-guard quote removed
	});
	it('reads both JSON exports', () => {
		const merge = JSON.stringify({ format: 'race-tracker-reads-v1', reads: [{ device_id: 'D', tag: 'T', read_at_ms: 5, station: null, voided: 0 }] });
		const all = JSON.stringify({ reads: [{ device: 'D', tag: 'T', time_ms: 5, station: 'S', bib: '9', voided: true }] });
		expect(parseReadsFile('a.json', merge).reads[0]).toMatchObject({ device_id: 'D', tag: 'T', read_at_ms: 5, station: '', voided: false });
		expect(parseReadsFile('b.json', all).reads[0]).toMatchObject({ device_id: 'D', bib: '9', voided: true });
	});
	it('rejects the whole file rather than guess: no device column, bad time, wrong file', () => {
		expect(parseReadsFile('x.csv', 'epoch_ms,tag\n5,A\n').error).toMatch(/device/);
		expect(parseReadsFile('x.csv', 'epoch_ms,tag,device\nsoon,A,D\n').error).toMatch(/bad read time/);
		expect(parseReadsFile('x.csv', 'name,age\nBob,3\n').error).toMatch(/epoch_ms/);
		expect(parseReadsFile('x.json', '{"runners":[]}').error).toMatch(/reads/);
	});
});
