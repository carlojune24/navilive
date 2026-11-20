import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';

const central = [{ name: 'Finish', rfid: 8, station_manual: 1 }];

describe('reconcile', () => {
	it('a station that says more than central holds is a shortfall', () => {
		const [r] = reconcile(central, [[{ name: 'finish', rfidCount: 10, manualCount: 1 }]]);
		expect(r).toMatchObject({ stationRfid: 10, missingRfid: 2, missingManual: 0 });
	});
	it('central holding more (marshal taps, admin entries) is not a problem', () => {
		expect(reconcile(central, [[{ name: 'Finish', rfidCount: 5, manualCount: 0 }]])[0]).toMatchObject({ missingRfid: 0, missingManual: 0 });
	});
	it('two laptops on one station use the larger count, not the sum', () => {
		expect(reconcile(central, [[{ name: 'Finish', rfidCount: 9 }], [{ name: 'Finish', rfidCount: 9 }]])[0].missingRfid).toBe(1);
	});
	it('no counts reported (older station app) is unknown, never a shortfall', () => {
		expect(reconcile(central, [[{ name: 'Finish' }], []])[0]).toEqual({ name: 'Finish', stationRfid: null, stationManual: null, missingRfid: 0, missingManual: 0 });
	});
});
