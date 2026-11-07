// Bib list: the organizer's printable checklist, one row per runner (team members expanded under the team's bib), sorted by bib.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8');
const DB_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const PASSWORD = env.match(/^ADMIN_PASSWORD=(.+)$/m)[1].trim();
if (!/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('.env.e2e must point at a database whose name ends in _e2e');

const slug = `pw-bibs-${Date.now()}`;
const key = `rk_pw_${Date.now()}`;
const db = new pg.Client({ connectionString: DB_URL });

test.beforeAll(async () => {
	await db.connect();
	const [ev] = (await db.query('insert into events(name, slug, api_key_hash, api_key) values($1,$2,$3,$4) returning id', ['PW Bibs', slug, createHash('sha256').update(key).digest('hex'), key])).rows;
	const [duo] = (await db.query("insert into categories(event_id,name) values($1,'DUO') returning id", [ev.id])).rows;
	const [team] = (await db.query("insert into participants(event_id,category_id,bib,name) values($1,$2,'D200','Young Guns') returning id", [ev.id, duo.id])).rows;
	await db.query("insert into participants(event_id,category_id,bib,name) values($1,$2,'D10','Solo Runner')", [ev.id, duo.id]);
	await db.query("insert into team_members(event_id,participant_id,name,leg) values($1,$2,'Aaron James Awa',0),($1,$2,'Marlon Palma Gil',1)", [ev.id, team.id]);
});
test.afterAll(async () => {
	if (process.env.E2E_KEEP !== '1') await db.query('delete from events where slug=$1', [slug]);
	await db.end();
});

test('bib list: one checkbox row per runner, team members share their bib', async ({ page }) => {
	await page.goto('/login');
	await page.locator('input[name=password]').fill(PASSWORD);
	await page.getByRole('button').first().click();
	await page.waitForURL(/\/admin/);

	await page.goto(`/admin/${slug}?tab=bibs`);
	await expect(page.getByRole('button', { name: 'Print bib list' })).toBeEnabled();
	const rows = page.locator('section tbody tr');
	await expect(rows).toHaveCount(3);
	// sorted by bib numerically (D10 before D200); both duo members listed under D200
	await expect(rows.nth(0)).toContainText('D10');
	await expect(rows.nth(1)).toContainText('D200');
	await expect(rows.nth(1)).toContainText('AARON JAMES AWA', { ignoreCase: true });
	await expect(rows.nth(2)).toContainText('D200');
	await expect(rows.nth(2)).toContainText('MARLON PALMA GIL', { ignoreCase: true });
	await expect(page.getByText('3 runners')).toBeVisible();
});
