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
    let mut tags = std::collections::HashMap::new(); // tag -> bib, to catch the same tag on two runners in the central app
    for p in &rows {
        let f = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("");
        let tag = db::normalize_tag(f("tag"));
        if !tag.is_empty() {
            if let Some(other) = tags.insert(tag, f("bib")) {
                // otherwise the two would take the tag off each other on every pull
                bad.push(format!("bib {}: same tag as bib {other} in the central app", f("bib")));
                continue;
            }
        }
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
                       "device_id": r.device_id, "voided": r.voided, "src": r.src})
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

    /// A race fed by three ESP32s (Start + Finish on laptop A, CP1 on laptop B) through `db::ingest`, the code behind /ingest,
    /// then synced to the central event. Also STATION_DB_DIR: where the two station databases and their CSV exports are kept.
    /// Every check is written to checks.json; the test fails at the end if any did. Seeded by centralapp/e2e/esp-race.mjs.
    #[test]
    #[ignore]
    fn esp_readers_through_station_to_central() {
        let env = |k| std::env::var(k).expect(k);
        let dir = std::path::PathBuf::from(env("STATION_DB_DIR"));
        std::fs::create_dir_all(&dir).unwrap();
        let mut checks: Vec<Value> = Vec::new();
        let mut check = |name: &str, expected: Value, actual: Value| {
            checks.push(json!({"check": name, "ok": expected == actual, "expected": expected, "actual": actual}));
        };
        let laptop = |file: &str, stations: &[(&str, &str, i64)]| {
            let _ = std::fs::remove_file(dir.join(file));
            let c = db::open(&dir.join(file)).unwrap();
            for (k, v) in [("central_url", env("CENTRAL_URL")), ("central_event", env("CENTRAL_EVENT")), ("central_key", env("CENTRAL_KEY"))] {
                db::set_setting(&c, k, &v).unwrap();
            }
            for (name, kind, ord) in stations {
                db::save_station(&c, None, name, kind, *ord).unwrap();
            }
            Mutex::new(c)
        };
        let station_id = |db: &Mutex<Connection>, name: &str| -> i64 {
            lock(db).query_row("SELECT id FROM stations WHERE name=?1", [name], |r| r.get(0)).unwrap()
        };
        // what the firmware POSTs: one boot_id for the batch, and per read its seq and age (-1 = recovered after a reboot)
        let send = |db: &Mutex<Connection>, device: &str, boot: &str, now: i64, reads: &[(i64, i64, &str)]| -> usize {
            let b = db::Batch {
                device_id: device.into(),
                boot_id: boot.into(),
                fw: Some("1.4.0".into()),
                queue: Some(0),
                ssid: Some("RaceWiFi".into()),
                reads: reads.iter().map(|(seq, age, tag)| db::IngestRead { seq: *seq, age_ms: Some(*age), tag: tag.to_string(), raw: None }).collect(),
            };
            db::ingest(&mut lock(db), &b, "192.168.1.50", now).unwrap().len()
        };
        let count = |db: &Mutex<Connection>, sql: &str| -> i64 { lock(db).query_row(sql, [], |r| r.get(0)).unwrap() };
        let tag = |bib: i64| format!("E2000{bib}");
        let (a, b) = (laptop("station-A-start-finish.db", &[("Start", "start", 0), ("Finish", "finish", 2)]), laptop("station-B-cp1.db", &[("CP1", "checkpoint", 1)]));
        let (sa, sb) = (Sync::default(), Sync::default());
        let left = |s: &Sync| { let st = s.status.lock().unwrap(); json!([st.pending, st.last_error]) }; // reads still queued, last error
        let (start, finish, cp1) = (station_id(&a, "Start"), station_id(&a, "Finish"), station_id(&b, "CP1")); // not inside a lock(): the mutex is not re-entrant
        let gun = db::now_ms() - 30 * 60_000;
        const MIN: i64 = 60_000;

        sync_once(&a, &sa, true);
        sync_once(&b, &sb, true);
        check("A: roster pulled from central", json!([10, ""]), { let st = sa.status.lock().unwrap(); json!([st.runners_pulled, st.last_error]) });

        // Start: the ESP is switched on before anyone assigns it to a station
        let starts: Vec<(i64, i64, String)> = (101..=109).map(|bib| (bib - 100, 800, tag(bib))).collect();
        let starts: Vec<(i64, i64, &str)> = starts.iter().map(|(s, a, t)| (*s, *a, t.as_str())).collect();
        let n = send(&a, "ESP-START", "s1", gun + 20_000, &starts);
        check("Start: 9 reads stored", json!(9), json!(n));
        check("Start: reads of an unassigned reader wait (not uploaded)", json!(0), json!(db::pending_count(&lock(&a)).unwrap()));
        db::assign_device(&mut lock(&a), "ESP-START", "Start mat", Some(start)).unwrap();
        check("Start: assigning the reader back-fills its reads", json!(9), json!(db::pending_count(&lock(&a)).unwrap()));
        check("Start: lost ACK, same batch resent, no duplicates", json!(0), json!(send(&a, "ESP-START", "s1", gun + 21_000, &starts)));
        db::manual_read(&mut lock(&a), "110", start, gun + 5_000).unwrap(); // 110 has no tag
        sync_once(&a, &sa, false);
        check("Start: everything uploaded", json!([0, ""]), left(&sa));

        // CP1 on laptop B: 109 misses it; 104's tag arrives in lower case with spaces
        send(&b, "ESP-CP1", "c1", gun, &[]); // the reader's first contact registers it
        db::assign_device(&mut lock(&b), "ESP-CP1", "CP1 arch", Some(cp1)).unwrap();
        let cp: Vec<(i64, i64, String)> = (101..=108).map(|bib| (bib - 100, 600, if bib == 104 { " e2000104 ".into() } else { tag(bib) })).collect();
        let cp: Vec<(i64, i64, &str)> = cp.iter().map(|(s, a, t)| (*s, *a, t.as_str())).collect();
        for (i, r) in cp.iter().enumerate() {
            send(&b, "ESP-CP1", "c1", gun + 12 * MIN + i as i64 * 20_000, std::slice::from_ref(r));
        }
        check("CP1: tag normalised to upper case", json!(1), json!(count(&b, "SELECT COUNT(*) FROM reads WHERE tag='E2000104'")));
        sync_once(&b, &sb, false);
        check("CP1: everything uploaded", json!([0, ""]), left(&sb));

        // Finish, boot f1: 101-105, 103 read again (the operator voids it), a tag nobody has; read i at t_fin + i*30 s, one POST
        // after the last. Acked, but 106 is read during that POST, so the queue never empties and the firmware does not
        // compact its flash journal: it still holds seq 1-7.
        send(&a, "ESP-FINISH", "f1", gun, &[]);
        db::assign_device(&mut lock(&a), "ESP-FINISH", "Finish arch", Some(finish)).unwrap();
        let t_fin = gun + 22 * MIN;
        let f1: Vec<(i64, i64, &str)> = ["E2000101", "E2000102", "E2000103", "E2000104", "E2000105", "E2000103", "E2009999"]
            .iter()
            .enumerate()
            .map(|(i, t)| (i as i64 + 1, (7 - i as i64) * 30_000, *t))
            .collect();
        check("Finish f1: 7 reads stored", json!(7), json!(send(&a, "ESP-FINISH", "f1", t_fin + 7 * 30_000, &f1)));
        check(
            "Finish: tag not in the roster shows as unmapped",
            json!(["E2009999"]),
            json!(db::unmapped_tags(&lock(&a)).unwrap().iter().map(|v| v["tag"].clone()).collect::<Vec<_>>()),
        );
        let dup: i64 = lock(&a).query_row("SELECT id FROM reads WHERE device_id='ESP-FINISH' AND seq=6", [], |r| r.get(0)).unwrap();
        db::void_read(&lock(&a), dup, true, "double read").unwrap();
        sync_once(&a, &sa, false);
        check("Finish f1: uploaded, void included", json!([0, ""]), left(&sa));
        let before = count(&a, "SELECT COUNT(*) FROM reads WHERE device_id='ESP-FINISH'");

        // Power cut at the finish. f1 seq 8 (106) and 9 (107) were read while WiFi was down. After the reboot (boot f2) the
        // journal gives back f1 seq 1-9 (age unknown); 108 and 109 cross right after boot. One POST, boot_id "f2", as the firmware does.
        let (t106, t107, cut) = (gun + 25 * MIN, gun + 25 * MIN + 40_000, gun + 26 * MIN);
        let back = cut + 3 * MIN;
        let (t108, t109) = (back + 10_000, back + 25_000);
        let mut post: Vec<(i64, i64, &str)> = f1.iter().map(|(s, _, t)| (*s, -1, *t)).collect();
        post.extend([(8, -1, "E2000106"), (9, -1, "E2000107"), (1, back + 30_000 - t108, "E2000108"), (2, back + 30_000 - t109, "E2000109")]);
        send(&a, "ESP-FINISH", "f2", back + 30_000, &post);
        let new = count(&a, "SELECT COUNT(*) FROM reads WHERE device_id='ESP-FINISH'") - before;
        check("Reboot: only the 4 reads not yet delivered are new (106, 107, 108, 109)", json!(4), json!(new));
        check(
            "Reboot: 108 and 109, read after the reboot, are kept",
            json!(["E2000108", "E2000109"]),
            json!(lock(&a).prepare("SELECT tag FROM reads WHERE device_id='ESP-FINISH' AND tag IN ('E2000108','E2000109') ORDER BY tag").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap).collect::<Vec<_>>()),
        );
        check("Reboot: the voided double read of 103 does not come back unvoided", json!(1), json!(count(&a, "SELECT COUNT(*) FROM reads WHERE tag='E2000103' AND device_id='ESP-FINISH' AND voided=0")));
        check(
            "Reboot: recovered 106/107 are flagged as arrival time, not read time",
            json!([false, false]),
            json!(lock(&a).prepare("SELECT time_exact FROM reads WHERE tag IN ('E2000106','E2000107') AND device_id='ESP-FINISH' ORDER BY tag").unwrap().query_map([], |r| Ok(r.get::<_, i64>(0)? == 1)).unwrap().map(Result::unwrap).collect::<Vec<_>>()),
        );
        db::manual_read(&mut lock(&a), "110", finish, gun + 28 * MIN).unwrap();
        sync_once(&a, &sa, false);
        check("Finish: everything uploaded after the reboot", json!([0, ""]), left(&sa));

        // what the central side should now show, checked by esp-race.mjs
        let expect = json!({"gun": gun, "t106": t106, "t107": t107, "arrival": back + 30_000, "t108": t108, "t109": t109});
        std::fs::write(dir.join("expected-times.json"), expect.to_string()).unwrap();
        for (db, name) in [(&a, "A-start-finish"), (&b, "B-cp1")] {
            let c = lock(db);
            std::fs::write(dir.join(format!("station-{name}-reads.csv")), db::reads_csv(&c, false, "").unwrap()).unwrap();
            std::fs::write(dir.join(format!("station-{name}-results.csv")), db::results_csv(&c).unwrap()).unwrap();
        }
        let failed: Vec<String> = checks.iter().filter(|c| c["ok"] == false).map(|c| c["check"].as_str().unwrap().to_string()).collect();
        std::fs::write(dir.join("station-checks.json"), serde_json::to_string_pretty(&checks).unwrap()).unwrap();
        assert!(failed.is_empty(), "{} of {} checks failed: {failed:#?}", failed.len(), checks.len());
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
