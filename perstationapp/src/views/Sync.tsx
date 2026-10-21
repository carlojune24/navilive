import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StationChip } from "@/components/StationChip";
import { ago, api, errText, fmtClock, type Read, type SyncStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

type Filter = "waiting" | "sent" | "all";
const LIMIT = 5000; // newest first; the counts above come from these rows, so a bigger event shows "newest 5000"

export function Sync({ version, now, goSetup }: { version: number; now: number; goSetup: () => void }) {
  const [reads, setReads] = useState<Read[]>([]);
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [station, setStation] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.reads(false, "", LIMIT).then(setReads).catch(() => {});
    api.syncStatus().then(setSt).catch(() => {});
  };
  // new reads bump `version`; the poll catches the background upload flipping reads to Sent
  useEffect(load, [version]);
  useEffect(() => {
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const waiting = reads.filter((r) => !r.synced).length;
  const perStation = useMemo(() => {
    const m = new Map<string, { sent: number; waiting: number }>();
    for (const r of reads) {
      const k = r.station ?? "No station";
      const c = m.get(k) ?? { sent: 0, waiting: 0 };
      r.synced ? c.sent++ : c.waiting++;
      m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reads]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reads.filter((r) => {
      if (filter === "waiting" && r.synced) return false;
      if (filter === "sent" && !r.synced) return false;
      if (station && (r.station ?? "No station") !== station) return false;
      return !q || [r.tag, r.bib, r.runner, r.station].some((v) => v?.toLowerCase().includes(q));
    });
  }, [reads, filter, station, search]);

  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await api.syncNow();
      setSt(r);
      load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const link = !st ? "…" : !st.configured ? "Not connected to a central app" : st.state === "connected" ? "Connected" : "Reconnecting";
  const tabs: [Filter, string][] = [["waiting", `Not yet sent (${waiting})`], ["sent", `Sent (${reads.length - waiting})`], ["all", `All (${reads.length})`]];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="sheet p-4"><p className="text-sm font-bold uppercase text-ink-soft">Not yet sent</p><p className={cn("font-bib text-5xl", waiting > 0 && "text-finish")}>{waiting}</p></div>
        <div className="sheet p-4"><p className="text-sm font-bold uppercase text-ink-soft">Sent to central</p><p className="font-bib text-5xl">{reads.length - waiting}</p></div>
        <div className="sheet p-4"><p className="text-sm font-bold uppercase text-ink-soft">Last upload</p><p className="text-xl font-bold">{st?.last_push_ms ? ago(st.last_push_ms, now) : "never"}</p></div>
        <div className="sheet p-4">
          <p className="text-sm font-bold uppercase text-ink-soft">Connection</p>
          <p className="text-xl font-bold">{link}</p>
          {st?.configured ? (
            st.last_error && <p className="text-sm font-semibold text-finish">{st.last_error}</p>
          ) : (
            <button type="button" className="text-sm font-bold underline" onClick={goSetup}>Set it up in Setup</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={cn("h-10 border-2 border-ink px-4 text-base font-bold uppercase", filter === id ? "bg-ink text-sheet" : "bg-sheet")}>{label}</button>
        ))}
        <div className="relative ml-2 w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <Input aria-label="Search reads" placeholder="Search bib, name or tag" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => void syncNow()} disabled={busy || !st?.configured}><RefreshCw className={cn(busy && "animate-spin")} /> Send now</Button>
      </div>

      {perStation.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Filter by station">
          <button type="button" onClick={() => setStation("")} aria-pressed={!station} className={cn("border-2 border-ink px-3 py-1 text-sm font-bold uppercase", !station ? "bg-ink text-sheet" : "bg-sheet")}>All stations</button>
          {perStation.map(([name, c]) => (
            <button key={name} type="button" onClick={() => setStation(name === station ? "" : name)} aria-pressed={station === name}
              className={cn("border-2 border-ink px-3 py-1 text-sm font-bold uppercase", station === name ? "bg-ink text-sheet" : "bg-sheet")}>
              {name} · {c.waiting} waiting / {c.sent} sent
            </button>
          ))}
        </div>
      )}

      <div className="sheet min-h-[320px] flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-ink">
            <TableRow className="border-0 hover:bg-ink">
              {["Time", "Bib", "Runner", "Station", "Reader", "Status"].map((h) => (
                <TableHead key={h} className="h-10 text-sm font-bold uppercase tracking-wider text-sheet">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-lg font-medium text-ink-soft">
                  {filter === "waiting" && reads.length > 0 && !search && !station ? "Everything has been sent to the central app." : "Nothing matches this filter."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="border-ink/15">
                <TableCell className="whitespace-nowrap py-2 text-lg font-semibold">{fmtClock(r.read_at_ms)}<span className="text-sm text-ink-soft">.{String(r.read_at_ms % 1000).padStart(3, "0")}</span></TableCell>
                <TableCell className={cn("font-bib py-2 text-4xl", r.voided && "line-through")}>{r.bib ?? <span className="font-sans text-base font-bold">{r.tag}</span>}</TableCell>
                <TableCell className={cn("py-2 text-lg font-semibold", r.voided && "line-through")}>{r.runner ?? (r.bib ? "" : "Unmapped tag")}</TableCell>
                <TableCell className="py-2"><StationChip name={r.station} kind={r.station_kind} /></TableCell>
                <TableCell className="py-2 text-sm font-semibold text-ink-soft">{r.device_id}</TableCell>
                <TableCell className="py-2 text-sm font-bold uppercase">
                  {r.synced
                    ? <span className="border-2 border-ink px-1.5">Sent</span>
                    : <span className="border-2 border-finish bg-finish px-1.5 text-white">Not yet sent</span>}
                  {r.voided && <span className="ml-1.5 border-2 border-finish px-1.5 text-finish">Void</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
