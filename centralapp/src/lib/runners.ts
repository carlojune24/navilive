/** Real people: a solo entry is 1, a duo/relay team is its number of runners. A team with no runners listed still counts as 1. */
export const countRunners = (entries: { members?: unknown[] | null }[]) => entries.reduce((n, p) => n + (p.members?.length || 1), 0);

/** The station app's reading of a stored hex EPC (00000000C8 -> 0000000200). Same rule as epc_to_card in perstationapp/src-tauri/src/sync.rs; keep them in step. */
export const epcToCard = (tag: string) => {
	const t = tag.trim();
	return t && /^[0-9a-f]+$/i.test(t) ? String(parseInt(t.slice(-8), 16)).padStart(10, '0') : t;
};
