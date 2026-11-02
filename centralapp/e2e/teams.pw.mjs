// Relay / duo: the client's per-runner listing is imported through the admin UI, then runners are read by their own tags.
// A team is FINISHED only when every member has crossed; the public board shows the team name while racing and the runners once released.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8');
const DB_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const PASSWORD = env.match(/^ADMIN_PASSWORD=(.+)$/m)[1].trim();
if (!/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('.env.e2e must point at a database whose name ends in _e2e');

const slug = `pw-teams-${Date.now()}`;
const key = `rk_pw_${Date.now()}`;
const T0 = Date.now() - 3_600_000; // the race started an hour ago
const db = new pg.Client({ connectionString: DB_URL });

// the client's listing: no bib, no tags, one row per runner
const CLIENT_CSV = `Bib,First Name,Last Name,Team Name,Email,Phone,DOB,Gender,T-Shirt,Category,Tier
,Eric,Zamora,CROSSFIT CRANIUM,e@x.com,9175240028,1984-03-21,male,M,RELAY,Full
,Cris,Jay A. Gonzales,CROSSFIT CRANIUM,c@x.com,9175240028,1984-03-21,male,L,RELAY,Full
,Karrel,Jones R. Catalino,CROSSFIT CRANIUM,k@x.com,9175240028,1984-03-21,male,M,RELAY,Full
,Jayvee,Tyron Lim Uy,Davao Durian Strong,t@x.com,+639177079989,1985-05-08,male,M,DUO,Full
,Kevin,Ryan Tan,Davao Durian Strong,k@x.com,+639177079989,1986-05-08,male,XL,DUO,Full
`;
// the same listing again with a tag per runner, filled in on race eve
const tagged = CLIENT_CSV.split('\n')
	.map((l, i) => (i === 0 ? l + ',Tag' : l ? l + ',TAG' + i : l))
	.join('\n');

const api = (path, body) =>
	fetch(`http://localhost:5199/api/events/${slug}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
const reads = (items) => api('/reads', { reads: items.map(([tag, station, at]) => ({ tag, station, read_at_ms: T0 + at, device_id: 'ESP-' + station, voided: false, bib: null })) });

test.beforeAll(async () => {
	await db.connect();
	const [ev] = (await db.query('insert into events(name, slug, api_key_hash, api_key, published) values($1,$2,$3,$4,true) returning id', ['PW Teams', slug, createHash('sha256').update(key).digest('hex'), key])).rows;
	await db.query("insert into stations(event_id,name,kind,ord) values($1,'Start','start',0),($1,'CP1','checkpoint',1),($1,'Finish','finish',2)", [ev.id]);
	await db.query("insert into categories(event_id,name) values($1,'RELAY'),($1,'DUO')", [ev.id]);
});
test.afterAll(async () => {
	if (process.env.E2E_KEEP !== '1') await db.query('delete from events where slug=$1', [slug]);
	await db.end();
});

async function importCsv(page, csv) {
	await page.goto(`/admin/${slug}`, { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Import participants' }).click();
	await page.getByRole('button', { name: 'Full detail (CSV)' }).click();
	await page.locator('#cat2').selectOption('keep');
	await page.locator('#csv').fill(csv);
	await page.getByRole('button', { name: 'Import CSV' }).click();
}

test('relay and duo: import the client file, track members by tag, finish only when all cross', async ({ page }) => {
	// admin login
	await page.goto('/login');
	await page.locator('input[name=password]').fill(PASSWORD);
	await page.getByRole('button').first().click();
	await page.waitForURL(/\/admin/);

	// 1. import the client's file as it is
	await importCsv(page, CLIENT_CSV);
	await expect(page.getByText('Imported 2 teams (5 runners)')).toBeVisible();
	let teams = (await db.query("select p.bib, p.name, c.name as cat, (select count(*)::int from team_members m where m.participant_id=p.id) as n from participants p join categories c on c.id=p.category_id where p.event_id=(select id from events where slug=$1) order by p.bib", [slug])).rows;
	expect(teams.map((t) => [t.name, t.cat, t.n])).toEqual([['CROSSFIT CRANIUM', 'RELAY', 3], ['Davao Durian Strong', 'DUO', 2]]);
	expect(teams[0].bib).not.toBe(teams[1].bib);
	const [relayBib, duoBib] = teams.map((t) => t.bib);

	// 2. importing again with tags updates the same teams (no new bibs, no duplicate members)
	await importCsv(page, tagged);
	await expect(page.getByText('Imported 2 teams (5 runners)')).toBeVisible();
	teams = (await db.query("select p.bib, (select count(*)::int from team_members m where m.participant_id=p.id) as n from participants p where p.event_id=(select id from events where slug=$1) order by p.bib", [slug])).rows;
	expect(teams).toEqual([{ bib: relayBib, n: 3 }, { bib: duoBib, n: 2 }]);
	const tags = (await db.query('select m.name, m.tag from team_members m join events e on e.id=m.event_id where e.slug=$1 order by m.id', [slug])).rows;
	expect(tags.map((t) => t.tag)).toEqual(['TAG1', 'TAG2', 'TAG3', 'TAG4', 'TAG5']);
	// a tag already used by someone else is refused, nothing half-imported
	await importCsv(page, 'Team Name,First Name,Category,Tag\nNew Team,Zed,DUO,TAG1');
	await expect(page.getByText(/already (used|assigned)/)).toBeVisible();
	await page.keyboard.press('Escape');

	// 3. everyone starts; the duo's first runner crosses the finish
	expect((await reads([['TAG1', 'Start', 0], ['TAG2', 'Start', 100], ['TAG3', 'Start', 200], ['TAG4', 'Start', 0], ['TAG5', 'Start', 500]])).status).toBe(200);
	expect((await reads([['TAG4', 'CP1', 600_000], ['TAG4', 'Finish', 1_200_000]])).status).toBe(200);
	await page.goto(`/e/${slug}?mode=own&view=progress`);
	await page.getByRole('tab', { name: /DUO/ }).click();
	const duoRow = page.getByRole('row', { name: /Davao Durian Strong/ });
	await expect(duoRow).toBeVisible();
	await expect(duoRow).not.toContainText(/finished/i); // one of two: still racing
	await expect(duoRow).not.toContainText('Jayvee'); // runners' names are not on the live board
	await expect(duoRow).not.toContainText('Kevin');

	// the admin sees why: 1/2 at the finish
	await page.goto(`/admin/${slug}?tab=progress`);
	await page.getByRole('tab', { name: /DUO/ }).click();
	await expect(page.getByTestId('team-done')).toHaveText('1/2 at finish');

	// 4. the second runner crosses: the team is FINISHED, but results are held (no time on the public board)
	expect((await reads([['TAG5', 'Finish', 1_300_000]])).status).toBe(200);
	await page.goto(`/e/${slug}?mode=own&view=progress`);
	await page.getByRole('tab', { name: /DUO/ }).click();
	await expect(page.getByRole('row', { name: /Davao Durian Strong/ })).toContainText(/finished/i);
	await expect(page.getByRole('row', { name: /Davao Durian Strong/ })).not.toContainText('Jayvee');

	// 5. reconciled and released: results show the team, both runners, and the team time = the last runner's (1_300_000 ms: the team clock starts at the first member's start read)
	await db.query("update categories set release='released' where event_id=(select id from events where slug=$1)", [slug]);
	await page.goto(`/e/${slug}?mode=own&view=results`);
	await page.getByRole('tab', { name: /DUO/ }).click();
	await expect(page.getByText('Davao Durian Strong')).toBeVisible();
	await expect(page.getByTestId('team-runners')).toHaveText('Jayvee Tyron Lim Uy, Kevin Ryan Tan');
	await expect(page.getByText('21:40')).toBeVisible();

	// 6. the relay: only 2 of 3 cross, so it is not ranked; the third crossing finishes it
	expect((await reads([['TAG1', 'Finish', 1_000_000], ['TAG2', 'Finish', 1_100_000]])).status).toBe(200);
	await page.goto(`/e/${slug}?mode=own&view=results`);
	await page.getByRole('tab', { name: /RELAY/ }).click();
	await expect(page.getByText('CROSSFIT CRANIUM')).toHaveCount(0);
	expect((await reads([['TAG3', 'Finish', 1_400_000]])).status).toBe(200);
	await page.reload();
	await page.getByRole('tab', { name: /RELAY/ }).click();
	await expect(page.getByText('CROSSFIT CRANIUM')).toBeVisible();
	await expect(page.getByTestId('team-runners')).toHaveText('Eric Zamora, Cris Jay A. Gonzales, Karrel Jones R. Catalino');
});
