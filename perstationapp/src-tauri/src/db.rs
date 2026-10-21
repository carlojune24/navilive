use rusqlite::{params, params_from_iter, types::Value as Sql, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub type Res<T> = rusqlite::Result<T>;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'checkpoint' CHECK(kind IN ('start','checkpoint','finish')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices(
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  station_id INTEGER REFERENCES stations(id),
  last_seen_ms INTEGER NOT NULL DEFAULT 0,
  last_ip TEXT NOT NULL DEFAULT '',
  fw TEXT NOT NULL DEFAULT '',
  queue_depth INTEGER NOT NULL DEFAULT 0,
  ssid TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS runners(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bib TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  tag TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS reads(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tag TEXT NOT NULL,
  raw TEXT NOT NULL DEFAULT '',
  read_at_ms INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  time_exact INTEGER NOT NULL DEFAULT 1,
  station_id INTEGER REFERENCES stations(id),
  voided INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  synced INTEGER NOT NULL DEFAULT 0,
  UNIQUE(device_id, boot_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_reads_tag ON reads(tag, station_id, read_at_ms);
CREATE INDEX IF NOT EXISTS idx_reads_time ON reads(read_at_ms);
INSERT OR IGNORE INTO settings(key,value) VALUES('debounce_s','30');
";

pub fn open(path: &Path) -> Res<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )?;
    c.execute_batch(SCHEMA)?;
    migrate(&c)?;
    Ok(c)
}

fn migrate(c: &Connection) -> Res<()> {
    let has: i64 = c.query_row("SELECT COUNT(*) FROM pragma_table_info('devices') WHERE name='ssid'", [], |r| r.get(0))?;
    if has == 0 {
        c.execute_batch("ALTER TABLE devices ADD COLUMN ssid TEXT NOT NULL DEFAULT ''")?;
    }
    let has: i64 = c.query_row("SELECT COUNT(*) FROM pragma_table_info('reads') WHERE name='synced'", [], |r| r.get(0))?;
    if has == 0 {
        // 0 = not yet confirmed by the central app. Existing reads start unsynced so they upload on first connect.
        c.execute_batch("ALTER TABLE reads ADD COLUMN synced INTEGER NOT NULL DEFAULT 0")?;
    }
    Ok(())
}

// ---------------------------------------------------------------- ingest

#[derive(Deserialize)]
pub struct IngestRead {
    pub seq: i64,
    pub age_ms: Option<i64>,
    pub tag: String,
    pub raw: Option<String>,
}

#[derive(Deserialize)]
pub struct Batch {
    pub device_id: String,
    pub boot_id: String,
    pub fw: Option<String>,
    pub queue: Option<i64>,
    pub ssid: Option<String>,
    #[serde(default)]
    pub reads: Vec<IngestRead>,
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn normalize_tag(s: &str) -> String {
    clip(s.trim(), 128).to_uppercase()
}

/// Commits the whole batch atomically. Returns ids of newly inserted rows
/// (rows already present, identified by device+boot+seq, are ignored).
pub fn ingest(conn: &mut Connection, b: &Batch, ip: &str, now: i64) -> Res<Vec<i64>> {
    let tx = conn.transaction()?;
    let device = clip(&b.device_id, 64);
    tx.execute(
        "INSERT INTO devices(device_id,last_seen_ms,last_ip,fw,queue_depth,ssid) VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(device_id) DO UPDATE SET last_seen_ms=?2,last_ip=?3,fw=?4,queue_depth=?5,
           ssid=CASE WHEN ?6<>'' THEN ?6 ELSE ssid END",
        params![device, now, ip, clip(b.fw.as_deref().unwrap_or(""), 32), b.queue.unwrap_or(0), clip(b.ssid.as_deref().unwrap_or(""), 40)],
    )?;
    let station: Option<i64> = tx
        .query_row("SELECT station_id FROM devices WHERE device_id=?1", [&device], |r| r.get(0))?;
    let mut ids = Vec::new();
    for r in &b.reads {
        let (read_at, exact) = match r.age_ms {
            Some(a) if a >= 0 => (now - a, 1),
            _ => (now, 0),
        };
        let n = tx.execute(
            "INSERT OR IGNORE INTO reads(device_id,boot_id,seq,tag,raw,read_at_ms,received_at_ms,time_exact,station_id)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                device,
                clip(&b.boot_id, 32),
                r.seq,
                normalize_tag(&r.tag),
                clip(r.raw.as_deref().unwrap_or(""), 256),
                read_at,
                now,
                exact,
                station
            ],
        )?;
        if n == 1 {
            ids.push(tx.last_insert_rowid());
        }
    }
    tx.commit()?;
    Ok(ids)
}

// ---------------------------------------------------------------- reads query

#[derive(Default)]
pub struct ReadFilter {
    pub passings_only: bool,
    pub search: String,
    pub limit: i64,
    pub ids: Vec<i64>,
    pub station: String, // exact station name; empty = all stations
}

pub fn get_setting(conn: &Connection, key: &str, default: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .unwrap_or_else(|| default.to_string())
}

const PASSING: &str = "(rd.voided=0 AND NOT EXISTS(SELECT 1 FROM reads p WHERE p.tag=rd.tag AND p.station_id IS rd.station_id \
 AND p.voided=0 AND (p.read_at_ms<rd.read_at_ms OR (p.read_at_ms=rd.read_at_ms AND p.id<rd.id)) \
 AND p.read_at_ms>=rd.read_at_ms-?1))";

pub fn query_reads(conn: &Connection, f: &ReadFilter) -> Res<Vec<Value>> {
    let debounce_ms = get_setting(conn, "debounce_s", "30").parse::<i64>().unwrap_or(30).max(0) * 1000;
    let mut sql = format!(
        "SELECT rd.id, rd.device_id, rd.seq, rd.tag, rd.raw, rd.read_at_ms, rd.received_at_ms, rd.time_exact, \
         rd.station_id, s.name, s.kind, rd.voided, rd.note, COALESCE(rt.bib, rb.bib), COALESCE(rt.name, rb.name), COALESCE(rt.category, rb.category), {PASSING} AS is_passing, rd.synced \
         FROM reads rd LEFT JOIN stations s ON s.id=rd.station_id \
         LEFT JOIN runners rt ON rt.tag=rd.tag \
         LEFT JOIN runners rb ON rb.bib=rd.tag AND rt.id IS NULL \
         WHERE 1=1"
    );
    let mut args: Vec<Sql> = vec![Sql::Integer(debounce_ms)];
    if f.passings_only {
        sql.push_str(&format!(" AND {PASSING}"));
    }
    if !f.search.trim().is_empty() {
        args.push(Sql::Text(format!("%{}%", f.search.trim())));
        let n = args.len();
        sql.push_str(&format!(" AND (rd.tag LIKE ?{n} OR COALESCE(rt.bib, rb.bib) LIKE ?{n} OR COALESCE(rt.name, rb.name) LIKE ?{n})"));
    }
    if !f.station.is_empty() {
        args.push(Sql::Text(f.station.clone()));
        sql.push_str(&format!(" AND s.name=?{}", args.len()));
    }
    if !f.ids.is_empty() {
        let list: Vec<String> = f.ids.iter().map(|i| i.to_string()).collect();
        sql.push_str(&format!(" AND rd.id IN ({})", list.join(",")));
    }
    sql.push_str(" ORDER BY rd.read_at_ms DESC, rd.id DESC");
    if f.limit > 0 {
        sql.push_str(&format!(" LIMIT {}", f.limit));
    }
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params_from_iter(args.iter()), |r| {
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "device_id": r.get::<_, String>(1)?,
            "seq": r.get::<_, i64>(2)?,
            "tag": r.get::<_, String>(3)?,
            "raw": r.get::<_, String>(4)?,
            "read_at_ms": r.get::<_, i64>(5)?,
            "received_at_ms": r.get::<_, i64>(6)?,
            "time_exact": r.get::<_, i64>(7)? == 1,
            "station_id": r.get::<_, Option<i64>>(8)?,
            "station": r.get::<_, Option<String>>(9)?,
            "station_kind": r.get::<_, Option<String>>(10)?,
            "voided": r.get::<_, i64>(11)? == 1,
            "note": r.get::<_, String>(12)?,
            "bib": r.get::<_, Option<String>>(13)?,
            "runner": r.get::<_, Option<String>>(14)?,
            "category": r.get::<_, Option<String>>(15)?,
            "is_passing": r.get::<_, i64>(16)? == 1,
            "synced": r.get::<_, i64>(17)? == 1,
        }))
    })?;
    rows.collect()
}

pub fn void_read(conn: &Connection, id: i64, voided: bool, note: &str) -> Res<()> {
    conn.execute(
        "UPDATE reads SET voided=?2, note=?3, synced=0 WHERE id=?1", // synced=0: the central app must hear about the void
        params![id, voided as i64, clip(note, 200)],
    )?;
    Ok(())
}

pub fn manual_read(conn: &mut Connection, tag_or_bib: &str, station_id: i64, at_ms: i64) -> Res<i64> {
    let tx = conn.transaction()?;
    let key = normalize_tag(tag_or_bib);
    // a manual entry by bib is stored under the runner's tag when one is mapped, so it dedups with real reads
    let tag: String = tx
        .query_row("SELECT COALESCE(tag, bib) FROM runners WHERE bib=?1 COLLATE NOCASE", [&key], |r| r.get(0))
        .optional()?
        .unwrap_or(key);
    let seq: i64 = tx.query_row("SELECT COALESCE(MAX(seq),0)+1 FROM reads WHERE device_id='MANUAL'", [], |r| r.get(0))?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO reads(device_id,boot_id,seq,tag,raw,read_at_ms,received_at_ms,time_exact,station_id,note)
         VALUES('MANUAL','manual',?1,?2,'',?3,?4,1,?5,'manual entry')",
        params![seq, normalize_tag(&tag), at_ms, now, station_id],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(id)
}

/// Starts a fresh event: removes every read. With `wipe_setup` the runners and stations go too.
/// Readers stay registered but are unassigned when the stations are removed. Returns the reads removed.
pub fn clear_event(conn: &mut Connection, wipe_setup: bool) -> Res<i64> {
    let tx = conn.transaction()?;
    let n = tx.execute("DELETE FROM reads", [])? as i64;
    if wipe_setup {
        tx.execute("UPDATE devices SET station_id=NULL", [])?;
        tx.execute("DELETE FROM stations", [])?;
        tx.execute("DELETE FROM runners", [])?;
    }
    tx.commit()?;
    Ok(n)
}

// ---------------------------------------------------------------- stations / devices

pub fn list_stations(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT s.id,s.name,s.kind,s.sort_order,(SELECT COUNT(*) FROM reads WHERE station_id=s.id) FROM stations s ORDER BY s.sort_order,s.id",
    )?;
    let rows = st.query_map([], |r| {
        Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"kind":r.get::<_,String>(2)?,
                  "sort_order":r.get::<_,i64>(3)?,"reads":r.get::<_,i64>(4)?}))
    })?;
    rows.collect()
}

pub fn save_station(conn: &Connection, id: Option<i64>, name: &str, kind: &str, order: i64) -> Res<()> {
    let name = name.trim();
    match id {
        Some(id) => conn.execute("UPDATE stations SET name=?2,kind=?3,sort_order=?4 WHERE id=?1", params![id, name, kind, order])?,
        None => conn.execute("INSERT INTO stations(name,kind,sort_order) VALUES(?1,?2,?3)", params![name, kind, order])?,
    };
    Ok(())
}

pub fn delete_station(conn: &Connection, id: i64) -> Result<(), String> {
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM reads WHERE station_id=?1", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Err(format!("Station has {n} recorded reads and cannot be deleted. Rename it instead."));
    }
    conn.execute("UPDATE devices SET station_id=NULL WHERE station_id=?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM stations WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_devices(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT d.device_id,d.name,d.station_id,d.last_seen_ms,d.last_ip,d.fw,d.queue_depth,
                (SELECT COUNT(*) FROM reads WHERE device_id=d.device_id), d.ssid FROM devices d ORDER BY d.last_seen_ms DESC",
    )?;
    let rows = st.query_map([], |r| {
        Ok(json!({"device_id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"station_id":r.get::<_,Option<i64>>(2)?,
                  "last_seen_ms":r.get::<_,i64>(3)?,"last_ip":r.get::<_,String>(4)?,"fw":r.get::<_,String>(5)?,
                  "queue_depth":r.get::<_,i64>(6)?,"reads":r.get::<_,i64>(7)?,"ssid":r.get::<_,String>(8)?}))
    })?;
    rows.collect()
}

/// Assigning a station also back-fills earlier reads that arrived while the device was unassigned.
pub fn assign_device(conn: &mut Connection, device_id: &str, name: &str, station_id: Option<i64>) -> Res<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE devices SET name=?2, station_id=?3 WHERE device_id=?1", params![device_id, clip(name, 40), station_id])?;
    if let Some(s) = station_id {
        tx.execute("UPDATE reads SET station_id=?2 WHERE device_id=?1 AND station_id IS NULL", params![device_id, s])?;
    }
    tx.commit()
}

// ---------------------------------------------------------------- runners

pub fn list_runners(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn.prepare("SELECT id,bib,name,category,tag FROM runners ORDER BY CAST(bib AS INTEGER), bib")?;
    let rows = st.query_map([], |r| {
        Ok(json!({"id":r.get::<_,i64>(0)?,"bib":r.get::<_,String>(1)?,"name":r.get::<_,String>(2)?,
                  "category":r.get::<_,String>(3)?,"tag":r.get::<_,Option<String>>(4)?}))
    })?;
    rows.collect()
}

pub fn save_runner(conn: &Connection, bib: &str, name: &str, category: &str, tag: &str) -> Result<(), String> {
    let bib = bib.trim();
    if bib.is_empty() {
        return Err("Bib number is required".into());
    }
    let tag = normalize_tag(tag);
    let tag: Option<String> = if tag.is_empty() { None } else { Some(tag) };
    conn.execute(
        "INSERT INTO runners(bib,name,category,tag) VALUES(?1,?2,?3,?4)
         ON CONFLICT(bib) DO UPDATE SET name=?2,category=?3,tag=?4",
        params![bib, name.trim(), category.trim(), tag],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "That tag is already assigned to another runner".to_string()
        }
        e => e.to_string(),
    })?;
    Ok(())
}

pub fn delete_runner(conn: &Connection, id: i64) -> Res<()> {
    conn.execute("DELETE FROM runners WHERE id=?1", [id])?;
    Ok(())
}

/// Picks the separator from the first line: comma, semicolon or tab (ignoring anything inside quotes).
fn detect_delimiter(text: &str) -> char {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let (mut in_q, mut commas, mut semis, mut tabs) = (false, 0, 0, 0);
    for ch in first.chars() {
        match ch {
            '"' => in_q = !in_q,
            ',' if !in_q => commas += 1,
            ';' if !in_q => semis += 1,
            '\t' if !in_q => tabs += 1,
            _ => {}
        }
    }
    if tabs > commas && tabs >= semis {
        '\t'
    } else if semis > commas {
        ';'
    } else {
        ','
    }
}

/// Splits CSV text into records, honouring "quoted, cells", "" escapes and line breaks inside quotes.
/// Blank rows are dropped. Each record carries the 1-based line it starts on.
fn parse_csv(text: &str, delim: char) -> Vec<(usize, Vec<String>)> {
    let mut out = Vec::new();
    let (mut row, mut cell) = (Vec::<String>::new(), String::new());
    let (mut quoted, mut line, mut start) = (false, 1usize, 1usize);
    let mut chars = text.chars().peekable();
    let mut flush = |row: &mut Vec<String>, start: usize| {
        if row.iter().any(|c| !c.trim().is_empty()) {
            out.push((start, std::mem::take(row)));
        } else {
            row.clear();
        }
    };
    while let Some(ch) = chars.next() {
        if quoted {
            match ch {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    cell.push('"');
                }
                '"' => quoted = false,
                '\n' => {
                    line += 1;
                    cell.push('\n');
                }
                c => cell.push(c),
            }
            continue;
        }
        match ch {
            '"' if cell.trim().is_empty() => {
                cell.clear();
                quoted = true;
            }
            c if c == delim => row.push(std::mem::take(&mut cell)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut cell));
                flush(&mut row, start);
                line += 1;
                start = line;
            }
            c => cell.push(c),
        }
    }
    row.push(cell);
    flush(&mut row, start);
    out
}

/// If the first row is a header (it has a bib column), returns the column index of
/// [bib, name, tag, category]; columns may come in any order and be missing except bib.
fn runner_header(cells: &[String]) -> Option<[Option<usize>; 4]> {
    let find = |names: &[&str]| cells.iter().position(|h| names.contains(&h.trim().to_lowercase().as_str()));
    let bib = find(&["bib", "bib number", "bib no", "bib #", "bib no."])?;
    Some([
        Some(bib),
        find(&["name", "runner", "runner name", "full name"]),
        find(&["tag", "rfid", "rfid tag", "epc", "uid", "chip"]),
        find(&["category", "cat", "class", "division", "distance"]),
    ])
}

/// Imports runners from CSV text (comma, semicolon or tab separated; a leading BOM is ignored).
/// With a header row the columns are matched by name in any order; without one the order is
/// bib, name, tag, category. Existing bibs are updated. Returns (saved, errors).
pub fn import_runners(conn: &mut Connection, text: &str) -> Res<(i64, Vec<String>)> {
    let text = text.trim_start_matches('\u{feff}');
    let records = parse_csv(text, detect_delimiter(text));
    let tx = conn.transaction()?;
    let (mut ok, mut errs) = (0, Vec::new());
    let mut cols: [Option<usize>; 4] = [Some(0), Some(1), Some(2), Some(3)];
    for (n, (line, c)) in records.iter().enumerate() {
        if n == 0 {
            if let Some(found) = runner_header(c) {
                cols = found;
                continue;
            }
        }
        let get = |i: Option<usize>| i.and_then(|i| c.get(i)).map(|s| s.trim()).unwrap_or("");
        match save_runner(&tx, get(cols[0]), get(cols[1]), get(cols[3]), get(cols[2])) {
            Ok(()) => ok += 1,
            Err(e) => errs.push(format!("line {line}, bib \"{}\": {e}", get(cols[0]))),
        }
    }
    tx.commit()?;
    Ok((ok, errs))
}

pub fn unmapped_tags(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT tag, COUNT(*), MAX(read_at_ms) FROM reads
         WHERE voided=0 AND tag NOT IN (SELECT tag FROM runners WHERE tag IS NOT NULL) AND tag NOT IN (SELECT bib FROM runners)
         GROUP BY tag ORDER BY MAX(read_at_ms) DESC LIMIT 200",
    )?;
    let rows = st.query_map([], |r| Ok(json!({"tag":r.get::<_,String>(0)?,"count":r.get::<_,i64>(1)?,"last_ms":r.get::<_,i64>(2)?})))?;
    rows.collect()
}

// ---------------------------------------------------------------- results

pub fn results(conn: &Connection) -> Res<Value> {
    let stations = list_stations(conn)?;
    let kind_of: HashMap<i64, String> = stations
        .iter()
        .map(|s| (s["id"].as_i64().unwrap(), s["kind"].as_str().unwrap().to_string()))
        .collect();
    let order_of: HashMap<i64, i64> = stations
        .iter()
        .enumerate()
        .map(|(i, s)| (s["id"].as_i64().unwrap(), i as i64))
        .collect();
    let mut passings = query_reads(conn, &ReadFilter { passings_only: true, limit: 0, ..Default::default() })?;
    passings.reverse();

    struct Row {
        tag: String,
        bib: Option<String>,
        name: Option<String>,
        category: Option<String>,
        times: BTreeMap<i64, i64>,
        counts: BTreeMap<i64, i64>,
        unassigned: i64,
    }
    let mut rows: BTreeMap<String, Row> = BTreeMap::new();
    for p in &passings {
        let tag = p["tag"].as_str().unwrap().to_string();
        let key = p["bib"].as_str().map(String::from).unwrap_or_else(|| format!("tag:{tag}"));
        let row = rows.entry(key).or_insert_with(|| Row {
            tag: tag.clone(),
            bib: p["bib"].as_str().map(String::from),
            name: p["runner"].as_str().map(String::from),
            category: p["category"].as_str().map(String::from),
            times: BTreeMap::new(),
            counts: BTreeMap::new(),
            unassigned: 0,
        });
        match p["station_id"].as_i64() {
            Some(sid) => {
                row.times.entry(sid).or_insert(p["read_at_ms"].as_i64().unwrap());
                *row.counts.entry(sid).or_insert(0) += 1;
            }
            None => row.unassigned += 1,
        }
    }
    let mut out: Vec<(i64, i64, Value)> = rows
        .into_values()
        .map(|r| {
            let start = r.times.iter().find(|(s, _)| kind_of.get(s).map(|k| k == "start").unwrap_or(false)).map(|(_, t)| *t);
            let finish = r.times.iter().find(|(s, _)| kind_of.get(s).map(|k| k == "finish").unwrap_or(false)).map(|(_, t)| *t);
            let elapsed = match (start, finish) {
                (Some(a), Some(b)) if b >= a => Some(b - a),
                _ => None,
            };
            let (far, far_t) = r
                .times
                .iter()
                .map(|(s, t)| (order_of.get(s).copied().unwrap_or(0), *t))
                .max_by_key(|(o, t)| (*o, -*t))
                .unwrap_or((-1, 0));
            (
                -far,
                far_t,
                json!({"tag":r.tag,"bib":r.bib,"name":r.name,"category":r.category,"times":r.times,"counts":r.counts,
                       "elapsed_ms":elapsed,"unassigned":r.unassigned}),
            )
        })
        .collect();
    out.sort_by_key(|(a, b, _)| (*a, *b));
    Ok(json!({"stations":stations,"rows":out.into_iter().map(|x| x.2).collect::<Vec<_>>()}))
}

// ---------------------------------------------------------------- settings / merge / export

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Res<()> {
    conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2", params![key, value])?;
    Ok(())
}

pub fn all_settings(conn: &Connection) -> Res<Value> {
    let mut st = conn.prepare("SELECT key,value FROM settings")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut m = serde_json::Map::new();
    for r in rows {
        let (k, v) = r?;
        m.insert(k, Value::String(v));
    }
    Ok(Value::Object(m))
}

/// Full-fidelity dump of raw reads (+ station name) for merging another station's data.
pub fn export_reads_json(conn: &Connection) -> Res<Value> {
    let mut st = conn.prepare(
        "SELECT rd.device_id,rd.boot_id,rd.seq,rd.tag,rd.raw,rd.read_at_ms,rd.received_at_ms,rd.time_exact,s.name,s.kind,rd.voided,rd.note
         FROM reads rd LEFT JOIN stations s ON s.id=rd.station_id ORDER BY rd.id",
    )?;
    let rows = st.query_map([], |r| {
        Ok(json!({"device_id":r.get::<_,String>(0)?,"boot_id":r.get::<_,String>(1)?,"seq":r.get::<_,i64>(2)?,
                  "tag":r.get::<_,String>(3)?,"raw":r.get::<_,String>(4)?,"read_at_ms":r.get::<_,i64>(5)?,
                  "received_at_ms":r.get::<_,i64>(6)?,"time_exact":r.get::<_,i64>(7)?,"station":r.get::<_,Option<String>>(8)?,
                  "station_kind":r.get::<_,Option<String>>(9)?,"voided":r.get::<_,i64>(10)?,"note":r.get::<_,String>(11)?}))
    })?;
    let reads: Vec<Value> = rows.collect::<Res<_>>()?;
    let runners = list_runners(conn)?;
    Ok(json!({"format":"race-tracker-reads-v1","exported_ms":now_ms(),"reads":reads,"runners":runners}))
}

/// Merge another station's export. Stations are matched by name (created if missing); reads dedup on device+boot+seq.
pub fn import_reads_json(conn: &mut Connection, doc: &Value) -> Result<Value, String> {
    if doc["format"] != "race-tracker-reads-v1" {
        return Err("Not a Race Tracker export file".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (mut added, mut dup) = (0i64, 0i64);
    for r in doc["reads"].as_array().ok_or("Missing reads")? {
        let station_id: Option<i64> = match r["station"].as_str() {
            Some(name) => {
                let kind = r["station_kind"].as_str().unwrap_or("checkpoint");
                tx.execute(
                    "INSERT OR IGNORE INTO stations(name,kind,sort_order) VALUES(?1,?2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM stations))",
                    params![name, kind],
                )
                .map_err(|e| e.to_string())?;
                Some(tx.query_row("SELECT id FROM stations WHERE name=?1", [name], |x| x.get(0)).map_err(|e| e.to_string())?)
            }
            None => None,
        };
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO reads(device_id,boot_id,seq,tag,raw,read_at_ms,received_at_ms,time_exact,station_id,voided,note)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    r["device_id"].as_str().unwrap_or(""),
                    r["boot_id"].as_str().unwrap_or(""),
                    r["seq"].as_i64().unwrap_or(0),
                    normalize_tag(r["tag"].as_str().unwrap_or("")),
                    r["raw"].as_str().unwrap_or(""),
                    r["read_at_ms"].as_i64().unwrap_or(0),
                    r["received_at_ms"].as_i64().unwrap_or(0),
                    r["time_exact"].as_i64().unwrap_or(1),
                    station_id,
                    r["voided"].as_i64().unwrap_or(0),
                    r["note"].as_str().unwrap_or("")
                ],
            )
            .map_err(|e| e.to_string())?;
        if n == 1 { added += 1 } else { dup += 1 }
    }
    let mut runners_added = 0i64;
    if let Some(rs) = doc["runners"].as_array() {
        for r in rs {
            let n = tx
                .execute(
                    "INSERT OR IGNORE INTO runners(bib,name,category,tag) VALUES(?1,?2,?3,?4)",
                    params![r["bib"].as_str().unwrap_or(""), r["name"].as_str().unwrap_or(""), r["category"].as_str().unwrap_or(""), r["tag"].as_str()],
                )
                .map_err(|e| e.to_string())?;
            runners_added += n as i64;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"added":added,"duplicates":dup,"runners_added":runners_added}))
}

fn csv_cell(s: &str) -> String {
    // neutralise spreadsheet formula injection from tag/name text
    let s = if s.starts_with(['=', '+', '-', '@']) { format!("'{s}") } else { s.to_string() };
    if s.contains([',', '"', '\n']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s }
}

pub fn reads_csv(conn: &Connection, passings_only: bool, station: &str) -> Res<String> {
    let rows = query_reads(conn, &ReadFilter { passings_only, station: station.into(), limit: 0, ..Default::default() })?;
    let mut out = String::from("epoch_ms,station,bib,runner,tag,device,seq,voided,exact_time,note\n");
    for r in rows.iter().rev() {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            r["read_at_ms"],
            csv_cell(r["station"].as_str().unwrap_or("")),
            csv_cell(r["bib"].as_str().unwrap_or("")),
            csv_cell(r["runner"].as_str().unwrap_or("")),
            csv_cell(r["tag"].as_str().unwrap_or("")),
            csv_cell(r["device_id"].as_str().unwrap_or("")),
            r["seq"],
            r["voided"],
            r["time_exact"],
            csv_cell(r["note"].as_str().unwrap_or(""))
        ));
    }
    Ok(out)
}

/// UTC ISO-8601 with milliseconds, e.g. 2026-10-04T06:34:54.123Z (days-to-date after Howard Hinnant's civil_from_days).
fn iso_utc(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + (m <= 2) as i64;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Results as one self-describing document for uploading to another system. Times are epoch ms plus UTC ISO text.
pub fn results_json(conn: &Connection) -> Res<Value> {
    let v = results(conn)?;
    let stations = v["stations"].as_array().cloned().unwrap_or_default();
    let rows: Vec<Value> = v["rows"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let passings: Vec<Value> = stations
                .iter()
                .filter_map(|s| {
                    let k = s["id"].as_i64()?.to_string();
                    let t = r["times"][&k].as_i64()?;
                    Some(json!({"station":s["name"],"kind":s["kind"],"time_ms":t,"time_utc":iso_utc(t),"passings":r["counts"][&k]}))
                })
                .collect();
            json!({"rank":i + 1,"bib":r["bib"],"name":r["name"],"category":r["category"],"tag":r["tag"],
                   "elapsed_ms":r["elapsed_ms"],"passings":passings})
        })
        .collect();
    let stations: Vec<Value> = stations.iter().map(|s| json!({"name":s["name"],"kind":s["kind"],"order":s["sort_order"]})).collect();
    Ok(json!({"format":"race-tracker-results-v1","exported_ms":now_ms(),"exported_utc":iso_utc(now_ms()),"stations":stations,"results":rows}))
}

/// Counted passings (voided and repeat reads left out), oldest first.
pub fn passings_json(conn: &Connection, station: &str) -> Res<Value> {
    Ok(read_list_json(conn, true, station, "race-tracker-passings-v1", "passings")?)
}

/// Every raw read including repeats and voided ones, oldest first.
pub fn all_reads_json(conn: &Connection, station: &str) -> Res<Value> {
    Ok(read_list_json(conn, false, station, "race-tracker-allreads-v1", "reads")?)
}

fn read_list_json(conn: &Connection, passings_only: bool, station: &str, format: &str, key: &str) -> Res<Value> {
    let rows = query_reads(conn, &ReadFilter { passings_only, station: station.into(), limit: 0, ..Default::default() })?;
    let list: Vec<Value> = rows
        .iter()
        .rev()
        .map(|r| {
            let t = r["read_at_ms"].as_i64().unwrap_or(0);
            json!({"time_ms":t,"time_utc":iso_utc(t),"station":r["station"],"bib":r["bib"],"runner":r["runner"],
                   "tag":r["tag"],"device":r["device_id"],"seq":r["seq"],"voided":r["voided"],
                   "exact_time":r["time_exact"],"note":r["note"]})
        })
        .collect();
    Ok(json!({"format":format,"exported_ms":now_ms(),"exported_utc":iso_utc(now_ms()),key:list}))
}

pub fn results_csv(conn: &Connection) -> Res<String> {
    let v = results(conn)?;
    let stations = v["stations"].as_array().cloned().unwrap_or_default();
    let mut out = String::from("bib,name,category,tag");
    for s in &stations {
        out.push_str(&format!(",{}_epoch_ms", csv_cell(s["name"].as_str().unwrap_or(""))));
    }
    out.push_str(",elapsed_ms\n");
    for r in v["rows"].as_array().cloned().unwrap_or_default() {
        out.push_str(&format!(
            "{},{},{},{}",
            csv_cell(r["bib"].as_str().unwrap_or("")),
            csv_cell(r["name"].as_str().unwrap_or("")),
            csv_cell(r["category"].as_str().unwrap_or("")),
            csv_cell(r["tag"].as_str().unwrap_or(""))
        ));
        for s in &stations {
            let k = s["id"].as_i64().unwrap().to_string();
            out.push_str(&format!(",{}", r["times"][&k].as_i64().map(|t| t.to_string()).unwrap_or_default()));
        }
        out.push_str(&format!(",{}\n", r["elapsed_ms"].as_i64().map(|t| t.to_string()).unwrap_or_default()));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "db_tests.rs"]
mod tests;

// ---------------------------------------------------------------- central sync

pub struct PushRead {
    pub id: i64,
    pub device_id: String,
    pub tag: String,
    pub bib: Option<String>,
    pub station: String,
    pub read_at_ms: i64,
    pub voided: bool,
}

/// Reads the central app has not confirmed. Reads with no station wait: the central app ranks by station name.
pub fn unsynced_reads(conn: &Connection, limit: i64) -> Res<Vec<PushRead>> {
    let mut st = conn.prepare(
        "SELECT r.id, r.device_id, r.tag, COALESCE(rt.bib, rb.bib), s.name, r.read_at_ms, r.voided
         FROM reads r JOIN stations s ON s.id=r.station_id
         LEFT JOIN runners rt ON rt.tag=r.tag
         LEFT JOIN runners rb ON rb.bib=r.tag AND rt.id IS NULL
         WHERE r.synced=0 ORDER BY r.id LIMIT ?1",
    )?;
    let rows = st.query_map([limit], |r| {
        Ok(PushRead {
            id: r.get(0)?,
            device_id: r.get(1)?,
            tag: r.get(2)?,
            bib: r.get(3)?,
            station: r.get(4)?,
            read_at_ms: r.get(5)?,
            voided: r.get::<_, i64>(6)? != 0,
        })
    })?;
    rows.collect()
}

/// Marks reads confirmed, but only if their voided state is still what was sent (a void during the upload stays pending).
pub fn mark_synced(conn: &mut Connection, sent: &[(i64, bool)]) -> Res<()> {
    let tx = conn.transaction()?;
    for (id, voided) in sent {
        tx.execute("UPDATE reads SET synced=1 WHERE id=?1 AND voided=?2", params![id, *voided as i64])?;
    }
    tx.commit()
}

pub fn pending_count(conn: &Connection) -> Res<i64> {
    conn.query_row("SELECT COUNT(*) FROM reads r JOIN stations s ON s.id=r.station_id WHERE r.synced=0", [], |r| r.get(0))
}

/// Central roster is authoritative for bib/name/category, but a blank cell there never erases what is set here
/// (e.g. a tag mapped locally before the central app knew it).
pub fn upsert_central_runner(conn: &Connection, bib: &str, name: &str, category: &str, tag: &str) -> Result<(), String> {
    let bib = bib.trim();
    if bib.is_empty() {
        return Err("empty bib".into());
    }
    let tag = normalize_tag(tag);
    let tag: Option<String> = if tag.is_empty() { None } else { Some(tag) };
    conn.execute(
        "INSERT INTO runners(bib,name,category,tag) VALUES(?1,?2,?3,?4)
         ON CONFLICT(bib) DO UPDATE SET
           name=CASE WHEN ?2<>'' THEN ?2 ELSE name END,
           category=CASE WHEN ?3<>'' THEN ?3 ELSE category END,
           tag=COALESCE(?4,tag)",
        params![bib, name.trim(), category.trim(), tag],
    )
    .map(|_| ())
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "tag already assigned to another runner".to_string()
        }
        e => e.to_string(),
    })
}

// ---------------------------------------------------------------- heartbeat

/// Per-station health for the heartbeat: readers (ESP32s) assigned and online, the last read, reads still waiting to upload.
pub fn station_beats(conn: &Connection, now: i64) -> Res<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT s.name, s.kind,
           (SELECT COUNT(*) FROM devices d WHERE d.station_id=s.id),
           (SELECT COUNT(*) FROM devices d WHERE d.station_id=s.id AND d.last_seen_ms > ?1 - 15000),
           (SELECT MAX(r.read_at_ms) FROM reads r WHERE r.station_id=s.id),
           (SELECT COUNT(*) FROM reads r WHERE r.station_id=s.id AND r.synced=0)
         FROM stations s ORDER BY s.sort_order, s.id",
    )?;
    let rows = st.query_map([now], |r| {
        Ok(json!({"name": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?,
                  "readers_total": r.get::<_, i64>(2)?, "readers_online": r.get::<_, i64>(3)?,
                  "last_read_ms": r.get::<_, Option<i64>>(4)?, "pending": r.get::<_, i64>(5)?}))
    })?;
    rows.collect()
}

/// A stable id for this laptop (made once) and the name shown on the central admin (Setup, else the computer name).
pub fn laptop_identity(conn: &Connection) -> (String, String) {
    let mut id = get_setting(conn, "laptop_id", "");
    if id.is_empty() {
        let t = now_ms();
        id = format!("L{:x}{:x}", t, (std::process::id() as i64) ^ (t >> 7));
        let _ = set_setting(conn, "laptop_id", &id);
    }
    let named = get_setting(conn, "laptop_name", "");
    let name = if !named.trim().is_empty() {
        named.trim().to_string()
    } else {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Station laptop".into())
    };
    (id, name)
}
