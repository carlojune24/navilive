// Upload safety: decide what an uploaded file really is from its first bytes, never from its name or declared type.
export const MAX_PHOTO_BYTES = 450_000; // the browser shrinks photos far below this; adapter-node rejects bodies over 512 KB

/** Browser only. Longest side `max` px (640 for photos: a 4 MB phone photo becomes about 60 KB), JPEG.
 *  Large sizes (backdrops) drop the JPEG quality until the file fits the server limit. */
export async function shrinkImage(file: File, max = 640): Promise<Blob> {
	const bmp = await createImageBitmap(file); // also applies the camera's rotation
	const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(bmp.width * scale));
	c.height = Math.max(1, Math.round(bmp.height * scale));
	c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
	let blob: Blob | null = null;
	for (const quality of [0.85, 0.7, 0.55, 0.4]) {
		blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', quality));
		if (!blob) throw new Error('x');
		if (blob.size <= MAX_PHOTO_BYTES) break;
	}
	return blob!;
}

export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
	if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
	const tag = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
	if (b.length > 12 && tag(0, 'RIFF') && tag(8, 'WEBP')) return 'image/webp';
	return null; // SVG, GIF, HTML, anything else is refused
}
