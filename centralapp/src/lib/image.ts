// Upload safety: decide what an uploaded file really is from its first bytes, never from its name or declared type.
export const MAX_PHOTO_BYTES = 450_000; // the browser shrinks photos far below this; adapter-node rejects bodies over 512 KB

/** Browser only. Longest side 640 px, JPEG: a phone photo of 4 MB becomes about 60 KB, well under the server limit. */
export async function shrinkImage(file: File): Promise<Blob> {
	const bmp = await createImageBitmap(file); // also applies the camera's rotation
	const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(bmp.width * scale));
	c.height = Math.max(1, Math.round(bmp.height * scale));
	c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
	return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('x'))), 'image/jpeg', 0.85));
}

export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
	if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
	const tag = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
	if (b.length > 12 && tag(0, 'RIFF') && tag(8, 'WEBP')) return 'image/webp';
	return null; // SVG, GIF, HTML, anything else is refused
}
