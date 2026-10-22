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
			<li class="flex flex-wrap items-center gap-3 pr-4">
				<a href="/admin/{e.slug}" class="flex flex-1 flex-wrap items-baseline justify-between gap-3 p-4 hover:bg-accent">
					<span class="text-2xl font-bold uppercase">{e.name}</span>
					<span class="text-muted-foreground">{e.date ? new Date(e.date).toLocaleDateString() : ''}</span>
				</a>
				<span class="font-bold uppercase {e.published ? 'text-start' : 'text-muted-foreground'}" title={e.published ? 'The live board is open to everyone' : 'The live board is hidden; only you can see it'}>{e.published ? 'Live' : 'Draft'}</span>
				<form method="POST" action="?/publish">
					<input type="hidden" name="id" value={e.id} />
					<input type="hidden" name="published" value={e.published ? 'false' : 'true'} />
					<Button type="submit" variant="outline" class="h-11 border-2 font-bold uppercase">{e.published ? 'Unpublish' : 'Publish'}</Button>
				</form>
			</li>
		{:else}
			<li class="p-4 text-muted-foreground">No events yet. Create the first one above.</li>
		{/each}
	</ul>
</main>
