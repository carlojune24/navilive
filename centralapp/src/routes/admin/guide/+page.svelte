<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let { data } = $props();
	let copied = $state('');

	const folder = 'C:\\Users\\USER\\Claude\\Projects\\EPS32WEIGANDRFID\\centralapp';
	const ip = $derived(data.addresses[0]?.ip ?? '<this laptop IP>');
	const portArg = $derived(data.port === '3000' ? '' : ` -Port ${data.port}`);

	const cmds = $derived({
		cd: `cd ${folder}`,
		firewall: `powershell -ExecutionPolicy Bypass -File .\\scripts\\firewall.ps1${portArg}`,
		private: `Set-NetConnectionProfile -Name "<network name>" -NetworkCategory Private`,
		start: `.\\scripts\\start.ps1`,
		backup: `.\\scripts\\backup.ps1`,
		undo: `Remove-NetFirewallRule -DisplayName "Race Central"`
	});

	async function copy(key: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => (copied = ''), 1500);
		} catch {
			copied = '';
		}
	}
</script>

{#snippet cmd(key: keyof typeof cmds)}
	<span class="my-2 flex items-stretch gap-2">
		<code class="min-w-0 flex-1 border-2 border-border bg-muted p-2 text-sm break-all select-all">{cmds[key]}</code>
		<Button variant="outline" size="sm" class="h-auto border-2 border-border bg-card font-bold uppercase hover:bg-accent" onclick={() => copy(key, cmds[key])}>
			{copied === key ? 'Copied' : 'Copy'}
		</Button>
	</span>
{/snippet}

<main class="max-w-3xl space-y-6 p-5">
	<h1 class="font-display text-5xl leading-[0.85] font-black uppercase">Setup guide</h1>
	<p class="text-lg">How to get this laptop ready so station laptops and phones can reach it. Do parts 1 and 2 once; parts 3 and 4 on race day.</p>

	{#if data.publicUrl}
	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">1. The app is hosted online</h2>
		<p>Nothing to start or install on your laptop. Open <a class="font-bold underline" href={data.publicUrl}>{data.publicUrl}</a>/admin to manage the event, and share <b>{data.publicUrl}/e/&lt;event name&gt;</b> for the live board.</p>
		<p>The admin password and the database live on the server. Change the password on the <a class="font-bold underline" href="/admin/account">Password</a> page in the left menu. Five wrong passwords block that address for 10 minutes.</p>
		<p>The server saves a database backup every night to <code>/home/ubuntu/backups</code> (the last 14 are kept). Use the Results and Awards pages (Print or Download CSV) for race-day copies of results.</p>
	</section>
	{:else}
	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">1. Allow other devices in (firewall, once)</h2>
		<p>Windows blocks other devices from reaching this app until you allow it. This needs administrator rights.</p>
		<ol class="list-decimal space-y-3 pl-6">
			<li>Press the <b>Windows key</b>, type <b>PowerShell</b>, right-click <b>Windows PowerShell</b>, choose <b>Run as administrator</b>, then <b>Yes</b>. The window title must say <b>Administrator</b>.</li>
			<li>Go to the app folder:{@render cmd('cd')}</li>
			<li>Run the script:{@render cmd('firewall')}</li>
			<li>You should see <b>Allowed inbound TCP {data.port} on 'Private' networks</b>, then a list of your networks.</li>
			<li>
				If the venue WiFi says <b>Public</b>, the rule does not apply to it. Switch it to Private, using the name from the list:{@render cmd('private')}
			</li>
		</ol>
		<p class="text-muted-foreground">To undo later (administrator window):{@render cmd('undo')}</p>
	</section>

	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">2. Set a real admin password (once)</h2>
		<p>Sign in once with the password from <code>centralapp\.env</code> (<code>ADMIN_PASSWORD</code>), then change it on the <a class="font-bold underline" href="/admin/account">Password</a> page in the left menu.</p>
	</section>

	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">3. Start the app (every event)</h2>
		<ol class="list-decimal space-y-3 pl-6">
			<li>Connect this laptop to the venue WiFi. Make sure PostgreSQL is running.</li>
			<li>In a normal PowerShell, in the app folder:{@render cmd('start')}</li>
			<li>
				It prints the addresses. Keep this window open for the whole event; closing it stops the app. Admin pages work only on this laptop at
				<code>http://localhost:{data.port}/admin</code>.
			</li>
			<li>
				{#if data.addresses.length}
					This laptop's address right now:
					{#each data.addresses as a}<b class="mr-3">http://{a.ip}:{data.port}</b>{/each}
					(the one on the venue WiFi is the right one).
				{:else}
					This laptop has no network address right now. Connect to the WiFi first.
				{/if}
			</li>
			<li>Test from a phone on the same WiFi: open <b>http://{ip}:{data.port}/e/&lt;event name&gt;</b>. If the live board loads, the firewall is open. If it hangs, repeat part 1.</li>
		</ol>
	</section>

	{/if}

	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">4. Connect each station laptop</h2>
		<ol class="list-decimal space-y-2 pl-6">
			<li>Put the station laptop on the <b>same WiFi</b>.</li>
			<li>Here: open the event, then the <b>Connect stations</b> tab, then <b>Copy code</b>.</li>
			<li>In the station app: <b>Setup &rarr; Central app</b>, paste into the code box, press <b>Fill from code</b>, then <b>Save and connect</b>.</li>
			<li>The status line should say <b>Connected</b> and the runner list should appear.</li>
			<li>Station names in the station app must match the Stations page exactly (for example <b>Start</b>, <b>Finish</b>), or reads are stored but not ranked.</li>
		</ol>
	</section>

	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">Event-day checklist</h2>
		<ul class="space-y-1">
			{#each (data.publicUrl ? ['Open the live board on the big screen (Big screen button)', 'Every station laptop has internet and shows Connected', 'Do a test read at each station, then Clear all reads (Reads page) before the start', 'After the finish: print or download the Results and Awards'] : ['Back up the database (below)', 'Laptop plugged in, sleep turned off', 'Venue WiFi is set to Private', 'App running; phone can open the live board', 'Every station shows Connected', 'Do a test read at each station, then Clear all reads (Reads page) before the start', 'Big screen open: live board with Big screen on', 'Back up again after the finish, then download the Results']) as item}
				<li class="flex items-start gap-3"><span class="mt-1 inline-block size-5 shrink-0 border-2 border-border"></span>{item}</li>
			{/each}
		</ul>
		{#if !data.publicUrl}<p>Backup command (saves a file in <code>centralapp\backups</code>):{@render cmd('backup')}</p>{/if}
	</section>

	<section class="space-y-3 border-2 border-border bg-card p-5">
		<h2 class="font-display text-3xl font-black uppercase">If something is wrong</h2>
		<dl class="space-y-3">
			{#if !data.publicUrl}
			<div><dt class="font-bold uppercase">Phone or station cannot open the address</dt><dd>Firewall not set up (part 1), WiFi is Public, devices are on different WiFi networks, or you used the wrong address from the list.</dd></div>
			{/if}
			<div><dt class="font-bold uppercase">Station says it cannot reach the central app</dt><dd>Check the address in Setup &rarr; Central app, that the app window is still running, and the same WiFi. Reads wait on the station laptop and upload when it works. Nothing is lost.</dd></div>
			<div><dt class="font-bold uppercase">Station says it rejected the event or key</dt><dd>The key was rotated. Copy a fresh connection code from the Connect page.</dd></div>
			{#if !data.publicUrl}
			<div><dt class="font-bold uppercase">Admin form does nothing or says cross-site</dt><dd>Open the admin at <code>http://localhost:{data.port}/admin</code> on this laptop, not by the network address.</dd></div>
			{/if}
			<div><dt class="font-bold uppercase">A runner is missing from results</dt><dd>Reads page: look for their start and finish reads. Add a missed read by hand, or restore a voided one. In Own start mode a runner without a start read is not ranked.</dd></div>
			<div><dt class="font-bold uppercase">Live board says Reconnecting</dt><dd>The board lost its link to this laptop. It retries by itself and catches up when it returns.</dd></div>
		</dl>
	</section>
</main>
