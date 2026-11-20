/** Real people: a solo entry is 1, a duo/relay team is its number of runners. A team with no runners listed still counts as 1. */
export const countRunners = (entries: { members?: unknown[] | null }[]) => entries.reduce((n, p) => n + (p.members?.length || 1), 0);
