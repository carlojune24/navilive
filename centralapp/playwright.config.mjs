// Browser tests (npm run test:pw). They drive the real app on port 5199 against the racecentral_e2e database, see e2e/README.md.
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '*.pw.mjs',
	workers: 1,
	timeout: 60_000,
	use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
	webServer: { command: 'npx vite dev --mode e2e --port 5199 --strictPort', url: 'http://localhost:5199/login', reuseExistingServer: true, timeout: 120_000 }
});
