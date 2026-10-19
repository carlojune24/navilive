<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let { form } = $props();
	let busy = $state(false);
	const lbl = 'font-bold tracking-wide uppercase';
</script>

<main class="max-w-xl space-y-5 p-5">
	<header>
		<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Admin password</h1>
		<p class="mt-1 text-muted-foreground">Change the password used to sign in to this admin.</p>
	</header>

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
