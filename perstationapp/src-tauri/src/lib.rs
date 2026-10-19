mod db;
mod server;
mod sync;

use db::{now_ms, ReadFilter};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{Emitter, Manager, State};

pub const PORT: u16 = 4390;
pub const DISCOVERY_PORT: u16 = 4391;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub dir: PathBuf,
    pub server_status: Arc<Mutex<String>>,
    pub mdns_ok: bool,
    pub sync: Arc<sync::Sync>,
}

pub fn lock(m: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn s<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Name of the WiFi network this laptop is connected to (Windows only; empty if none).
fn laptop_wifi() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(out) = std::process::Command::new("netsh")
            .args(["wlan", "show", "interfaces"])
            .creation_flags(0x0800_0000) // no console window flash
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let t = line.trim();
                if t.starts_with("SSID") && !t.starts_with("BSSID") {
                    if let Some((_, v)) = t.split_once(':') {
                        return v.trim().to_string();
                    }
                }
            }
        }
    }
    String::new()
}

#[tauri::command]
fn app_info(st: State<AppState>) -> Value {
    let ips: Vec<String> = local_ip_address::list_afinet_netifas()
        .map(|v| {
            v.into_iter()
                .filter(|(_, ip)| ip.is_ipv4() && !ip.is_loopback())
                .map(|(name, ip)| format!("{ip}  ({name})"))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "port": PORT,
        "ips": ips,
        "server": st.server_status.lock().map(|g| g.clone()).unwrap_or_default(),
        "mdns": st.mdns_ok,
        "wifi": laptop_wifi(),
        "dir": st.dir.to_string_lossy(),
        "now_ms": now_ms(),
    })
}

#[tauri::command]
fn list_reads(st: State<AppState>, passings_only: bool, search: String, limit: i64) -> Result<Vec<Value>, String> {
    db::query_reads(&lock(&st.db), &ReadFilter { passings_only, search, limit, ..Default::default() }).map_err(s)
}

#[tauri::command]
fn void_read(st: State<AppState>, id: i64, voided: bool, note: String) -> Result<(), String> {
    db::void_read(&lock(&st.db), id, voided, &note).map_err(s)
}

#[tauri::command]
fn manual_read(
    app: tauri::AppHandle,
    st: State<AppState>,
    tag: String,
    station_id: i64,
    at_ms: Option<i64>,
) -> Result<Vec<Value>, String> {
    let mut c = lock(&st.db);
    let id = db::manual_read(&mut c, &tag, station_id, at_ms.unwrap_or_else(now_ms)).map_err(s)?;
    let rows = db::query_reads(&c, &ReadFilter { ids: vec![id], ..Default::default() }).map_err(s)?;
    let _ = app.emit("new-reads", &rows);
    Ok(rows)
}

#[tauri::command]
fn list_stations(st: State<AppState>) -> Result<Vec<Value>, String> {
    db::list_stations(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn save_station(st: State<AppState>, id: Option<i64>, name: String, kind: String, sort_order: i64) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Station name is required".into());
    }
    db::save_station(&lock(&st.db), id, &name, &kind, sort_order).map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "A station with that name already exists".into()
        }
        e => e.to_string(),
    })
}

#[tauri::command]
fn delete_station(st: State<AppState>, id: i64) -> Result<(), String> {
    db::delete_station(&lock(&st.db), id)
}

#[tauri::command]
fn list_devices(st: State<AppState>) -> Result<Vec<Value>, String> {
    db::list_devices(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn assign_device(st: State<AppState>, device_id: String, name: String, station_id: Option<i64>) -> Result<(), String> {
    db::assign_device(&mut lock(&st.db), &device_id, &name, station_id).map_err(s)
}

#[tauri::command]
fn list_runners(st: State<AppState>) -> Result<Vec<Value>, String> {
    db::list_runners(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn save_runner(st: State<AppState>, bib: String, name: String, category: String, tag: String) -> Result<(), String> {
    db::save_runner(&lock(&st.db), &bib, &name, &category, &tag)
}

#[tauri::command]
fn delete_runner(st: State<AppState>, id: i64) -> Result<(), String> {
    db::delete_runner(&lock(&st.db), id).map_err(s)
}

#[tauri::command]
fn import_runners(st: State<AppState>, text: String) -> Result<Value, String> {
    let (ok, errs) = db::import_runners(&mut lock(&st.db), &text).map_err(s)?;
    Ok(json!({"saved": ok, "errors": errs}))
}

#[tauri::command]
fn unmapped_tags(st: State<AppState>) -> Result<Vec<Value>, String> {
    db::unmapped_tags(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn results(st: State<AppState>) -> Result<Value, String> {
    db::results(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn get_settings(st: State<AppState>) -> Result<Value, String> {
    db::all_settings(&lock(&st.db)).map_err(s)
}

#[tauri::command]
fn set_setting(st: State<AppState>, key: String, value: String) -> Result<(), String> {
    if key == "debounce_s" && value.parse::<i64>().map(|n| !(0..=3600).contains(&n)).unwrap_or(true) {
        return Err("Debounce must be 0-3600 seconds".into());
    }
    db::set_setting(&lock(&st.db), &key, &value).map_err(s)
}

fn stamp() -> String {
    // seconds since epoch keeps export names unique and sortable
    (now_ms() / 1000).to_string()
}

#[tauri::command]
fn export_file(st: State<AppState>, kind: String, station: Option<String>) -> Result<String, String> {
    let c = lock(&st.db);
    let station = station.unwrap_or_default(); // reads/passings exports only; empty = every station
    let tag = if station.is_empty() { String::new() } else { format!("-{}", station.chars().map(|ch| if ch.is_alphanumeric() { ch } else { '_' }).collect::<String>()) };
    let (name, body) = match kind.as_str() {
        "reads" => (format!("reads{tag}-{}.csv", stamp()), db::reads_csv(&c, false, &station).map_err(s)?),
        "passings" => (format!("passings{tag}-{}.csv", stamp()), db::reads_csv(&c, true, &station).map_err(s)?),
        "results" => (format!("results-{}.csv", stamp()), db::results_csv(&c).map_err(s)?),
        "results-json" => (
            format!("results-{}.json", stamp()),
            serde_json::to_string_pretty(&db::results_json(&c).map_err(s)?).map_err(s)?,
        ),
        "passings-json" => (
            format!("passings{tag}-{}.json", stamp()),
            serde_json::to_string_pretty(&db::passings_json(&c, &station).map_err(s)?).map_err(s)?,
        ),
        "reads-json" => (
            format!("reads{tag}-{}.json", stamp()),
            serde_json::to_string_pretty(&db::all_reads_json(&c, &station).map_err(s)?).map_err(s)?,
        ),
        "merge" => (
            format!("station-export-{}.json", stamp()),
            serde_json::to_string(&db::export_reads_json(&c).map_err(s)?).map_err(s)?,
        ),
        _ => return Err("Unknown export".into()),
    };
    let dir = export_dir(&st, &c);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot use folder {}: {e}", dir.display()))?;
    let path = dir.join(name);
    std::fs::write(&path, body).map_err(|e| format!("Cannot save to {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Folder chosen in the Export dialog (setting `export_dir`), or the app's own exports folder.
fn export_dir(st: &AppState, c: &Connection) -> PathBuf {
    db::all_settings(c)
        .ok()
        .and_then(|v| v["export_dir"].as_str().map(|p| p.trim().to_string()))
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| st.dir.join("exports"))
}

#[tauri::command]
fn import_merge(st: State<AppState>, path: String) -> Result<Value, String> {
    let text = std::fs::read_to_string(path.trim().trim_matches('"')).map_err(|e| format!("Cannot read file: {e}"))?;
    let doc: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid file: {e}"))?;
    db::import_reads_json(&mut lock(&st.db), &doc)
}

#[tauri::command]
fn sync_status(st: State<AppState>) -> sync::SyncStatus {
    st.sync.status.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Runs an upload + roster pull now (blocking network work stays off the UI thread).
#[tauri::command]
async fn sync_now(st: State<'_, AppState>) -> Result<sync::SyncStatus, String> {
    let (db, sy) = (st.db.clone(), st.sync.clone());
    tauri::async_runtime::spawn_blocking(move || {
        sync::sync_once(&db, &sy, true);
        let out = sy.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
        out
    })
    .await
    .map_err(s)
}

#[tauri::command]
fn backup_now(st: State<AppState>) -> Result<String, String> {
    make_backup(&st.db, &st.dir, &format!("manual-{}", stamp()))
}

#[tauri::command]
fn new_event(app: tauri::AppHandle, st: State<AppState>, wipe_setup: bool) -> Result<Value, String> {
    // the backup comes first so a mistaken reset can always be undone from the backups folder
    let backup = make_backup(&st.db, &st.dir, &format!("before-reset-{}", stamp()))?;
    let removed = db::clear_event(&mut lock(&st.db), wipe_setup).map_err(s)?;
    let _ = app.emit("new-reads", Vec::<Value>::new());
    Ok(json!({"removed": removed, "backup": backup}))
}

#[tauri::command]
fn open_folder(st: State<AppState>, which: String) -> Result<(), String> {
    let p = if which == "backups" { st.dir.join("backups") } else { export_dir(&st, &lock(&st.db)) };
    std::fs::create_dir_all(&p).map_err(s)?;
    std::process::Command::new("explorer").arg(p).spawn().map_err(s)?;
    Ok(())
}

fn make_backup(db: &Mutex<Connection>, dir: &std::path::Path, label: &str) -> Result<String, String> {
    let bdir = dir.join("backups");
    std::fs::create_dir_all(&bdir).map_err(s)?;
    let path = bdir.join(format!("race-{label}.db"));
    let _ = std::fs::remove_file(&path);
    lock(db).execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()]).map_err(s)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("race.db"))?;
            let db = Arc::new(Mutex::new(conn));
            let status = Arc::new(Mutex::new(String::from("starting")));
            let mdns_ok = server::start(app.handle().clone(), db.clone(), status.clone());
            // rotating automatic backups every 5 minutes (last 6 kept)
            {
                let (db, dir) = (db.clone(), dir.clone());
                std::thread::spawn(move || {
                    let mut n = 0u32;
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(300));
                        let _ = make_backup(&db, &dir, &format!("auto-{}", n % 6));
                        n += 1;
                    }
                });
            }
            let sync = Arc::new(sync::Sync::default());
            sync::start(db.clone(), sync.clone());
            app.manage(AppState { db, dir, server_status: status, mdns_ok, sync });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_reads,
            void_read,
            manual_read,
            list_stations,
            save_station,
            delete_station,
            list_devices,
            assign_device,
            list_runners,
            save_runner,
            delete_runner,
            import_runners,
            unmapped_tags,
            results,
            get_settings,
            set_setting,
            export_file,
            import_merge,
            backup_now,
            sync_status,
            sync_now,
            new_event,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
