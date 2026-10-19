<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let { form } = $props();
</script>

<main class="mx-auto mt-24 max-w-sm border-2 border-border bg-card p-6">
	<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Race Central</h1>
	<form method="POST" class="mt-6 space-y-3">
		<Label for="password" class="font-bold tracking-wide uppercase">Admin password</Label>
		<Input id="password" name="password" type="password" class="h-11 border-2" autofocus required />
		{#if form?.error}<p class="font-bold text-destructive">{form.error}</p>{/if}
		<Button type="submit" class="h-11 w-full font-bold tracking-wide uppercase">Sign in</Button>
	</form>
</main>
