import { createHash, randomBytes } from 'node:crypto';

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');
export const newKey = () => 'rk_' + randomBytes(24).toString('hex');
