<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let { data, form } = $props();
	let copy = $state<{ id: number; name: string; date: string } | null>(null); // the event being duplicated
	let copyError = $state('');
	let del = $state<{ id: number; name: string } | null>(null); // the archived event waiting for "delete?" confirmation
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
				<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => ((copyError = ''), (copy = { id: e.id, name: `${e.name} copy`, date: '' }))}>Duplicate</Button>
				<form method="POST" action="?/archive">
					<input type="hidden" name="id" value={e.id} />
					<Button type="submit" variant="outline" class="h-11 border-2 font-bold uppercase" title="Hide this event from the list and the public board. You can restore it.">Archive</Button>
				</form>
			</li>
		{:else}
			<li class="p-4 text-muted-foreground">No events yet. Create the first one above.</li>
		{/each}
	</ul>

	{#if data.archived.length}
		<section class="space-y-2">
			<h2 class="font-display text-3xl leading-none font-black uppercase">Archived ({data.archived.length})</h2>
			<ul class="divide-y-2 divide-border border-2 border-border bg-card">
				{#each data.archived as e (e.id)}
					<li class="flex flex-wrap items-center gap-3 p-4">
						<a href="/admin/{e.slug}" class="flex-1 text-xl font-bold text-muted-foreground uppercase hover:underline">{e.name}</a>
						<form method="POST" action="?/restore">
							<input type="hidden" name="id" value={e.id} />
							<Button type="submit" variant="outline" class="h-11 border-2 font-bold uppercase">Restore</Button>
						</form>
						<Button type="button" variant="outline" class="h-11 border-2 border-destructive font-bold text-destructive uppercase" onclick={() => (del = { id: e.id, name: e.name })}>Delete</Button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.deleted.length}
		<section class="space-y-2">
			<h2 class="font-display text-3xl leading-none font-black uppercase">Deleted ({data.deleted.length})</h2>
			<ul class="divide-y-2 divide-border border-2 border-border bg-card">
				{#each data.deleted as e (e.id)}
					<li class="flex flex-wrap items-center gap-3 p-4">
						<span class="flex-1 text-xl font-bold text-muted-foreground uppercase line-through">{e.name}</span>
						<span class="font-bold uppercase">Removed for good in {e.days_left} day{e.days_left === 1 ? '' : 's'}</span>
						<form method="POST" action="?/restore">
							<input type="hidden" name="id" value={e.id} />
							<Button type="submit" variant="outline" class="h-11 border-2 font-bold uppercase">Restore</Button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<Dialog.Root open={del !== null} onOpenChange={(o) => !o && (del = null)}>
	{#if del}
		<Dialog.Content class="border-2 border-border sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Delete event?</Dialog.Title>
				<Dialog.Description><b>{del.name}</b> moves to Deleted and is removed for good, with all its runners and reads, in 30 days. You can restore it until then.</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/remove" use:enhance={() => async ({ update }) => { await update(); del = null; }} class="flex gap-2">
				<input type="hidden" name="id" value={del.id} />
				<Button type="submit" class="h-11 font-bold uppercase">Delete</Button>
				<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (del = null)}>Cancel</Button>
			</form>
		</Dialog.Content>
	{/if}
</Dialog.Root>

<Dialog.Root open={copy !== null} onOpenChange={(o) => !o && (copy = null)}>
	{#if copy}
		<Dialog.Content class="border-2 border-border sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title class="font-display text-4xl leading-[0.85] font-black uppercase">Duplicate event</Dialog.Title>
				<Dialog.Description>Copies the participants, teams, categories, stations, courses and award settings. Reads, start times, batches and photos are not copied.</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/duplicate"
				use:enhance={() => async ({ result, update }) => {
					// success redirects to the new event; a failure stays open with its message
					copyError = result.type === 'failure' ? ((result.data as { error?: string })?.error ?? 'Could not duplicate') : '';
					if (result.type !== 'failure') await update();
				}}
				class="space-y-3"
			>
				<input type="hidden" name="id" value={copy.id} />
				{#if copyError}<p class="font-bold text-destructive" role="alert">{copyError}</p>{/if}
				<label class="block font-bold uppercase">New event name<Input name="name" bind:value={copy.name} class="mt-1 h-11 border-2 font-normal normal-case" required /></label>
				<label class="block font-bold uppercase">Date<Input name="date" type="date" bind:value={copy.date} class="mt-1 h-11 border-2 font-normal" /></label>
				<div class="flex gap-2">
					<Button type="submit" class="h-11 font-bold uppercase">Duplicate</Button>
					<Button type="button" variant="outline" class="h-11 border-2 font-bold uppercase" onclick={() => (copy = null)}>Cancel</Button>
				</div>
			</form>
		</Dialog.Content>
	{/if}
</Dialog.Root>
