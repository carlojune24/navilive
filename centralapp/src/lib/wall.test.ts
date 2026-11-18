import { describe, expect, it } from 'vitest';
import { parseLayout } from './wall';

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
describe('parseLayout', () => {
	it('clamps position and size', () => {
		expect(parseLayout(form({ x: '-5', y: '140', size: '99', color: '#A1B2C3' }))).toEqual({ x: 0, y: 100, size: 40, color: '#a1b2c3' });
	});
	it('refuses bad numbers and colors', () => {
		expect(parseLayout(form({ x: 'abc', y: '1', size: '10', color: '#ffffff' }))).toBeNull();
		expect(parseLayout(form({ x: '1', y: '1', size: '10', color: 'red;background:url(x)' }))).toBeNull();
		expect(parseLayout(form({ x: '1', y: '1', size: '10' }))).toBeNull();
	});
});
