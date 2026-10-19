import { Fragment, useEffect, useState } from "react";
import { FolderOpen, HardDriveDownload, Trash2, FileUp, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GuidePanel } from "@/views/Guide";
import { StationChip } from "@/components/StationChip";
import { ago, api, errText, ONLINE_MS, type AppInfo, type Device, type Station, type StationKind, type SyncStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  stations: Station[];
  devices: Device[];
  info: AppInfo | null;
  now: number;
  reload: () => void;
}

const KINDS: StationKind[] = ["start", "checkpoint", "finish"];

function Panel({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="sheet p-5">
      <h2 className="font-bib text-4xl">{title}</h2>
      {hint && <p className="mb-3 mt-1 text-sm font-medium text-ink-soft">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function StationsPanel({ stations, reload }: Pick<Props, "stations" | "reload">) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StationKind>("checkpoint");
  const [confirm, setConfirm] = useState<number | null>(null);

  const add = async () => {
    try {
      await api.saveStation(null, name, kind, stations.length + 1);
      setName("");
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const rename = async (s: Station, patch: Partial<Station>) => {
    try {
      await api.saveStation(s.id, patch.name ?? s.name, patch.kind ?? s.kind, patch.sort_order ?? s.sort_order);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (s: Station) => {
    if (confirm !== s.id) return setConfirm(s.id);
    try {
      await api.deleteStation(s.id);
      setConfirm(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
      setConfirm(null);
    }
  };

  return (
    <Panel title="STATIONS" hint="In course order: start, checkpoints, finish. Elapsed time runs from the start station to the finish station.">
      <ul className="mb-4 divide-y-2 divide-ink/15">
        {stations.length === 0 && <li className="py-3 font-semibold">No stations yet. Add the start and finish first.</li>}
        {stations.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <span className="font-bib w-8 text-3xl text-ink-soft">{i + 1}</span>
            <StationChip name={s.name} kind={s.kind} />
            <Input
              aria-label={`Rename ${s.name}`}
              defaultValue={s.name}
              className="max-w-52"
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && void rename(s, { name: e.target.value })}
            />
            <Select value={s.kind} onValueChange={(v) => void rename(s, { kind: v as StationKind })}>
              <SelectTrigger className="w-44" aria-label="Station kind"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-sm font-semibold text-ink-soft">{s.reads} reads</span>
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="sm" disabled={i === 0} onClick={() => void rename(s, { sort_order: stations[i - 1].sort_order - 1 })}>Up</Button>
              <Button variant="outline" size="sm" disabled={i === stations.length - 1} onClick={() => void rename(s, { sort_order: stations[i + 1].sort_order + 1 })}>Down</Button>
              <Button variant={confirm === s.id ? "destructive" : "ghost"} size="sm" onClick={() => void remove(s)} onBlur={() => setConfirm(null)}>
                <Trash2 /> {confirm === s.id ? "Confirm" : "Delete"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="flex-1 space-y-1">
          <Label htmlFor="st-name" className="text-sm font-bold uppercase">New station name</Label>
          <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkpoint 1, Km 5" autoComplete="off" />
        </div>
        <div className="w-48 space-y-1">
          <Label className="text-sm font-bold uppercase">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as StationKind)}>
            <SelectTrigger aria-label="New station kind"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="submit" size="lg" disabled={!name.trim()}>Add station</Button>
      </form>
    </Panel>
  );
}

function DevicesPanel({ devices, stations, now, reload }: Pick<Props, "devices" | "stations" | "now" | "reload">) {
  const assign = async (d: Device, name: string, station: string) => {
    try {
      await api.assignDevice(d.device_id, name, station === "none" ? null : Number(station));
      reload();
      toast.success("Reader updated");
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <Panel title="READERS (ESP32)" hint="Each ESP32 appears here by itself once it connects. Assign it to a station: reads it already sent while unassigned are filled in too.">
      {devices.length === 0 && <p className="font-semibold">Nothing connected yet.</p>}
      <ul className="divide-y-2 divide-ink/15">
        {devices.map((d) => {
          const online = now - d.last_seen_ms < ONLINE_MS;
          return (
            <li key={d.device_id} className="grid grid-cols-[auto_1fr_220px] items-center gap-4 py-3">
              <span aria-hidden className={cn("size-4 border-2 border-ink", online && "bg-start")} />
              <div className="min-w-0">
                <Input
                  aria-label="Reader name"
                  defaultValue={d.name}
                  placeholder={d.device_id}
                  className="mb-1 max-w-72 font-bold"
                  onBlur={(e) => e.target.value !== d.name && void assign(d, e.target.value, d.station_id == null ? "none" : String(d.station_id))}
                />
                <p className="text-sm font-medium text-ink-soft">
                  {d.device_id} · {d.last_ip}{d.ssid ? ` · WiFi ${d.ssid}` : ""} · fw {d.fw || "?"} · {d.reads} reads ·{" "}
                  <span className={online ? "font-bold text-start" : "font-bold text-finish"}>{online ? "online" : `offline ${ago(d.last_seen_ms, now).replace(" ago", "")}`}</span>
                  {d.queue_depth > 0 && <span className="font-bold text-finish"> · {d.queue_depth} waiting to send</span>}
                </p>
              </div>
              <Select value={d.station_id == null ? "none" : String(d.station_id)} onValueChange={(v) => void assign(d, d.name, v)}>
                <SelectTrigger aria-label="Assigned station"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not assigned</SelectItem>
                  {stations.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ConnectionPanel({ info }: { info: AppInfo | null }) {
  return (
    <Panel title="CONNECTION" hint="The ESP32 posts reads to this laptop. Type one of these addresses into its WiFi setup page if automatic discovery does not find it.">
      {info && (
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 font-semibold">
          <dt className="text-ink-soft">Server</dt>
          <dd className={info.server === "listening" ? "text-start" : "text-finish"}>{info.server === "listening" ? `Listening on port ${info.port}` : info.server}</dd>
          <dt className="text-ink-soft">Laptop WiFi</dt>
          <dd>{info.wifi || "Not connected to WiFi"}</dd>
          <dt className="text-ink-soft">Laptop addresses</dt>
          <dd>{info.ips.length ? info.ips.map((ip) => <div key={ip}>{ip.split(" ")[0]}:{info.port}<span className="ml-2 text-sm font-medium text-ink-soft">{ip.split("  ")[1]}</span></div>) : "No network found. Connect this laptop to the race WiFi."}</dd>
          <dt className="text-ink-soft">Auto discovery</dt>
          <dd>{info.mdns ? "racetracker.local is advertised" : "Not available. Use the address above."}</dd>
          <dt className="text-ink-soft">Data folder</dt>
          <dd className="break-all text-sm">{info.dir}</dd>
        </dl>
      )}
      <p className="mt-3 border-2 border-ink p-3 text-sm font-semibold">
        If readers never connect: allow this app through Windows Firewall on Private networks (port {info?.port ?? 4390}).
      </p>
    </Panel>
  );
}

function NewEventSection({ reload }: { reload: () => void }) {
  const [word, setWord] = useState("");
  const [wipeSetup, setWipeSetup] = useState(false);
  const ready = word.trim().toUpperCase() === "RESET";

  const run = async () => {
    try {
      const r = await api.newEvent(wipeSetup);
      toast.success(`Cleared ${r.removed} reads. Backup saved first: ${r.backup}`);
      setWord("");
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="border-t-2 border-ink pt-4">
      <h3 className="font-bib text-2xl">NEW EVENT / CLEAR READS</h3>
      <p className="mb-3 text-sm font-medium text-ink-soft">
        Removes every recorded read so the next race starts empty. A backup is saved first and can be restored from the backups folder.
        Reads still waiting on a reader are not cleared; let it finish sending first.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={wipeSetup} onChange={(e) => setWipeSetup(e.target.checked)} className="size-4" />
        Also remove all runners and stations
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="reset-word" className="text-sm font-bold uppercase">Type RESET to confirm</Label>
          <Input id="reset-word" value={word} onChange={(e) => setWord(e.target.value)} className="w-40" autoComplete="off" />
        </div>
        <Button variant="destructive" disabled={!ready} onClick={() => void run()}>
          <Trash2 /> {wipeSetup ? "Clear reads, runners and stations" : "Clear reads"}
        </Button>
      </div>
    </div>
  );
}

function DataPanel({ reload }: { reload: () => void }) {
  const [debounce, setDebounce] = useState("30");
  const [path, setPath] = useState("");
  useEffect(() => {
    api.settings().then((s) => setDebounce(s.debounce_s ?? "30")).catch(() => {});
  }, []);

  const run = async (fn: () => Promise<string>, label: string) => {
    try {
      toast.success(`${label}: ${await fn()}`);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const saveDebounce = async () => {
    try {
      await api.setSetting("debounce_s", debounce.trim());
      toast.success("Saved. Passings recalculated.");
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const merge = async () => {
    try {
      const r = await api.importMerge(path);
      toast.success(`Merged: ${r.added} new reads, ${r.duplicates} already present, ${r.runners_added} new runners`);
      setPath("");
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Panel title="DATA" hint="Every read is kept forever; voiding only hides it from results. A backup is also saved automatically every 5 minutes.">
      <div className="space-y-5">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="deb" className="text-sm font-bold uppercase">Ignore repeat reads of a tag within (seconds)</Label>
            <Input id="deb" inputMode="numeric" value={debounce} onChange={(e) => setDebounce(e.target.value)} className="w-40" />
          </div>
          <Button variant="outline" onClick={() => void saveDebounce()}>Save</Button>
          <p className="max-w-md pb-2 text-sm font-medium text-ink-soft">The reader fires many times while a tag is in range. Only the first read in this window counts as a passing; the rest are kept but marked Repeat.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run(api.backupNow, "Backup saved")}><HardDriveDownload /> Back up now</Button>
          <Button variant="outline" onClick={() => void api.openFolder("backups")}><FolderOpen /> Open backups</Button>
          <Button variant="outline" onClick={() => void api.openFolder("exports")}><FolderOpen /> Open exports</Button>
        </div>
        <div className="border-t-2 border-ink pt-4">
          <h3 className="font-bib text-2xl">COMBINE STATIONS</h3>
          <p className="mb-3 text-sm font-medium text-ink-soft">Each laptop keeps its own reads. Export from every station, copy the files to one laptop, and import them there for full results. Importing twice never double-counts.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" onClick={() => void run(() => api.exportFile("merge"), "Station file saved")}><FileDown /> Export this station</Button>
            <div className="min-w-72 flex-1 space-y-1">
              <Label htmlFor="mp" className="text-sm font-bold uppercase">Station file to import (full path)</Label>
              <Input id="mp" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\...\station-export-123.json" />
            </div>
            <Button disabled={!path.trim()} onClick={() => void merge()}><FileUp /> Import</Button>
          </div>
        </div>
        <NewEventSection reload={reload} />
      </div>
    </Panel>
  );
}

function CentralPanel({ now, reload }: Pick<Props, "now" | "reload">) {
  const [url, setUrl] = useState("");
  const [event, setEvent] = useState("");
  const [key, setKey] = useState("");
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [laptop, setLaptop] = useState("");

  // The central app's Connect page shows "RC1|<address>|<event>|<key>"; one paste fills all three fields.
  const fillFromCode = () => {
    const [tag, u, e, k] = code.trim().split("|");
    if (tag !== "RC1" || !u || !e || !k) {
      toast.error("That is not a connection code. Copy it from the central app: Connect page.");
      return;
    }
    setUrl(u);
    setEvent(e);
    setKey(k);
    setCode("");
    toast.success("Filled in. Press Save and connect.");
  };

  useEffect(() => {
    api.settings().then((s) => {
      setUrl(s.central_url ?? "");
      setEvent(s.central_event ?? "");
      setKey(s.central_key ?? "");
      setLaptop(s.laptop_name ?? "");
    }).catch(() => {});
    const poll = () => api.syncStatus().then(setSt).catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const save = async () => {
    try {
      await api.setSetting("central_url", url.trim());
      await api.setSetting("central_event", event.trim());
      await api.setSetting("central_key", key.trim());
      await api.setSetting("laptop_name", laptop.trim());
      toast.success("Saved. Syncing now…");
      await syncNow();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await api.syncNow();
      setSt(r);
      if (r.last_error) toast.error(r.last_error);
      else toast.success(`Synced. ${r.runners_pulled} runners in roster, ${r.pending} reads waiting.`);
      reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const dur = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString();
  const down = st?.state === "reconnecting";
  const headline = !st?.configured
    ? "Not connected. Fill in the three fields below to share this station's reads and get the runner list."
    : down
      ? `Reconnecting… attempt ${st.failures_in_row} failed, down for ${dur(now - st.failing_since_ms)}. ${st.pending} reads are safe on this laptop and will upload when it works.`
      : st.state === "connected"
        ? `Connected to the central app${st.latency_ms ? ` (${st.latency_ms} ms)` : ""}. ${st.pending} reads waiting, ${st.pushed_total} uploaded.`
        : "Connecting…";
  const rows: [string, string][] = st?.configured
    ? [
        ["Server", st.target || "—"],
        ["Link", down ? `DOWN since ${clock(st.failing_since_ms)}` : st.state === "connected" ? "UP" : "—"],
        ["Last contact", st.last_contact_ms ? `${ago(st.last_contact_ms, now)} (${clock(st.last_contact_ms)})` : "never"],
        ["Last attempt", st.last_attempt_ms ? `${ago(st.last_attempt_ms, now)} · ${st.attempts} attempts so far` : "—"],
        ["Next attempt", st.next_attempt_ms ? (st.next_attempt_ms > now ? `in ${Math.ceil((st.next_attempt_ms - now) / 1000)} s` : "now") : "—"],
        ["Failed in a row", String(st.failures_in_row)],
        ["Reads", `${st.pending} waiting · ${st.pushed_total} uploaded${st.last_push_ms ? ` · last upload ${ago(st.last_push_ms, now)}` : ""}`],
        ["Runner list", st.last_pull_ms ? `${st.runners_pulled} runners · pulled ${ago(st.last_pull_ms, now)}` : "not pulled yet"],
      ]
    : [];

  return (
    <Panel title="CENTRAL APP" hint="Optional. Uploads every read to the race director's central app and pulls the runner list (bibs, names, categories). Works offline: reads queue here and upload when the connection returns.">
      <div className="space-y-4">
        <div className={cn("border-2", down ? "border-finish" : "border-ink")} role="status">
          <p className={cn("flex items-center gap-3 p-3 font-bold", down && "text-finish")}>
            <span className="inline-block size-4 shrink-0 border-2 border-ink" style={{ background: down ? "var(--color-finish)" : st?.state === "connected" ? "var(--color-start)" : "transparent" }} />
            {headline}
          </p>
          {st?.last_error && <p className="border-t-2 border-ink/20 px-3 py-2 font-medium text-finish">{st.last_error}</p>}
          {rows.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1 border-t-2 border-ink/20 px-3 py-2 text-sm">
              {rows.map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="font-bold uppercase text-ink-soft">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {st && st.log.length > 0 && (
            <details className="border-t-2 border-ink/20 px-3 py-2" open={down}>
              <summary className="cursor-pointer text-sm font-bold uppercase">Connection log ({st.log.length})</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
                {[...st.log].reverse().map((l, i) => (
                  <li key={`${l.at_ms}-${i}`} className={cn("flex gap-3", l.ok ? "" : "text-finish")}>
                    <span className="w-20 shrink-0 tabular-nums text-ink-soft">{clock(l.at_ms)}</span>
                    <span>{l.text}{l.count > 1 ? ` (×${l.count})` : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3 border-2 border-ink p-3">
          <div className="min-w-72 flex-1 space-y-1">
            <Label htmlFor="cc" className="text-sm font-bold uppercase">Easy setup: paste the connection code</Label>
            <Input id="cc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="RC1|https://navilive.duckdns.org|my-event|rk_…" autoComplete="off" />
          </div>
          <Button variant="outline" disabled={!code.trim()} onClick={fillFromCode}>Fill from code</Button>
          <p className="w-full text-sm font-medium text-ink-soft">Central app: open the event, Connect page, Copy code. Or fill the three fields below by hand.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cu" className="text-sm font-bold uppercase">Central app address</Label>
            <Input id="cu" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://navilive.duckdns.org" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ce" className="text-sm font-bold uppercase">Event name in URL</Label>
            <Input id="ce" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="demo-10k" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ck" className="text-sm font-bold uppercase">API key</Label>
            <Input id="ck" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="rk_…" autoComplete="off" />
          </div>
        </div>
        <div className="max-w-md space-y-1">
          <Label htmlFor="cl" className="text-sm font-bold uppercase">This laptop's name (shown on the central app)</Label>
          <Input id="cl" value={laptop} onChange={(e) => setLaptop(e.target.value)} placeholder="e.g. Finish laptop" autoComplete="off" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy} onClick={() => void save()}>Save and connect</Button>
          <Button variant="outline" disabled={busy || !st?.configured} onClick={() => void syncNow()}>Sync now</Button>
          <p className="text-sm font-medium text-ink-soft">Station names here must match the central app's station names exactly (Start, Finish…).</p>
        </div>
      </div>
    </Panel>
  );
}

export function Setup(p: Props) {
  return (
    <div className="h-full space-y-5 overflow-auto p-5">
      <StationsPanel stations={p.stations} reload={p.reload} />
      <DevicesPanel devices={p.devices} stations={p.stations} now={p.now} reload={p.reload} />
      <CentralPanel now={p.now} reload={p.reload} />
      <div className="grid grid-cols-2 items-start gap-5">
        <ConnectionPanel info={p.info} />
        <DataPanel reload={p.reload} />
      </div>
      <GuidePanel />
    </div>
  );
}
