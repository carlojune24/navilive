import { subscribe } from '$lib/server/live';
import { authEvent } from '$lib/server/station';

/**
 * Pings the marshal page the instant anything changes (a read, a void, a gun), so it refetches /board at once.
 * Read with fetch rather than EventSource so the event key travels in the Authorization header, not the URL (which nginx logs).
 */
export const GET = async ({ params, request }) => {
	const e = await authEvent(params.slug, request);
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
			send(': open\n\n');
			off = subscribe((id) => id === e.id && send('data: update\n\n'));
			beat = setInterval(() => send(': hb\n\n'), 15000);
			request.signal.addEventListener('abort', () => (off(), clearInterval(beat)));
		},
		cancel() {
			off();
			clearInterval(beat);
		}
	});
	return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
};
