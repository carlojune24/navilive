import { PUBLIC_URL } from '$app/env/private';
import { lanAddresses } from '$lib/server/network';

export const load = ({ url }) => ({
	port: process.env.PORT ?? (url.port || '3000'),
	addresses: lanAddresses(),
	publicUrl: PUBLIC_URL ?? null
});
