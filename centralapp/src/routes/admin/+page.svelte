<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { data, form } = $props();
</script>

<main class="max-w-3xl space-y-6 p-5">
	<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Events</h1>

	<form method="POST" action="?/create" class="flex flex-wrap gap-2 border-2 border-border bg-card p-4">
		<Input name="name" placeholder="Event name" class="h-11 min-w-56 flex-1 border-2" required />
		<Input name="date" type="date" class="h-11 w-44 border-2" />
		<Button type="submit" class="h-11 font-bold tracking-wide uppercase">Create event</Button>
		{#if form?.error}<p class="w-full font-bold text-destructive">{form.error}</p>{/if}
	</form>

	<ul class="divide-y-2 divide-border border-2 border-border bg-card">
		{#each data.events as e (e.id)}
			<li>
				<a href="/admin/{e.slug}" class="flex items-baseline justify-between p-4 hover:bg-accent">
					<span class="text-2xl font-bold uppercase">{e.name}</span>
					<span class="text-muted-foreground">{e.date ? new Date(e.date).toLocaleDateString() : ''}</span>
				</a>
			</li>
		{:else}
			<li class="p-4 text-muted-foreground">No events yet. Create the first one above.</li>
		{/each}
	</ul>
</main>
