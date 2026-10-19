import os from 'node:os';

const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|vpn|loopback|docker|tailscale|zerotier/i;

/** This laptop's IPv4 addresses, real adapters first, so the admin can tell stations which address to use. */
export function lanAddresses() {
	return Object.entries(os.networkInterfaces())
		.flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map((i) => ({ name, ip: i.address, virtual: VIRTUAL.test(name) })))
		.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}
