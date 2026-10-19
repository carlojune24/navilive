import { error } from '@sveltejs/kit';
import { q } from '$lib/server/db';
import { subscribeMonitor } from '$lib/server/live';

// Server-sent events for the admin monitor: a ping whenever a station laptop beats or a read arrives for this event.
export const GET = async ({ params, request }) => {
	const [ev] = await q<{ id: number }>('select id from events where slug=$1', [params.slug]);
	if (!ev) error(404, 'Event not found');
	const enc = new TextEncoder();
	let off = () => {};
	let beat: ReturnType<typeof setInterval>;
	const stream = new ReadableStream({
		start(ctl) {
			const send = (s: string) => {
				try {
					ctl.enqueue(enc.encode(s));
				} catch {
					/* closed */
				}
			};
			send('retry: 2000\n\n: open\n\n');
			off = subscribeMonitor((id) => id === ev.id && send('data: update\n\n'));
			beat = setInterval(() => send(': hb\n\n'), 20000);
			request.signal.addEventListener('abort', () => (off(), clearInterval(beat)));
		},
		cancel() {
			off();
			clearInterval(beat);
		}
	});
	return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } });
};
