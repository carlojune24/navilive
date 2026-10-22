import { useEffect, useMemo, useState } from "react";
import { Ban, FlaskConical, RotateCcw, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StationChip } from "@/components/StationChip";
import { Flip } from "@/components/Flip";
import { ago, api, errText, fmtClock, ONLINE_MS, type Device, type Read, type Station } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  reads: Read[];
  stations: Station[];
  devices: Device[];
  now: number;
  fresh: Set<number>;
  beepOn: boolean;
  setBeepOn: (v: boolean) => void;
  testMode: boolean;
  reload: () => void;
  goSetup: () => void;
}

const KIND_BG: Record<string, string> = {
  start: "bg-start text-white",
  checkpoint: "bg-checkpoint text-ink",
  finish: "bg-finish text-white",
};

function LastRead({ read, now }: { read: Read | undefined; now: number }) {
  if (!read) {
    return (
      <section className="sheet notch flex min-h-[240px] flex-col justify-center px-10 py-8">
        <p className="font-bib text-[88px] text-ink-soft">WAITING</p>
        <p className="mt-3 text-lg font-medium text-ink-soft">No tag read yet. Hold a tag in front of the reader; it appears here the instant it arrives.</p>
      </section>
    );
  }
  const label = read.bib ?? read.tag;
  const kind = read.station_kind;
  return (
    <section className="sheet notch min-h-[240px]" aria-live="polite">
      <div className={cn("flex items-center justify-between gap-4 px-14 py-2 text-2xl font-bold uppercase", kind ? KIND_BG[kind] : "bg-secondary")}>
        <span aria-hidden className="absolute left-4 top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-ink bg-paper" />
        <span aria-hidden className="absolute right-4 top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-ink bg-paper" />
        <span className="tracking-wider">{kind ?? "No station"}</span>
        <span className="truncate">{read.station ?? "Assign this reader in Setup"}</span>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_8px_auto] items-center gap-x-6 px-8 py-5">
        <div
          key={read.id}
          className={cn("font-bib text-ink", !read.bib ? (label.length > 12 ? "text-[40px]" : "text-[64px]") : label.length > 4 ? "text-[104px]" : "text-[152px]")}
          style={{ perspective: 600 }}
        >
          <Flip text={label} />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-balance text-3xl font-bold uppercase leading-tight">{read.runner ?? (read.bib ? "No name on file" : "Unmapped")}</p>
          {read.category && <p className="text-lg font-medium text-ink-soft">{read.category}</p>}
          <div className="flex flex-wrap gap-2 text-sm font-bold uppercase">
            {!read.is_passing && !read.voided && <span className="border-2 border-ink px-2 py-0.5">Repeat read, not counted</span>}
            {read.voided && <span className="border-2 border-finish px-2 py-0.5 text-finish">Voided</span>}
            {!read.time_exact && <span className="border-2 border-ink px-2 py-0.5">Time = arrival at app</span>}
          </div>
        </div>
        <div aria-hidden className="perf-l self-stretch" />
        <div className="text-right">
          <p className="font-bib text-[44px]">{fmtClock(read.read_at_ms)}</p>
          <p className="mt-1 text-lg font-semibold text-ink-soft">{ago(read.read_at_ms, now)}</p>
        </div>
      </div>
    </section>
  );
}

function ManualEntry({ stations, devices, reload, goSetup }: Pick<Props, "stations" | "devices" | "reload" | "goSetup">) {
  const initial = devices.find((d) => d.station_id != null)?.station_id ?? stations[0]?.id ?? null;
  const [value, setValue] = useState("");
  const [station, setStation] = useState<string>(initial ? String(initial) : "");
  useEffect(() => {
    if (!station && initial) setStation(String(initial));
  }, [initial, station]);

  const submit = async () => {
    if (!value.trim() || !station) return;
    try {
      await api.manualRead(value, Number(station));
      toast.success(`Recorded ${value.trim().toUpperCase()}`);
      setValue("");
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <section className="sheet notch p-4">
      <h2 className="font-bib mb-3 text-3xl">MISSED A TAG?</h2>
      {stations.length === 0 ? (
        <div className="space-y-3">
          <p className="font-medium">Create at least one station before recording reads.</p>
          <Button onClick={goSetup} className="w-full">Open setup</Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="manual-id" className="text-sm font-bold uppercase">Bib number or tag</Label>
            <Input id="manual-id" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" className="h-14 text-2xl font-bold" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold uppercase">Station</Label>
            <Select value={station} onValueChange={setStation}>
              <SelectTrigger aria-label="Station"><SelectValue placeholder="Choose station" /></SelectTrigger>
              <SelectContent>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={!value.trim() || !station}>
            <Plus /> Record at current time
          </Button>
        </form>
      )}
    </section>
  );
}

function Devices({ devices, stations, now }: Pick<Props, "devices" | "stations" | "now">) {
  return (
    <section className="sheet notch p-4">
      <h2 className="font-bib mb-3 text-3xl">READERS</h2>
      {devices.length === 0 ? (
        <p className="font-medium text-ink-soft">No ESP32 has connected yet. Power it on and check it is on the same WiFi as this laptop.</p>
      ) : (
        <ul className="divide-y-2 divide-ink/15">
          {devices.map((d) => {
            const online = now - d.last_seen_ms < ONLINE_MS;
            const st = stations.find((s) => s.id === d.station_id);
            return (
              <li key={d.device_id} className="flex items-start gap-3 py-2.5">
                <span aria-hidden className={cn("mt-1.5 size-4 shrink-0 border-2 border-ink", online && "bg-start")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{d.name || d.device_id}</p>
                  <p className="text-sm text-ink-soft">{st ? st.name : "Not assigned to a station"}</p>
                  <p className="break-all text-sm text-ink-soft">{d.last_ip}{d.ssid ? ` on ${d.ssid}` : ""}</p>
                  {d.queue_depth > 0 && <p className="text-sm font-bold text-finish">{d.queue_depth} reads waiting to send</p>}
                </div>
                <p className={cn("text-sm font-bold uppercase", online ? "text-start" : "text-finish")}>
                  {online ? "Online" : `Offline ${ago(d.last_seen_ms, now).replace(" ago", "")}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModeBar({ testMode, reload }: Pick<Props, "testMode" | "reload">) {
  const [confirm, setConfirm] = useState(false);

  const change = async (test: boolean) => {
    try {
      const n = await api.setMode(test);
      toast.success(test ? "Test mode on. Reads are not uploaded." : `Live. ${n} test read(s) deleted.`);
      setConfirm(false);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  if (!testMode) {
    return (
      <Button variant="outline" size="sm" onClick={() => void change(true)}><FlaskConical /> Start test mode</Button>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-2 border-ink bg-checkpoint px-4 py-2 text-ink">
      <p className="font-bold uppercase">Test mode: reads below are test only, never uploaded, deleted when you go live</p>
      <Button
        variant={confirm ? "destructive" : "default"}
        size="sm"
        className="ml-auto"
        onClick={() => (confirm ? void change(false) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
      >
        {confirm ? "Confirm: delete test reads" : "Go live"}
      </Button>
    </div>
  );
}

export function Live(p: Props) {
  const [passingsOnly, setPassingsOnly] = useState(false);
  const [search, setSearch] = useState("");

  const latest = p.reads.find((r) => !r.voided) ?? p.reads[0];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return p.reads.filter((r) => {
      if (passingsOnly && !r.is_passing) return false;
      if (!q) return true;
      return [r.tag, r.bib, r.runner, r.station].some((v) => v?.toLowerCase().includes(q));
    });
  }, [p.reads, passingsOnly, search]);

  const toggleVoid = async (r: Read) => {
    try {
      await api.voidRead(r.id, !r.voided, r.voided ? "" : "voided by operator");
      p.reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-5 overflow-auto p-5 min-[1200px]:grid-cols-[minmax(0,1fr)_340px] min-[1200px]:overflow-hidden">
      <div className="flex min-h-0 flex-col gap-4 max-[1199px]:min-h-[560px]">
        <ModeBar testMode={p.testMode} reload={p.reload} />
        <LastRead read={latest} now={p.now} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <Input aria-label="Search reads" placeholder="Search bib, name or tag" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <Switch checked={passingsOnly} onCheckedChange={setPassingsOnly} /> Passings only
          </label>
          <label className="flex items-center gap-2 font-semibold">
            <Switch checked={p.beepOn} onCheckedChange={p.setBeepOn} /> Beep on read
          </label>
          <p className="ml-auto text-sm font-semibold text-ink-soft">{rows.length} shown, newest first</p>
        </div>
        <div className="sheet min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-ink">
              <TableRow className="border-0 hover:bg-ink">
                {["Time", "Bib", "Runner", "Station", "Status", ""].map((h) => (
                  <TableHead key={h} className="h-10 text-sm font-bold uppercase tracking-wider text-sheet">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-lg font-medium text-ink-soft">
                    {p.reads.length === 0 ? "Reads will list here as the readers send them." : "Nothing matches this filter."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className={cn("border-ink/15", p.fresh.has(r.id) && "row-new", (!r.is_passing || r.voided) && "text-ink-soft")}>
                  <TableCell className="whitespace-nowrap py-2 text-lg font-semibold">
                    {p.fresh.has(r.id) ? <Flip key={`t${r.id}`} text={fmtClock(r.read_at_ms)} /> : fmtClock(r.read_at_ms)}
                    <span className="text-sm text-ink-soft">.{String(r.read_at_ms % 1000).padStart(3, "0")}</span>
                  </TableCell>
                  <TableCell className={cn("font-bib py-2 text-4xl", r.voided && "line-through")}>
                    {r.bib ? (p.fresh.has(r.id) ? <Flip key={`b${r.id}`} text={r.bib} /> : r.bib) : <span className="font-sans text-base font-bold">{r.tag}</span>}
                  </TableCell>
                  <TableCell className={cn("py-2 text-lg font-semibold", r.voided && "line-through")}>{r.runner ?? (r.bib ? "" : "Unmapped tag")}</TableCell>
                  <TableCell className="py-2"><StationChip name={r.station} kind={r.station_kind} /></TableCell>
                  <TableCell className="py-2 text-sm font-bold uppercase">
                    <div className="flex flex-wrap gap-1.5">
                      {r.voided && <span className="border-2 border-finish px-1.5 text-finish">Void</span>}
                      {!r.voided && !r.is_passing && <span className="border-2 border-ink px-1.5">Repeat</span>}
                      {!r.time_exact && <span className="border-2 border-ink px-1.5">Late time</span>}
                      {r.device_id === "MANUAL" && <span className="border-2 border-ink bg-ink px-1.5 text-sheet">Manual</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => void toggleVoid(r)} aria-label={r.voided ? "Restore read" : "Void read"}>
                      {r.voided ? <><RotateCcw /> Restore</> : <><Ban /> Void</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-4 min-[1200px]:overflow-auto">
        <ManualEntry stations={p.stations} devices={p.devices} reload={p.reload} goSetup={p.goSetup} />
        <Devices devices={p.devices} stations={p.stations} now={p.now} />
      </aside>
    </div>
  );
}
