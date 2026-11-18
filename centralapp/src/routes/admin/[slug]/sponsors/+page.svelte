<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { shrinkImage, MAX_PHOTO_BYTES } from '$lib/image';
	import { Button } from '$lib/components/ui/button/index.js';

	let { data, form } = $props();
	const lbl = 'font-bold tracking-wide uppercase';
	const small = 'border-2 border-border bg-card font-bold uppercase hover:bg-accent';

	let name = $state('');
	let url = $state('');
	let logo = $state<File | null>(null);
	let fileInput = $state<HTMLInputElement>();
	let busy = $state(false);
	let err = $state('');
	let ok = $state('');

	async function add(e: SubmitEvent) {
		e.preventDefault();
		err = ok = '';
		if (!name.trim()) return (err = 'Enter the sponsor name.');
		if (!logo) return (err = 'Choose the logo.');
		busy = true;
		try {
			// small logos go up as they are (a PNG keeps its transparent background); large ones are shrunk first
			const keepPng = logo.type === 'image/png' || logo.type === 'image/webp';
			const file = logo.size <= MAX_PHOTO_BYTES ? logo : await shrinkImage(logo, 800, keepPng ? 'image/png' : 'image/jpeg');
			const fd = new FormData();
			fd.set('name', name);
			fd.set('url', url);
			fd.set('logo', file, 'logo');
			const r = await fetch('?/add', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const res = deserialize(await r.text());
			if (res.type !== 'success') return (err = (res.type === 'failure' && (res.data as { error?: string })?.error) || 'Could not add the sponsor.');
			ok = `${name.trim()} added.`;
			name = url = '';
			logo = null;
			if (fileInput) fileInput.value = '';
			await invalidateAll();
		} catch {
			err = 'That file could not be read as an image.';
		} finally {
			busy = false;
		}
	}
</script>

<main class="max-w-3xl space-y-5 p-5">
	<header>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Sponsors</h1>
		<p class="mt-1 text-muted-foreground">Sponsor logos are shown in a strip at the bottom of the live board (also on the big screen), in this order.</p>
	</header>

	{#if form?.error}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}

	<form onsubmit={add} class="space-y-3 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Add a sponsor</h2>
		<label class="block {lbl}">Name<input bind:value={name} maxlength="120" required class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
		<label class="block {lbl}">Website <span class="font-normal normal-case text-muted-foreground">(optional; the logo links to it)</span><input bind:value={url} maxlength="500" placeholder="example.com" class="mt-1 block h-12 w-full border-2 border-border bg-background px-3 font-normal normal-case" /></label>
		<label class="block {lbl}">Logo <span class="font-normal normal-case text-muted-foreground">(PNG with a transparent background looks best)</span><input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onchange={(e) => (logo = e.currentTarget.files?.[0] ?? null)} class="mt-1 block" /></label>
		{#if err}<p class="font-bold text-destructive" role="alert">{err}</p>{/if}
		{#if ok}<p class="font-bold" role="status">{ok}</p>{/if}
		<Button type="submit" disabled={busy} class="h-11 font-bold uppercase">{busy ? 'Adding…' : 'Add sponsor'}</Button>
	</form>

	<section class="border-2 border-border bg-card">
		<h2 class="border-b-2 border-border px-4 py-2 font-display text-3xl font-black uppercase">On the live board</h2>
		<ol>
			{#each data.sponsors as s, i (s.id)}
				<li class="flex flex-wrap items-center gap-4 border-b-2 border-border/15 px-4 py-3 last:border-b-0">
					<span class="w-6 font-display text-2xl font-black">{i + 1}</span>
					<span class="flex h-16 w-32 items-center justify-center bg-white p-1"><img src="/e/{data.event.slug}/sponsor/{s.id}?v={s.v}" alt="{s.name} logo" class="max-h-full max-w-full object-contain" /></span>
					<span class="min-w-0 flex-1"><b class="block uppercase">{s.name}</b>{#if s.url}<a href={s.url} target="_blank" rel="noopener noreferrer" class="text-sm break-all text-muted-foreground underline">{s.url}</a>{/if}</span>
					<div class="flex gap-2">
						{#each [['up', 'Move up', i === 0], ['down', 'Move down', i === data.sponsors.length - 1]] as const as [dir, label, off]}
							<form method="POST" action="?/move" use:enhance>
								<input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value={dir} />
								<Button type="submit" variant="outline" size="sm" class={small} disabled={off} aria-label="{label}: {s.name}">{dir === 'up' ? '↑' : '↓'}</Button>
							</form>
						{/each}
						<form method="POST" action="?/remove" use:enhance={({ cancel }) => { if (!confirm(`Remove ${s.name} from the live board?`)) cancel(); }}>
							<input type="hidden" name="id" value={s.id} />
							<Button type="submit" variant="outline" size="sm" class={small}>Remove</Button>
						</form>
					</div>
				</li>
			{:else}
				<li class="p-4 text-muted-foreground">No sponsors yet. The live board shows no sponsor strip until you add one.</li>
			{/each}
		</ol>
	</section>
</main>
