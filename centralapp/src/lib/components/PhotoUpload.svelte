<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';

	// Small control: shows the current photo, uploads a new one (shrunk in the browser first), or removes it.
	type Props = { slug: string; id: number; bib: string; photo: number | null; tab: string };
	let { slug, id, bib, photo, tab }: Props = $props();
	let busy = $state(false);
	let error = $state('');
	let input: HTMLInputElement;

	/** Longest side 640 px, JPEG: a phone photo of 4 MB becomes about 60 KB, well under the server limit. */
	async function shrink(file: File): Promise<Blob> {
		const bmp = await createImageBitmap(file); // also applies the camera's rotation
		const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(bmp.width * scale));
		c.height = Math.max(1, Math.round(bmp.height * scale));
		c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
		return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('x'))), 'image/jpeg', 0.85));
	}

	async function send(action: string, body: FormData) {
		const r = await fetch(`?tab=${tab}&/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await r.text());
		if (result.type === 'failure') throw new Error((result.data as { error?: string })?.error ?? 'Upload failed');
		if (result.type === 'error') throw new Error('Upload failed');
	}

	async function pick(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = ''; // allows choosing the same file again
		if (!file) return;
		busy = true;
		error = '';
		try {
			const fd = new FormData();
			fd.set('id', String(id));
			fd.set('photo', await shrink(file), 'photo.jpg');
			await send('uploadPhoto', fd);
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error && err.message !== 'x' ? err.message : 'That file could not be read as a photo.';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		error = '';
		try {
			const fd = new FormData();
			fd.set('id', String(id));
			await send('deletePhoto', fd);
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not remove it.';
		} finally {
			busy = false;
		}
	}
</script>

<span class="inline-flex flex-wrap items-center gap-2">
	{#if photo}
		<img src="/e/{slug}/photo/{bib}?v={photo}" alt="Photo of bib {bib}" class="size-14 border-2 border-border object-cover" />
	{:else}
		<span class="inline-flex size-14 items-center justify-center border-2 border-dashed border-border text-xs text-muted-foreground uppercase">No photo</span>
	{/if}
	<input bind:this={input} type="file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange={pick} aria-label="Choose a photo for bib {bib}" />
	<Button type="button" variant="outline" size="sm" disabled={busy} class="border-2 border-border bg-card font-bold uppercase hover:bg-accent" onclick={() => input.click()}>{busy ? 'Working…' : photo ? 'Change' : 'Upload photo'}</Button>
	{#if photo}<Button type="button" variant="outline" size="sm" disabled={busy} class="border-2 border-border bg-card font-bold uppercase hover:bg-accent" onclick={remove}>Remove</Button>{/if}
	{#if error}<span class="w-full font-bold text-destructive" role="alert">{error}</span>{/if}
</span>
