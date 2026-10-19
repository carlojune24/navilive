import { invoke } from "@tauri-apps/api/core";

export type StationKind = "start" | "checkpoint" | "finish";

export interface Read {
  id: number;
  device_id: string;
  seq: number;
  tag: string;
  raw: string;
  read_at_ms: number;
  received_at_ms: number;
  time_exact: boolean;
  station_id: number | null;
  station: string | null;
  station_kind: StationKind | null;
  voided: boolean;
  note: string;
  bib: string | null;
  runner: string | null;
  category: string | null;
  is_passing: boolean;
}
export interface Station {
  id: number;
  name: string;
  kind: StationKind;
  sort_order: number;
  reads: number;
}
export interface Device {
  device_id: string;
  name: string;
  station_id: number | null;
  last_seen_ms: number;
  last_ip: string;
  fw: string;
  queue_depth: number;
  reads: number;
  ssid: string;
}
export interface Runner {
  id: number;
  bib: string;
  name: string;
  category: string;
  tag: string | null;
}
export interface ResultRow {
  tag: string;
  bib: string | null;
  name: string | null;
  category: string | null;
  times: Record<string, number>;
  counts: Record<string, number>;
  elapsed_ms: number | null;
  unassigned: number;
}
export interface Results {
  stations: Station[];
  rows: ResultRow[];
}
export interface AppInfo {
  port: number;
  ips: string[];
  server: string;
  mdns: boolean;
  wifi: string;
  dir: string;
  now_ms: number;
}

export interface SyncStatus {
  configured: boolean;
  pending: number;
  pushed_total: number;
  last_push_ms: number;
  last_contact_ms: number;
  last_pull_ms: number;
  runners_pulled: number;
  last_error: string;
  state: "not-configured" | "connected" | "reconnecting" | "";
  target: string;
  attempts: number;
  failures_in_row: number;
  failing_since_ms: number;
  last_attempt_ms: number;
  next_attempt_ms: number;
  latency_ms: number;
  log: { at_ms: number; ok: boolean; text: string; count: number }[];
}

export const api = {
  info: () => invoke<AppInfo>("app_info"),
  reads: (passingsOnly: boolean, search: string, limit: number) =>
    invoke<Read[]>("list_reads", { passingsOnly, search, limit }),
  voidRead: (id: number, voided: boolean, note = "") => invoke<void>("void_read", { id, voided, note }),
  manualRead: (tag: string, stationId: number, atMs?: number) =>
    invoke<Read[]>("manual_read", { tag, stationId, atMs: atMs ?? null }),
  stations: () => invoke<Station[]>("list_stations"),
  saveStation: (id: number | null, name: string, kind: StationKind, sortOrder: number) =>
    invoke<void>("save_station", { id, name, kind, sortOrder }),
  deleteStation: (id: number) => invoke<void>("delete_station", { id }),
  devices: () => invoke<Device[]>("list_devices"),
  assignDevice: (deviceId: string, name: string, stationId: number | null) =>
    invoke<void>("assign_device", { deviceId, name, stationId }),
  runners: () => invoke<Runner[]>("list_runners"),
  saveRunner: (bib: string, name: string, category: string, tag: string) =>
    invoke<void>("save_runner", { bib, name, category, tag }),
  deleteRunner: (id: number) => invoke<void>("delete_runner", { id }),
  importRunners: (text: string) => invoke<{ saved: number; errors: string[] }>("import_runners", { text }),
  unmappedTags: () => invoke<{ tag: string; count: number; last_ms: number }[]>("unmapped_tags"),
  results: () => invoke<Results>("results"),
  settings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  exportFile: (kind: "reads" | "passings" | "results" | "results-json" | "passings-json" | "reads-json" | "merge", station?: string) => invoke<string>("export_file", { kind, station: station || null }),
  importMerge: (path: string) =>
    invoke<{ added: number; duplicates: number; runners_added: number }>("import_merge", { path }),
  backupNow: () => invoke<string>("backup_now"),
  newEvent: (wipeSetup: boolean) => invoke<{ removed: number; backup: string }>("new_event", { wipeSetup }),
  openFolder: (which: "exports" | "backups") => invoke<void>("open_folder", { which }),
  syncStatus: () => invoke<SyncStatus>("sync_status"),
  syncNow: () => invoke<SyncStatus>("sync_now"),
};

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function fmtClock(ms: number, withMs = false) {
  const d = new Date(ms);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}

export function fmtElapsed(ms: number | null) {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s ago`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m ago`;
}

/** Device counts as online if it posted within this window (ESP32 heartbeats every 5 s). */
export const ONLINE_MS = 15000;

let audio: AudioContext | null = null;
export function beep(freq = 1040) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.14);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.15);
  } catch {
    /* audio unavailable */
  }
}
