export type TallySheet = { category: string; batch: string; runners: { bib: string; name: string }[] };

const byBib = (a: { bib: string }, b: { bib: string }) => a.bib.localeCompare(b.bib, undefined, { numeric: true });

/** One sheet per category and batch (runners without a batch last, as "No batch"), runners by bib. Empty groups are skipped. */
export function groupTally(
	categories: { id: number; name: string }[],
	batches: { id: number; category_id: number; name: string }[],
	participants: { bib: string; name: string | null; category_id: number | null; batch_id: number | null }[]
): TallySheet[] {
	const sheets: TallySheet[] = [];
	for (const c of categories) {
		const mine = participants.filter((p) => p.category_id === c.id);
		const groups: [string, typeof mine][] = batches.filter((b) => b.category_id === c.id).map((b) => [b.name, mine.filter((p) => p.batch_id === b.id)]);
		const known = new Set(batches.filter((b) => b.category_id === c.id).map((b) => b.id));
		groups.push(['No batch', mine.filter((p) => p.batch_id === null || !known.has(p.batch_id))]);
		for (const [batch, rs] of groups)
			if (rs.length) sheets.push({ category: c.name, batch, runners: rs.map((p) => ({ bib: p.bib, name: p.name ?? '' })).sort(byBib) });
	}
	return sheets;
}
