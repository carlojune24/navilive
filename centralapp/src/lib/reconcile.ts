// Does the central app hold as many reads as the station laptops say they have? A shortfall = reads not uploaded yet, or lost.
export type Reported = { name: string; rfidCount?: number | null; manualCount?: number | null };
export type Central = { name: string; rfid: number; station_manual: number };
export type Recon = { name: string; stationRfid: number | null; stationManual: number | null; missingRfid: number; missingManual: number };

/**
 * laptops: each laptop's per-station heartbeat. Two laptops may serve one station and hold the same reads, so the larger count is used, never the sum.
 * More on central than a station says is fine (marshal taps, admin entries, another laptop); only a shortfall is reported.
 * null = no laptop reported counts for that station (older station app, or none connected).
 */
export function reconcile(central: Central[], laptops: Reported[][]): Recon[] {
	const best = (name: string, key: 'rfidCount' | 'manualCount') => {
		const v = laptops.flatMap((l) => l.filter((s) => s.name.toLowerCase() === name.toLowerCase()).map((s) => s[key])).filter((n): n is number => typeof n === 'number');
		return v.length ? Math.max(...v) : null;
	};
	return central.map((c) => {
		const stationRfid = best(c.name, 'rfidCount');
		const stationManual = best(c.name, 'manualCount');
		return {
			name: c.name,
			stationRfid,
			stationManual,
			missingRfid: stationRfid === null ? 0 : Math.max(0, stationRfid - c.rfid),
			missingManual: stationManual === null ? 0 : Math.max(0, stationManual - c.station_manual)
		};
	});
}
