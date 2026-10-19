// Upload safety: decide what an uploaded file really is from its first bytes, never from its name or declared type.
export const MAX_PHOTO_BYTES = 450_000; // the browser shrinks photos far below this; adapter-node rejects bodies over 512 KB

export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
	if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
	const tag = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
	if (b.length > 12 && tag(0, 'RIFF') && tag(8, 'WEBP')) return 'image/webp';
	return null; // SVG, GIF, HTML, anything else is refused
}
