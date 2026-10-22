import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	// maplibre is only reached through a dynamic import, so Vite discovers it when the map is first
	// opened and re-optimizes mid-session; pre-bundling keeps that off the race-day path
	optimizeDeps: { include: ['maplibre-gl'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// adapter-node assumes https otherwise, which makes admin form posts look cross-site. Build with PUBLIC_URL set when hosted
			// (e.g. https://navilive.duckdns.org); on a laptop it falls back to http://localhost:3000.
			...(command === 'build' ? { paths: { origin: process.env.PUBLIC_URL?.replace(/\/+$/, '') || 'http://localhost:3000' } } : {}),
			alias: { $lib: 'src/lib' }
		})
	]
}));
