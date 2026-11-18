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
	it('reads a prefixed set of fields', () => {
		expect(parseLayout(form({ name_x: '10', name_y: '20', name_size: '5', name_color: '#000000' }), 'name_')).toEqual({ x: 10, y: 20, size: 5, color: '#000000' });
		expect(parseLayout(form({ x: '10', y: '20', size: '5', color: '#000000' }), 'name_')).toBeNull();
	});
});
