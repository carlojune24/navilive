<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { shrinkImage, MAX_PHOTO_BYTES } from '$lib/image';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let { data, form } = $props();
	let busy = $state(false);
	let logoBusy = $state(false);
	let logoErr = $state('');

	// same as a sponsor logo: small files go up as they are, large ones are shrunk first
	async function uploadLogo(e: Event & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const logo = input.files?.[0];
		if (!logo) return;
		logoErr = '';
		logoBusy = true;
		try {
			const keepPng = logo.type === 'image/png' || logo.type === 'image/webp';
			const fd = new FormData();
			fd.set('logo', logo.size <= MAX_PHOTO_BYTES ? logo : await shrinkImage(logo, 800, keepPng ? 'image/png' : 'image/jpeg'), 'logo');
			const res = deserialize(await (await fetch('?/logo', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } })).text());
			if (res.type !== 'success') logoErr = (res.type === 'failure' && (res.data as { error?: string })?.error) || 'Could not save the logo.';
			else await invalidateAll();
		} catch {
			logoErr = 'That file could not be read as an image.';
		} finally {
			input.value = '';
			logoBusy = false;
		}
	}
	const lbl = 'font-bold tracking-wide uppercase';
</script>

<main class="max-w-xl space-y-5 p-5">
	<header>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Settings</h1>
	</header>

	<section class="space-y-3 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Logo</h2>
		<p class="text-muted-foreground">Shown at the top right of every live board (also on the big screen). Open boards show a new logo when reloaded.</p>
		{#if data.logoV}<span class="flex h-20 w-48 items-center justify-center bg-white p-1"><img src="/logo?v={data.logoV}" alt="Current logo" class="max-h-full max-w-full object-contain" /></span>{/if}
		<label class="block {lbl}">{data.logoV ? 'Replace logo' : 'Upload logo'} <span class="font-normal normal-case text-muted-foreground">(PNG with a transparent background looks best)</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={logoBusy} onchange={uploadLogo} class="mt-1 block" /></label>
		{#if logoErr}<p class="font-bold text-destructive" role="alert">{logoErr}</p>{/if}
		{#if data.logoV}
			<form method="POST" action="?/removeLogo" use:enhance={({ cancel }) => { if (!confirm('Remove the logo from the live boards?')) cancel(); }}>
				<Button type="submit" variant="outline" class="h-11 border-2 font-bold uppercase">Remove logo</Button>
			</form>
		{/if}
	</section>

	<section class="space-y-3 border-2 border-border bg-card p-4">
		<h2 class="font-display text-3xl font-black uppercase">Live board theme</h2>
		<p class="text-muted-foreground">The colours of every live board. Open boards change when reloaded.</p>
		<form method="POST" action="?/theme" use:enhance class="flex flex-wrap gap-3">
			{#each [['default', 'Bib (light)', ['#f1f3f6', '#26272e', '#ffffff', '#c0392b']], ['grit', 'Grit Rush (dark)', ['#101116', '#21003d', '#7925c7', '#39ff14']]] as const as [id, label, sw]}
				<button type="submit" name="theme" value={id} class="flex items-center gap-3 border-2 px-3 py-2 font-bold uppercase {data.theme === id ? 'border-border bg-primary text-primary-foreground' : 'border-border hover:bg-accent'}" aria-pressed={data.theme === id}>
					<span class="flex">{#each sw as c}<span class="size-6 border border-black/30" style="background:{c}"></span>{/each}</span>{label}
				</button>
			{/each}
		</form>
		{#if form?.themeSaved}<p class="font-bold" role="status">Theme saved.</p>{/if}
	</section>

	<h2 class="font-display text-3xl font-black uppercase">Admin password</h2>

	{#if form?.changed}
		<p class="border-2 border-border bg-card p-3 font-bold" role="status">Password changed. Any other signed-in browsers have been signed out.</p>
	{/if}
	{#if form?.error}<p class="border-2 border-destructive p-3 font-bold text-destructive" role="alert">{form.error}</p>{/if}

	<form
		method="POST"
		action="?/change"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update(); // clears the fields after a success
				busy = false;
			};
		}}
		class="space-y-4 border-2 border-border bg-card p-4"
	>
		<div>
			<Label class={lbl} for="cur">Current password</Label>
			<Input id="cur" name="current" type="password" autocomplete="current-password" class="h-11 border-2" required />
		</div>
		<div>
			<Label class={lbl} for="new">New password</Label>
			<Input id="new" name="next" type="password" autocomplete="new-password" minlength={10} class="h-11 border-2" required />
			<p class="mt-1 text-sm text-muted-foreground">At least 10 characters. A few random words make a strong, easy-to-remember password.</p>
		</div>
		<div>
			<Label class={lbl} for="again">New password again</Label>
			<Input id="again" name="again" type="password" autocomplete="new-password" class="h-11 border-2" required />
		</div>
		<Button type="submit" disabled={busy} class="h-11 font-bold uppercase">Change password</Button>
	</form>

	<p class="text-muted-foreground">
		The new password is stored scrambled (hashed) in the database. Once changed, the <code>ADMIN_PASSWORD</code> in the server's <code>.env</code> is no longer used.
		If you ever forget it, a person with access to the server can reset it (see the README, "Forgot the admin password").
	</p>
</main>
