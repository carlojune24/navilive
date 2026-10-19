import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Trash2, Upload, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errText, fmtClock, type Read, type Runner } from "@/lib/api";

const IMPORT_COLUMNS = [
  { name: "bib", need: "Required", note: "Unique per runner, e.g. 101. A bib that already exists is updated." },
  { name: "name", need: "Optional", note: "Put it in quotes if it has a comma: \"Santos, Maria\"" },
  { name: "tag", need: "Optional", note: "RFID number the reader sends, e.g. 0000000001. Leave empty if the tag carries the bib." },
  { name: "category", need: "Optional", note: "e.g. 10K or Women 21K" },
];

const IMPORT_EXAMPLE = `bib,name,tag,category
101,Maria Santos,0000000001,10K
102,"Cruz, Juan",0000000004,5K
103,Ana Reyes,,5K`;

export function Runners({ reads, version, reload }: { reads: Read[]; version: number; reload: () => void }) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [unmapped, setUnmapped] = useState<{ tag: string; count: number; last_ms: number }[]>([]);
  const [f, setF] = useState({ bib: "", name: "", category: "", tag: "" });
  const [bulk, setBulk] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const bulkLines = bulk.split(/\r?\n/).filter((l) => l.trim()).length;

  const load = useCallback(() => {
    api.runners().then(setRunners).catch((e) => toast.error(errText(e)));
    api.unmappedTags().then(setUnmapped).catch(() => {});
  }, []);
  useEffect(load, [load, version]);
  // runner changes alter how existing reads are labelled, so refresh the shared feed too
  const changed = () => {
    load();
    reload();
  };

  const lastTag = reads.find((r) => !r.voided)?.tag ?? "";

  const save = async () => {
    try {
      await api.saveRunner(f.bib, f.name, f.category, f.tag);
      toast.success(`Saved bib ${f.bib.trim()}`);
      setF({ bib: "", name: "", category: "", tag: "" });
      changed();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const importBulk = async () => {
    try {
      const r = await api.importRunners(bulk);
      toast.success(`${r.saved} runners saved${r.errors.length ? `, ${r.errors.length} lines skipped` : ""}`);
      setImportErrors(r.errors);
      if (!r.errors.length) setBulk("");
      changed();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  // the file is loaded into the box first so it can be checked and fixed before anything is saved
  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setBulk(await file.text());
      setImportErrors([]);
      toast(`Loaded ${file.name}. Check it, then press Import.`);
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const remove = async (id: number) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    try {
      await api.deleteRunner(id);
      setConfirmId(null);
      changed();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="grid h-full grid-cols-[380px_minmax(0,1fr)] gap-5 overflow-hidden p-5">
      <div className="flex min-h-0 flex-col gap-4 overflow-auto">
        <section className="sheet p-4">
          <h2 className="font-bib mb-3 text-3xl">ADD A RUNNER</h2>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="space-y-1">
              <Label htmlFor="r-bib" className="text-sm font-bold uppercase">Bib</Label>
              <Input id="r-bib" value={f.bib} onChange={(e) => setF({ ...f, bib: e.target.value })} className="h-14 text-2xl font-bold" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-name" className="text-sm font-bold uppercase">Name</Label>
              <Input id="r-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-cat" className="text-sm font-bold uppercase">Category</Label>
              <Input id="r-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-tag" className="text-sm font-bold uppercase">RFID tag</Label>
              <div className="flex gap-2">
                <Input id="r-tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} autoComplete="off" className="font-semibold" />
                <Button type="button" variant="outline" disabled={!lastTag} onClick={() => setF({ ...f, tag: lastTag })} title="Use the most recently scanned tag">
                  <ScanLine /> Last scan
                </Button>
              </div>
              <p className="text-sm text-ink-soft">Leave blank if the tag itself carries the bib number.</p>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={!f.bib.trim()}>Save runner</Button>
          </form>
        </section>
        <section className="sheet p-4">
          <h2 className="font-bib mb-1 text-3xl">IMPORT LIST</h2>
          <p className="mb-3 text-sm font-medium text-ink-soft">Choose a CSV file or paste rows, one runner per line.</p>
          <div className="mb-3 border-2 border-ink">
            <p className="border-b-2 border-ink bg-ink px-2 py-1 text-sm font-bold uppercase text-sheet">CSV columns</p>
            <dl className="divide-y-2 divide-ink/15 text-sm">
              {IMPORT_COLUMNS.map((c) => (
                <div key={c.name} className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 px-2 py-1.5">
                  <dt className="font-bold">{c.name}<span className="block text-xs font-semibold text-ink-soft">{c.need}</span></dt>
                  <dd className="font-medium text-ink-soft">{c.note}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm font-medium text-ink-soft">
            <li>With a header row, the columns can be in any order. Without one, use the order above.</li>
            <li>Separator: comma, semicolon or tab. Excel's "CSV UTF-8" works.</li>
            <li>Rows with a problem are skipped and listed. The rest are saved.</li>
          </ul>
          <pre className="mb-3 overflow-x-auto border-2 border-ink bg-sheet p-2 text-xs font-semibold">{IMPORT_EXAMPLE}</pre>
          <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-label="Runner CSV file" onChange={(e) => void pickFile(e)} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()}><FileSpreadsheet /> Choose CSV file</Button>
            <Button variant="outline" onClick={() => { setBulk(IMPORT_EXAMPLE); setImportErrors([]); }}>Use example</Button>
          </div>
          <Textarea aria-label="Runner list" rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={IMPORT_EXAMPLE} className="border-2 border-ink bg-sheet font-medium" />
          {importErrors.length > 0 && (
            <div role="alert" className="mt-3 max-h-36 overflow-auto border-2 border-ink bg-sheet p-2 text-sm font-semibold">
              <p className="mb-1 font-bold uppercase">{importErrors.length} skipped</p>
              <ul className="space-y-0.5">{importErrors.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          <Button className="mt-3 w-full" variant="outline" disabled={!bulk.trim()} onClick={() => void importBulk()}>
            <Upload /> {bulkLines > 0 ? `Import ${bulkLines} line${bulkLines === 1 ? "" : "s"}` : "Import"}
          </Button>
        </section>
        <section className="sheet p-4">
          <h2 className="font-bib mb-1 text-3xl">UNMAPPED TAGS</h2>
          <p className="mb-2 text-sm font-medium text-ink-soft">Tags that were read but belong to no runner. Click one to start a runner with it.</p>
          {unmapped.length === 0 ? (
            <p className="font-semibold">None. Every tag read so far matches a runner.</p>
          ) : (
            <ul className="divide-y-2 divide-ink/15">
              {unmapped.map((u) => (
                <li key={u.tag}>
                  <button type="button" onClick={() => setF({ ...f, tag: u.tag })} className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-accent">
                    <span className="truncate font-bold">{u.tag}</span>
                    <span className="shrink-0 text-sm font-semibold text-ink-soft">{u.count}x, {fmtClock(u.last_ms)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="sheet min-h-0 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-ink">
            <TableRow className="border-0 hover:bg-ink">
              {["Bib", "Name", "Category", "Tag", ""].map((h) => (
                <TableHead key={h} className="h-12 text-sm font-bold uppercase text-sheet">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runners.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-14 text-center text-lg font-medium text-ink-soft">No runners yet. Add one or import a list.</TableCell></TableRow>
            )}
            {runners.map((r) => (
              <TableRow key={r.id} className="border-ink/15">
                <TableCell className="font-bib py-2 text-4xl">
                  <button type="button" className="hover:underline" onClick={() => setF({ bib: r.bib, name: r.name, category: r.category, tag: r.tag ?? "" })} aria-label={`Edit bib ${r.bib}`}>{r.bib}</button>
                </TableCell>
                <TableCell className="py-2 text-lg font-semibold">{r.name}</TableCell>
                <TableCell className="py-2 font-medium">{r.category}</TableCell>
                <TableCell className="py-2 font-medium text-ink-soft">{r.tag ?? "uses bib"}</TableCell>
                <TableCell className="py-2 text-right">
                  <Button variant={confirmId === r.id ? "destructive" : "ghost"} size="sm" onClick={() => void remove(r.id)} onBlur={() => setConfirmId(null)}>
                    <Trash2 /> {confirmId === r.id ? "Confirm delete" : "Delete"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
