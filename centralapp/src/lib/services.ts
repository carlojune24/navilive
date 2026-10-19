// What a station offers runners; the key is stored in stations.services.
export const SERVICES = [
	{ key: 'meal', label: 'Aid station with warm meal' },
	{ key: 'water', label: 'Water & drinks' },
	{ key: 'products', label: 'Nutrition products' },
	{ key: 'emergency', label: 'Emergency' },
	{ key: 'rest', label: 'Rest area' },
	{ key: 'wc', label: 'WC' },
	{ key: 'dropbag', label: 'Spare bag' },
	{ key: 'shower', label: 'Shower' },
	{ key: 'power', label: 'Power supply' }
] as const;
export const SERVICE_KEYS: string[] = SERVICES.map((s) => s.key);
