// One runner's read trail along their course: every read (voided ones too), which one counts, and what looks wrong.
export type Source = 'rfid' | 'station_manual' | 'admin_manual' | 'marshal';
export type TrailRead = { id: number; station_id: number | null; read_at_ms: number; ingested_ms: number | null; device_id: string; source: Source; voided: boolean; key_label?: string | null };
/** rfid = only the reader saw them, hand = only a person tapped/typed them, both = either way, none = no live read */
export type Coverage = 'rfid' | 'hand' | 'both' | 'none';
export type Slot = { station_id: number; reads: TrailRead[]; counted: TrailRead | null; by: Source[]; coverage: Coverage };
export type Flag = 'order' | 'gap' | 'duplicate' | 'manual' | 'miss' | 'fast';
export type Trail = { slots: Slot[]; flags: Flag[]; stray: TrailRead[] };

export const isManual = (s: Source) => s !== 'rfid';
export const SOURCE_LABEL: Record<Source, string> = { rfid: 'RFID', station_manual: 'Station tap', admin_manual: 'Admin entry', marshal: 'Marshal tap' };
/** The label for a read type as stored, plus 'override' (a finish time the admin corrected, which is not a read). Unknown keys show as is. */
export const sourceLabel = (key: string | null | undefined) => (key === 'override' ? 'Override' : key ? (SOURCE_LABEL[key as Source] ?? key) : '');
export const FAST_SPLIT_MS = 1000; // two checkpoints closer than this cannot both be a real crossing

/** course: the runner's station ids in order. Reads at a station outside the course (or none) are `stray`. The counted read is the earliest one not voided. */
export function buildTrail(course: number[], reads: TrailRead[]): Trail {
	const slots: Slot[] = course.map((station_id) => {
		const mine = reads.filter((r) => r.station_id === station_id).sort((a, b) => a.read_at_ms - b.read_at_ms);
		const live = mine.filter((r) => !r.voided);
		const rfid = live.some((r) => r.source === 'rfid');
		const hand = live.some((r) => isManual(r.source));
		return { station_id, reads: mine, counted: live[0] ?? null, by: [...new Set(live.map((r) => r.source))], coverage: rfid && hand ? 'both' : rfid ? 'rfid' : hand ? 'hand' : 'none' };
	});
	const flags: Flag[] = [];
	const lastSeen = slots.map((s) => s.counted !== null).lastIndexOf(true);
	if (slots.slice(0, lastSeen).some((s) => !s.counted)) flags.push('gap'); // a checkpoint before the last one seen has nothing
	const times = slots.flatMap((s) => (s.counted ? [s.counted.read_at_ms] : []));
	if (times.some((t, i) => i && t < times[i - 1])) flags.push('order');
	if (times.some((t, i) => i && t >= times[i - 1] && t - times[i - 1] < FAST_SPLIT_MS)) flags.push('fast');
	if (slots.some((s) => s.reads.filter((r) => !r.voided).length > 1)) flags.push('duplicate');
	if (slots.some((s) => s.counted && isManual(s.counted.source))) flags.push('manual');
	// shortcut: a station with no reader at all (a marshal checkpoint) also shows as hand only; add a per-station "has reader" flag if that is noisy
	if (slots.some((s) => s.coverage === 'hand')) flags.push('miss');
	const inCourse = new Set(course);
	return { slots, flags, stray: reads.filter((r) => r.station_id === null || !inCourse.has(r.station_id)) };
}
