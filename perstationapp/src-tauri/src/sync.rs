//! Optional link to the central event app: uploads reads, pulls the participant roster.
//! Offline-safe: reads stay `synced=0` until the central app confirms them, so nothing is lost while disconnected.
use crate::{db, lock};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const BATCH: i64 = 500;
const PUSH_EVERY: Duration = Duration::from_secs(5);
const PULL_EVERY_TICKS: u32 = 12; // every 60 s

#[derive(Default, Clone, Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub pending: i64,
    pub pushed_total: i64,
    pub last_push_ms: i64,
    pub last_contact_ms: i64, // last time the central app answered anything (heartbeat, upload or roster)
    pub last_pull_ms: i64,
    pub runners_pulled: i64,
    pub last_error: String,
    // detailed link status, for the Setup page
    pub state: String, // "not-configured" | "connected" | "reconnecting"
    pub target: String, // where we are talking to: "<address> · <event>"
    pub attempts: i64, // heartbeat attempts since the app started
    pub failures_in_row: i64, // consecutive failed attempts (0 = link is up)
    pub failing_since_ms: i64, // when the current outage began (0 = none)
    pub last_attempt_ms: i64,
    pub next_attempt_ms: i64,
    pub latency_ms: i64, // round trip of the last successful heartbeat
    pub log: Vec<LogLine>, // newest last, capped
}

/// One line of the connection log. A run of identical failures is folded into one line with a count.
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct LogLine {
    pub at_ms: i64,
    pub ok: bool,
    pub text: String,
    pub count: i64,
}

const LOG_KEEP: usize = 40;

pub fn note(st: &mut SyncStatus, at_ms: i64, ok: bool, text: String) {
    if let Some(last) = st.log.last_mut() {
        if last.ok == ok && last.text == text {
            last.count += 1;
            last.at_ms = at_ms;
            return;
        }
    }
    st.log.push(LogLine { at_ms, ok, text, count: 1 });
    if st.log.len() > LOG_KEEP {
        st.log.remove(0);
    }
}

#[derive(Default)]
pub struct Sync {
    pub status: Mutex<SyncStatus>,
    run: Mutex<()>, // one sync at a time (timer vs "Sync now")
}

struct Cfg {
    url: String,
    event: String,
    key: String,
}

fn config(conn: &Connection) -> Option<Cfg> {
    let get = |k| db::get_setting(conn, k, "").trim().to_string();
    let (mut url, event, key) = (get("central_url"), get("central_event"), get("central_key"));
    if url.is_empty() || event.is_empty() || key.is_empty() {
        return None;
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{url}"); // a bare host name means the hosted app; type http:// explicitly for a laptop on the LAN
    }
    Some(Cfg { url: url.trim_end_matches('/').to_string(), event, key })
}

/// Heartbeats must not hold up uploads for long when the network is down.
fn beat_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(4)).build()
}

/// The "I am alive" message, sent every cycle: who this laptop is, its stations and readers, what is waiting, its clock.
/// A central app that predates this endpoint answers 404; that is ignored so uploads keep working.
fn heartbeat(db: &Mutex<Connection>, cfg: &Cfg, last_error: &str) -> Result<(), String> {
    let (id, name, stations, pending) = {
        let c = lock(db);
        let (id, name) = db::laptop_identity(&c);
        (id, name, db::station_beats(&c, db::now_ms()).map_err(|e| e.to_string())?, db::pending_count(&c).unwrap_or(0))
    };
    let body = json!({
        "laptop_id": id, "laptop_name": name, "app_version": env!("CARGO_PKG_VERSION"),
        "now_ms": db::now_ms(), "pending": pending, "last_error": last_error, "stations": stations
    });
    match beat_agent()
        .post(&format!("{}/api/events/{}/heartbeat", cfg.url, cfg.event))
        .set("Authorization", &format!("Bearer {}", cfg.key))
        .send_json(body)
    {
        Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
        Err(e) => Err(explain(e)),
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build()
}

fn explain(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401, _) => "Central app rejected the event or API key".into(),
        ureq::Error::Status(c, _) => format!("Central app answered HTTP {c}"),
        ureq::Error::Transport(t) => format!("Cannot reach central app ({t})"),
    }
}

fn pull(db: &Mutex<Connection>, cfg: &Cfg) -> Result<i64, String> {
    let rows: Vec<Value> = agent()
        .get(&format!("{}/api/events/{}/participants", cfg.url, cfg.event))
        .set("Authorization", &format!("Bearer {}", cfg.key))
        .call()
        .map_err(explain)?
        .into_json()
        .map_err(|e| format!("Bad roster reply: {e}"))?;
    let c = lock(db);
    let (mut ok, mut bad) = (0, Vec::new());
    for p in &rows {
        let f = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("");
        match db::upsert_central_runner(&c, f("bib"), f("name"), f("category"), f("tag")) {
            Ok(()) => ok += 1,
            Err(e) => bad.push(format!("bib {}: {e}", f("bib"))),
        }
    }
    if bad.is_empty() {
        Ok(ok)
    } else {
        Err(format!("{ok} runners updated, {} skipped ({})", bad.len(), bad.iter().take(3).cloned().collect::<Vec<_>>().join("; ")))
    }
}

/// Uploads until nothing is pending or a batch fails. Returns how many reads the central app confirmed.
fn push(db: &Mutex<Connection>, cfg: &Cfg) -> Result<i64, String> {
    let mut total = 0;
    loop {
        let batch = db::unsynced_reads(&lock(db), BATCH).map_err(|e| e.to_string())?; // lock released before the network call
        if batch.is_empty() {
            return Ok(total);
        }
        let body: Vec<Value> = batch
            .iter()
            .map(|r| {
                json!({"tag": r.tag, "bib": r.bib, "station": r.station, "read_at_ms": r.read_at_ms,
                       "device_id": r.device_id, "voided": r.voided})
            })
            .collect();
        let reply: Value = agent()
            .post(&format!("{}/api/events/{}/reads", cfg.url, cfg.event))
            .set("Authorization", &format!("Bearer {}", cfg.key))
            .send_json(json!({ "reads": body }))
            .map_err(explain)?
            .into_json()
            .map_err(|e| format!("Bad upload reply: {e}"))?;
        // only a full acknowledgement counts; anything else retries the same batch next time
        if reply.get("received").and_then(Value::as_u64) != Some(batch.len() as u64) {
            return Err("Central app did not confirm the whole batch".into());
        }
        let sent: Vec<(i64, bool)> = batch.iter().map(|r| (r.id, r.voided)).collect();
        db::mark_synced(&mut lock(db), &sent).map_err(|e| e.to_string())?;
        total += batch.len() as i64;
    }
}

pub fn sync_once(db: &Mutex<Connection>, sy: &Sync, with_pull: bool) {
    let _one = sy.run.lock().unwrap_or_else(|e| e.into_inner());
    let (cfg, pending) = {
        let c = lock(db);
        (config(&c), db::pending_count(&c).unwrap_or(0))
    };
    let mut st = sy.status.lock().unwrap_or_else(|e| e.into_inner());
    st.configured = cfg.is_some();
    st.pending = pending;
    let Some(cfg) = cfg else {
        st.last_error.clear();
        st.state = "not-configured".into();
        return;
    };
    st.target = format!("{} · {}", cfg.url, cfg.event);
    let previous_error = st.last_error.clone();
    drop(st);

    // heartbeat first: it proves the link even when nothing is waiting, and tells us early if the server is unreachable
    let began = Instant::now();
    let beat = heartbeat(db, &cfg, &previous_error);
    let (now, took) = (db::now_ms(), began.elapsed().as_millis() as i64);
    {
        let mut st = sy.status.lock().unwrap_or_else(|e| e.into_inner());
        st.attempts += 1;
        st.last_attempt_ms = now;
        match &beat {
            Err(e) => {
                if st.failures_in_row == 0 {
                    st.failing_since_ms = now;
                }
                st.failures_in_row += 1;
                st.state = "reconnecting".into();
                let text = format!("Attempt failed: {e}");
                note(&mut st, now, false, text);
            }
            Ok(()) => {
                if st.failures_in_row > 0 {
                    let (n, secs) = (st.failures_in_row, (now - st.failing_since_ms) / 1000);
                    note(&mut st, now, true, format!("Reconnected after {n} failed attempt{} ({secs} s)", if n == 1 { "" } else { "s" }));
                } else if st.state != "connected" {
                    note(&mut st, now, true, "Connected to the central app".into());
                }
                st.failures_in_row = 0;
                st.failing_since_ms = 0;
                st.state = "connected".into();
                st.latency_ms = took;
                st.last_contact_ms = now;
            }
        }
        if let Err(e) = beat {
            st.last_error = e; // reads stay queued; the next cycle tries again
            return;
        }
    }

    let mut err = String::new();
    let mut pulled = None;
    if with_pull {
        match pull(db, &cfg) {
            Ok(n) => pulled = Some(n),
            Err(e) => err = e,
        }
    }
    // a failed pull (e.g. one duplicate tag) must not block uploading reads
    let pushed = match push(db, &cfg) {
        Ok(n) => n,
        Err(e) => {
            err = e;
            0
        }
    };
    let pending = db::pending_count(&lock(db)).unwrap_or(0);
    let mut st = sy.status.lock().unwrap_or_else(|e| e.into_inner());
    st.pending = pending;
    st.pushed_total += pushed;
    if err.is_empty() || pushed > 0 {
        st.last_push_ms = db::now_ms();
    }
    if let Some(n) = pulled {
        st.last_pull_ms = db::now_ms();
        st.runners_pulled = n;
    }
    if !err.is_empty() {
        let text = format!("Sync problem: {err}");
        note(&mut st, db::now_ms(), false, text);
    }
    st.last_error = err;
}

pub fn start(db: Arc<Mutex<Connection>>, sy: Arc<Sync>) {
    std::thread::spawn(move || {
        let mut tick = 0u32;
        loop {
            sync_once(&db, &sy, tick % PULL_EVERY_TICKS == 0);
            sy.status.lock().unwrap_or_else(|e| e.into_inner()).next_attempt_ms = db::now_ms() + PUSH_EVERY.as_millis() as i64;
            tick = tick.wrapping_add(1);
            std::thread::sleep(PUSH_EVERY);
        }
    });
}

/// Needs a running central app: CENTRAL_URL, CENTRAL_EVENT, CENTRAL_KEY. Run with `cargo test -- --ignored`.
#[cfg(test)]
mod live_tests {
    use super::*;

    #[test]
    #[ignore]
    fn roster_pull_upload_void_and_offline_queue() {
        let env = |k| std::env::var(k).expect(k);
        let dir = std::env::temp_dir().join(format!("sync-it-{}", db::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::open(&dir.join("t.db")).unwrap();
        for (k, v) in [("central_url", env("CENTRAL_URL")), ("central_event", env("CENTRAL_EVENT")), ("central_key", env("CENTRAL_KEY"))] {
            db::set_setting(&conn, k, &v).unwrap();
        }
        db::save_station(&conn, None, "Start", "start", 0).unwrap();
        db::save_station(&conn, None, "Finish", "finish", 1).unwrap();
        let (start, finish): (i64, i64) = (
            conn.query_row("SELECT id FROM stations WHERE name='Start'", [], |r| r.get(0)).unwrap(),
            conn.query_row("SELECT id FROM stations WHERE name='Finish'", [], |r| r.get(0)).unwrap(),
        );
        let db = Mutex::new(conn);
        let sy = Sync::default();

        sync_once(&db, &sy, true);
        let st = sy.status.lock().unwrap().clone();
        assert_eq!(st.last_error, "", "pull+push should succeed");
        assert!(st.runners_pulled >= 2, "roster pulled: {}", st.runners_pulled);
        assert_eq!(lock(&db).query_row("SELECT COUNT(*) FROM runners WHERE bib='101'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);

        // two reads for bib 101 (tag mapped from the roster), uploaded
        let t0 = db::now_ms() - 600_000;
        {
            let c = lock(&db);
            for (seq, st_id, at) in [(1, start, t0), (2, finish, t0 + 300_000)] {
                c.execute(
                    "INSERT INTO reads(device_id,boot_id,seq,tag,read_at_ms,received_at_ms,station_id) VALUES('E2E','b',?1,'T101',?2,?2,?3)",
                    rusqlite::params![seq, at, st_id],
                )
                .unwrap();
            }
        }
        sync_once(&db, &sy, false);
        assert_eq!(sy.status.lock().unwrap().pending, 0);

        // void the finish read after upload: the void must reach the central app
        let id: i64 = lock(&db).query_row("SELECT id FROM reads WHERE seq=2", [], |r| r.get(0)).unwrap();
        db::void_read(&lock(&db), id, true, "e2e").unwrap();
        assert_eq!(db::pending_count(&lock(&db)).unwrap(), 1);
        sync_once(&db, &sy, false);
        assert_eq!(sy.status.lock().unwrap().pending, 0);

        // unreachable central app: reads queue, nothing lost, error is reported
        db::set_setting(&lock(&db), "central_url", "http://127.0.0.1:9").unwrap();
        lock(&db)
            .execute("INSERT INTO reads(device_id,boot_id,seq,tag,read_at_ms,received_at_ms,station_id) VALUES('E2E','b',3,'T102',1,1,?1)", [start])
            .unwrap();
        sync_once(&db, &sy, false);
        let st = sy.status.lock().unwrap().clone();
        assert_eq!(st.pending, 1);
        assert!(st.last_error.contains("Cannot reach"), "{}", st.last_error);
        assert_eq!(st.state, "reconnecting");
        assert_eq!(st.failures_in_row, 1);
        assert!(st.log.last().is_some_and(|l| !l.ok && l.text.starts_with("Attempt failed")));
    }

    #[test]
    fn log_folds_repeats_and_is_capped() {
        let mut st = SyncStatus::default();
        note(&mut st, 1, false, "x".into());
        note(&mut st, 2, false, "x".into());
        assert_eq!(st.log, vec![LogLine { at_ms: 2, ok: false, text: "x".into(), count: 2 }]);
        note(&mut st, 3, true, "x".into()); // same text but a different outcome is a new line
        assert_eq!(st.log.len(), 2);
        for i in 0..100 {
            note(&mut st, i, i % 2 == 0, format!("m{i}"));
        }
        assert_eq!(st.log.len(), LOG_KEEP);
    }
}
