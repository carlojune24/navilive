import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Radio, Trophy, Users, Settings2, CloudUpload } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { api, beep, ONLINE_MS, type AppInfo, type Device, type Read, type Station } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Live } from "@/views/Live";
import { Results } from "@/views/Results";
import { Runners } from "@/views/Runners";
import { Setup } from "@/views/Setup";
import { Sync } from "@/views/Sync";

type View = "live" | "results" | "runners" | "sync" | "setup";
const NAV: { id: View; label: string; icon: typeof Radio }[] = [
  { id: "live", label: "Live", icon: Radio },
  { id: "results", label: "Results", icon: Trophy },
  { id: "runners", label: "Runners", icon: Users },
  { id: "sync", label: "Sync", icon: CloudUpload },
  { id: "setup", label: "Setup", icon: Settings2 },
];
const FEED_LIMIT = 400;

export default function App() {
  const [view, setView] = useState<View>("live");
  const [reads, setReads] = useState<Read[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [version, setVersion] = useState(0);
  const [beepOn, setBeepOn] = useState(() => {
    try {
      return localStorage.getItem("beep") !== "0";
    } catch {
      return true;
    }
  });
  const beepRef = useRef(beepOn);
  beepRef.current = beepOn;

  const reload = useCallback(() => {
    api.reads(false, "", FEED_LIMIT).then(setReads).catch(() => {});
    api.stations().then(setStations).catch(() => {});
    api.devices().then(setDevices).catch(() => {});
    api.info().then(setInfo).catch(() => {});
    setVersion((v) => v + 1);
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const r = setInterval(() => {
      api.devices().then(setDevices).catch(() => {});
      api.info().then(setInfo).catch(() => {});
    }, 4000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  useEffect(() => {
    const subs = [
      listen<Read[]>("new-reads", (e) => {
        const incoming = e.payload;
        if (!incoming.length) return;
        setReads((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const add = incoming.filter((r) => !seen.has(r.id));
          return [...add, ...prev].sort((a, b) => b.read_at_ms - a.read_at_ms || b.id - a.id).slice(0, FEED_LIMIT);
        });
        const ids = new Set(incoming.map((r) => r.id));
        setFresh((f) => new Set([...f, ...ids]));
        setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !ids.has(x)))), 3000);
        if (beepRef.current) beep();
        setVersion((v) => v + 1);
        api.stations().then(setStations).catch(() => {});
      }),
      listen("device-ping", () => api.devices().then(setDevices).catch(() => {})),
    ];
    return () => {
      subs.forEach((s) => s.then((un) => un()));
    };
  }, []);

  const setBeep = (v: boolean) => {
    setBeepOn(v);
    try {
      localStorage.setItem("beep", v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  const online = devices.filter((d) => now - d.last_seen_ms < ONLINE_MS).length;
  const serverOk = info?.server === "listening";
  const allIps = (info?.ips ?? []).map((s) => ({ ip: s.split("  ")[0], name: s.split("  ")[1] ?? "" }));
  const wifiIps = allIps.filter((x) => /wi-?fi|wlan|wireless/i.test(x.name));
  const shownIps = (wifiIps.length ? wifiIps : allIps).map((x) => x.ip);

  return (
    <>
    <div className="grid h-full grid-cols-[68px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[216px_minmax(0,1fr)]">
      {/* icon rail below lg, full sidebar from lg up */}
      <nav className="flex min-h-0 flex-col overflow-y-auto border-r-2 border-ink bg-sheet" aria-label="Main">
        <div className="perf-b px-2 pb-4 pt-5 text-center lg:px-5 lg:pb-5 lg:pt-6 lg:text-left">
          <p className="font-bib text-3xl leading-none lg:hidden" aria-hidden>RT</p>
          <p className="font-bib hidden text-[44px] lg:block">RACE</p>
          <p className="font-bib hidden text-[44px] lg:block">TRACKER</p>
          <span className="sr-only lg:hidden">Race Tracker</span>
        </div>
        <ul className="mt-3 flex-1 space-y-1 px-2 lg:px-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setView(id)}
                aria-current={view === id ? "page" : undefined}
                aria-label={label}
                title={label}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-3 border-2 text-lg font-bold uppercase tracking-wide lg:justify-start lg:px-3",
                  view === id ? "border-ink bg-ink text-sheet" : "border-transparent hover:border-ink hover:bg-accent",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden /> <span className="hidden lg:inline">{label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="perf-t space-y-2 px-2 pb-5 pt-4 text-sm font-bold uppercase lg:px-5">
          <p className="flex items-center justify-center gap-2 lg:justify-start" title={serverOk ? `Listening :${info?.port}` : "Server not running"}>
            <span aria-hidden className={cn("size-3.5 shrink-0 border-2 border-ink", serverOk ? "bg-start" : "bg-finish")} />
            <span className="hidden lg:inline">{serverOk ? `Listening :${info?.port}` : "Server not running"}</span>
            <span className="sr-only lg:hidden">{serverOk ? `Listening on port ${info?.port}` : "Server not running"}</span>
          </p>
          <p className="flex items-center justify-center gap-2 lg:justify-start" title={`${online} of ${devices.length} readers online`}>
            <span aria-hidden className={cn("size-3.5 shrink-0 border-2 border-ink", online > 0 && "bg-start")} />
            <span className="hidden lg:inline">{online} of {devices.length} readers online</span>
            <span className="text-xs lg:hidden" aria-label={`${online} of ${devices.length} readers online`}>{online}/{devices.length}</span>
          </p>
          <div className="hidden space-y-0.5 pt-1 text-sm font-semibold normal-case lg:block">
            <p className="break-all"><span className="text-ink-soft">WiFi </span>{info?.wifi || "not on WiFi"}</p>
            <p className="break-all"><span className="text-ink-soft">Laptop </span>{shownIps.length ? shownIps.join(", ") : "no network"}</p>
          </div>
        </div>
      </nav>
      <main className="min-h-0 min-w-0">
        {!serverOk && info && (
          <div role="alert" className="border-b-2 border-ink bg-finish px-5 py-3 text-base font-bold text-white">
            {info.server}
          </div>
        )}
        <div className={cn("min-h-0", !serverOk && info ? "h-[calc(100%-3rem)]" : "h-full")}>
          {view === "live" && (
            <Live reads={reads} stations={stations} devices={devices} now={now} fresh={fresh} beepOn={beepOn} setBeepOn={setBeep} reload={reload} goSetup={() => setView("setup")} />
          )}
          {view === "results" && <Results version={version} />}
          {view === "runners" && <Runners reads={reads} version={version} reload={reload} />}
          {view === "sync" && <Sync version={version} now={now} goSetup={() => setView("setup")} />}
          {view === "setup" && <Setup stations={stations} devices={devices} info={info} now={now} reload={reload} />}
        </div>
      </main>
    </div>
    <Toaster />
    </>
  );
}
