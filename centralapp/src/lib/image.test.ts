import { describe, expect, it } from 'vitest';
import { sniffImage } from './image';

const pad = (head: number[]) => Uint8Array.from([...head, ...new Array(20).fill(0)]);
describe('sniffImage', () => {
	it('recognises jpeg, png and webp by their bytes', () => {
		expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
		expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0]))).toBe('image/webp');
	});
	it('refuses svg, html, gif, empty and tiny files', () => {
		const text = (s: string) => new TextEncoder().encode(s + ' '.repeat(20));
		expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
		expect(sniffImage(text('<html><script>alert(1)</script>'))).toBeNull();
		expect(sniffImage(text('GIF89a'))).toBeNull();
		expect(sniffImage(new Uint8Array())).toBeNull();
		expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
	});
});
