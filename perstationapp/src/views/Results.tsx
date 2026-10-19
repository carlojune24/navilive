import { useCallback, useEffect, useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StationChip } from "@/components/StationChip";
import { api, errText, fmtClock, fmtElapsed, type Results as R } from "@/lib/api";

export function Results({ version }: { version: number }) {
  const [data, setData] = useState<R | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    api.results().then(setData).catch((e) => toast.error(errText(e)));
  }, []);
  useEffect(load, [load, version]);

  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [folder, setFolder] = useState("");
  const [station, setStation] = useState(""); // "" = every station; applies to Passings and All reads

  // the saved choice, or the app's own exports folder when none was picked
  useEffect(() => {
    if (!exportOpen) return;
    Promise.all([api.settings(), api.info()])
      .then(([s, i]) => setFolder(s.export_dir?.trim() || `${i.dir}\\exports`))
      .catch(() => {});
  }, [exportOpen]);

  const chooseFolder = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, defaultPath: folder || undefined, title: "Choose where exports are saved" });
      if (typeof picked !== "string") return;
      await api.setSetting("export_dir", picked);
      setFolder(picked);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const doExport = async (what: "results" | "passings" | "reads") => {
    try {
      const path = await api.exportFile(format === "json" ? (`${what}-json` as const) : what, what === "results" ? undefined : station);
      toast.success(`Saved ${path}`);
      setExportOpen(false);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const rows = (data?.rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    return !s || [r.bib, r.name, r.tag, r.category].some((v) => v?.toLowerCase().includes(s));
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-5">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="font-bib text-6xl">RESULTS</h1>
        <p className="pb-1 text-base font-semibold text-ink-soft">
          First counted passing per station. Ordered by furthest station reached, then time.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input aria-label="Filter results" placeholder="Filter bib, name, tag" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
          <Button variant="outline" onClick={() => setExportOpen(true)}><Download /> Export</Button>
          <Dialog open={exportOpen} onOpenChange={setExportOpen}>
            <DialogContent className="border-2 border-ink">
              <DialogHeader>
                <DialogTitle className="font-bib text-3xl">EXPORT</DialogTitle>
                <DialogDescription>Choose a folder and file format, then what to export.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 border-2 border-ink p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase text-ink-soft">Save to</p>
                  <p className="break-all text-sm font-semibold" title={folder}>{folder || "..."}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void chooseFolder()}><FolderOpen /> Change</Button>
              </div>
              <div role="radiogroup" aria-label="File format" className="grid grid-cols-2 gap-2">
                {(["csv", "json"] as const).map((f) => (
                  <Button key={f} role="radio" aria-checked={format === f} variant={format === f ? "default" : "outline"} onClick={() => setFormat(f)}>
                    {f.toUpperCase()}
                  </Button>
                ))}
              </div>
              <p className="text-sm font-medium text-ink-soft">
                {format === "csv" ? "For Excel. Tags may lose leading zeros if re-saved from Excel." : "For uploading to another system. Times are given in epoch ms and UTC."}
              </p>
              <label className="flex items-center gap-2 border-2 border-ink p-2">
                <span className="text-xs font-bold uppercase text-ink-soft">Station</span>
                <select aria-label="Station to export" value={station} onChange={(e) => setStation(e.target.value)} className="h-9 min-w-0 flex-1 border-2 border-ink bg-sheet px-2 text-sm font-semibold">
                  <option value="">All stations</option>
                  {(data?.stations ?? []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                <span className="text-xs font-medium text-ink-soft">Passings and All reads only</span>
              </label>
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => void doExport("results")}><Download /> Results <span className="font-medium text-ink-soft">one row per runner</span></Button>
                <Button variant="outline" onClick={() => void doExport("passings")}><Download /> Passings <span className="font-medium text-ink-soft">counted passings only</span></Button>
                <Button variant="outline" onClick={() => void doExport("reads")}><Download /> All reads <span className="font-medium text-ink-soft">every read, repeats and voided</span></Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="sheet min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-ink">
            <TableRow className="border-0 hover:bg-ink">
              <TableHead className="h-12 w-14 text-sm font-bold uppercase text-sheet">#</TableHead>
              <TableHead className="h-12 text-sm font-bold uppercase text-sheet">Bib</TableHead>
              <TableHead className="h-12 text-sm font-bold uppercase text-sheet">Runner</TableHead>
              {(data?.stations ?? []).map((s) => (
                <TableHead key={s.id} className="h-12"><StationChip name={s.name} kind={s.kind} /></TableHead>
              ))}
              <TableHead className="h-12 text-right text-sm font-bold uppercase text-sheet">Elapsed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4 + (data?.stations.length ?? 0)} className="py-14 text-center text-lg font-medium text-ink-soft">
                  {data?.stations.length === 0 ? "Create stations in Setup, then results fill in as runners pass." : "No passings yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.bib ?? `t:${r.tag}`} className="border-ink/15">
                <TableCell className="py-2 text-lg font-semibold text-ink-soft">{i + 1}</TableCell>
                <TableCell className="font-bib py-2 text-4xl">{r.bib ?? <span className="font-sans text-base font-bold">{r.tag}</span>}</TableCell>
                <TableCell className="py-2 text-lg font-semibold">
                  {r.name ?? (r.bib ? "" : "Unmapped tag")}
                  {r.category && <span className="ml-2 text-sm font-medium text-ink-soft">{r.category}</span>}
                </TableCell>
                {(data?.stations ?? []).map((s) => {
                  const t = r.times[String(s.id)];
                  const n = r.counts[String(s.id)] ?? 0;
                  return (
                    <TableCell key={s.id} className="py-2 text-lg font-semibold">
                      {t ? fmtClock(t) : <span className="text-ink-soft">Not yet</span>}
                      {n > 1 && <span className="ml-1.5 text-sm font-bold text-ink-soft">x{n}</span>}
                    </TableCell>
                  );
                })}
                <TableCell className="font-bib py-2 text-right text-3xl">
                  {r.elapsed_ms != null ? fmtElapsed(r.elapsed_ms) : <span className="font-sans text-base font-semibold text-ink-soft">Running</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
