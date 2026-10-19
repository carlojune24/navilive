import type { Laptop } from '$lib/server/monitor';

// Latest monitor snapshot pushed over the live stream. null = "use what the page loaded".
export const monitor = $state<{ laptops: Laptop[] | null; stationData: { stations: any[]; unknown: any[] } | null; connected: boolean }>({ laptops: null, stationData: null, connected: false });
