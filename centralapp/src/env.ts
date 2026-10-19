import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {},
	ADMIN_PASSWORD: {},
	// Set when the app is hosted, e.g. https://navilive.duckdns.org. Unset = running on a laptop (LAN addresses are shown instead).
	PUBLIC_URL: { schema: (v) => v?.trim().replace(/\/+$/, '') || undefined }
});
