// QA harness helpers: drives the running app over HTTP like the browser, station laptops and marshal phones do.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const pg = require('pg');
const devalue = await import(new URL('../node_modules/devalue/index.js', import.meta.url).href);

export const BASE = 'http://localhost:5299';
export const ORIGIN = 'http://localhost:3000'; // the build's fixed origin (vite.config paths.origin)
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/\/[^/]+$/, '/racecentral_qa');
export const db = new pg.Pool({ connectionString: url });
pg.types.setTypeParser(20, (v) => Number(v));
export const sql = async (text, params) => (await db.query(text, params)).rows;

export let cookie = '';
export const results = [];
process.on('exit', () => { if (results.some((r) => !r.ok)) process.exitCode = 1; }); // any failed check fails the run
let section = '';
export const group = (name) => { section = name; console.log(`\n== ${name}`); };
export function check(name, ok, detail = '') {
	results.push({ section, name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -> ' + detail : ''}`);
	return !!ok;
}
export const note = (s) => console.log('      · ' + s);

export async function login(pw) {
	const fd = new FormData();
	fd.set('password', pw);
	const r = await fetch(BASE + '/login', { method: 'POST', body: fd, headers: { origin: ORIGIN, 'x-sveltekit-action': 'true' }, redirect: 'manual' });
	const sc = r.headers.get('set-cookie');
	if (sc) cookie = sc.split(';')[0];
	return { status: r.status, body: await r.text(), cookie: sc };
}

/** POST a SvelteKit form action like the admin page does. Returns { type, status, data }. */
export async function act(path, action, fields = {}, opts = {}) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
		else if (v instanceof Blob) fd.set(k, v, v.name ?? 'file');
		else if (v !== undefined && v !== null) fd.set(k, String(v));
	}
	const r = await fetch(`${BASE}${path}?/${action}`, {
		method: 'POST',
		body: fd,
		headers: { origin: opts.origin ?? ORIGIN, 'x-sveltekit-action': 'true', cookie: opts.cookie ?? cookie },
		redirect: 'manual'
	});
	const text = await r.text();
	let out;
	try {
		out = JSON.parse(text);
		if (typeof out.data === 'string') out.data = devalue.parse(out.data);
	} catch {
		out = { type: 'raw', text };
	}
	return { httpStatus: r.status, ...out };
}

export async function api(method, path, { key, body, headers = {} } = {}) {
	const r = await fetch(BASE + path, {
		method,
		headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
	});
	const text = await r.text();
	let json = null;
	try { json = JSON.parse(text); } catch {}
	return { status: r.status, json, text, headers: r.headers };
}

export const get = (path, withCookie = true) => fetch(BASE + path, { headers: withCookie ? { cookie } : {}, redirect: 'manual' });

export async function createEvent(name, date = '') {
	const r = await act('/admin', 'create', { name, date });
	const slug = r.location?.split('/').pop();
	const [e] = await sql('select id, slug, api_key from events where slug=$1', [slug]);
	return { ...e, r };
}
export const results$ = async (slug, mode = 'gun', withCookie = true) => (await api('GET', `/e/${slug}/results?mode=${mode}`, { headers: withCookie ? { cookie } : {} })).json;
export const file = (name, text, type = 'text/csv') => new File([text], name, { type });
export const T0 = Date.UTC(2026, 10, 22, 22, 0, 0); // race day 06:00 Manila
export const min = (m) => m * 60000;
