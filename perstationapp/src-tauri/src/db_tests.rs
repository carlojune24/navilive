use super::*;

fn mem() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    c.execute_batch(SCHEMA).unwrap();
    c
}

fn batch(boot: &str, seqs: &[(i64, &str)]) -> Batch {
    Batch {
        device_id: "AA:BB".into(),
        boot_id: boot.into(),
        fw: None,
        queue: None,
        ssid: None,
        reads: seqs
            .iter()
            .map(|(s, t)| IngestRead { seq: *s, age_ms: Some(0), tag: t.to_string(), raw: None })
            .collect(),
    }
}

fn first_station(c: &Connection) -> i64 {
    c.query_row("SELECT id FROM stations ORDER BY id LIMIT 1", [], |r| r.get(0)).unwrap()
}

#[test]
fn resend_is_idempotent() {
    let mut c = mem();
    let b = batch("b1", &[(1, "e2801"), (2, "e2802")]);
    assert_eq!(ingest(&mut c, &b, "1.2.3.4", 1000).unwrap().len(), 2);
    // ESP32 did not see the ack and resends the same batch plus one new read
    let b2 = batch("b1", &[(1, "e2801"), (2, "e2802"), (3, "e2803")]);
    assert_eq!(ingest(&mut c, &b2, "1.2.3.4", 2000).unwrap().len(), 1);
    let n: i64 = c.query_row("SELECT COUNT(*) FROM reads", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 3);
}

#[test]
fn reboot_with_same_seq_is_not_dropped() {
    let mut c = mem();
    ingest(&mut c, &batch("boot-a", &[(1, "T1")]), "ip", 1000).unwrap();
    // after a reboot seq restarts at 1 but boot_id differs
    assert_eq!(ingest(&mut c, &batch("boot-b", &[(1, "T1")]), "ip", 5000).unwrap().len(), 1);
}

#[test]
fn age_gives_read_time_and_unknown_age_is_flagged() {
    let mut c = mem();
    let mut b = batch("b", &[(1, "T")]);
    b.reads[0].age_ms = Some(400);
    b.reads.push(IngestRead { seq: 2, age_ms: Some(-1), tag: "T2".into(), raw: None });
    ingest(&mut c, &b, "ip", 10_000).unwrap();
    let rows = query_reads(&c, &ReadFilter::default()).unwrap();
    let by_tag = |t: &str| rows.iter().find(|r| r["tag"] == t).unwrap().clone();
    assert_eq!(by_tag("T")["read_at_ms"], 9_600);
    assert_eq!(by_tag("T")["time_exact"], true);
    assert_eq!(by_tag("T2")["read_at_ms"], 10_000);
    assert_eq!(by_tag("T2")["time_exact"], false);
}

#[test]
fn repeat_reads_collapse_to_one_passing_and_void_promotes_next() {
    let mut c = mem();
    save_station(&c, None, "Finish", "finish", 1).unwrap();
    let sid = first_station(&c);
    let mut b = batch("b", &[(1, "T"), (2, "T"), (3, "T")]);
    b.reads[0].age_ms = Some(9_000);
    b.reads[1].age_ms = Some(8_000);
    b.reads[2].age_ms = Some(7_000);
    ingest(&mut c, &b, "ip", 20_000).unwrap();
    // reads arrived while the device had no station; assigning back-fills them
    assert!(query_reads(&c, &ReadFilter::default()).unwrap().iter().all(|r| r["station_id"].is_null()));
    assign_device(&mut c, "AA:BB", "gate", Some(sid)).unwrap();
    let all = query_reads(&c, &ReadFilter::default()).unwrap();
    assert!(all.iter().all(|r| r["station_id"] == sid));
    let p = query_reads(&c, &ReadFilter { passings_only: true, ..Default::default() }).unwrap();
    assert_eq!(p.len(), 1);
    assert_eq!(p[0]["read_at_ms"], 11_000);
    // voiding the first read: the next read (inside the window) becomes the passing
    void_read(&c, p[0]["id"].as_i64().unwrap(), true, "bad").unwrap();
    let p = query_reads(&c, &ReadFilter { passings_only: true, ..Default::default() }).unwrap();
    assert_eq!(p.len(), 1);
    assert_eq!(p[0]["read_at_ms"], 12_000);
    // raw rows are never lost
    assert_eq!(query_reads(&c, &ReadFilter::default()).unwrap().len(), 3);
}

#[test]
fn reads_after_debounce_window_count_again() {
    let mut c = mem();
    let mut b = batch("b", &[(1, "T"), (2, "T")]);
    b.reads[0].age_ms = Some(100_000);
    b.reads[1].age_ms = Some(0);
    ingest(&mut c, &b, "ip", 200_000).unwrap();
    let p = query_reads(&c, &ReadFilter { passings_only: true, ..Default::default() }).unwrap();
    assert_eq!(p.len(), 2);
}

#[test]
fn results_pair_start_and_finish_per_runner() {
    let mut c = mem();
    save_station(&c, None, "Start", "start", 1).unwrap();
    save_station(&c, None, "Finish", "finish", 2).unwrap();
    let ids: Vec<i64> = {
        let mut st = c.prepare("SELECT id FROM stations ORDER BY id").unwrap();
        let v: Vec<i64> = st.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
        v
    };
    save_runner(&c, "101", "Maria", "10K", "e28011").unwrap();
    save_runner(&c, "102", "Jo", "10K", "").unwrap();

    assign_device(&mut c, "AA:BB", "start", Some(ids[0])).unwrap_or(());
    ingest(&mut c, &batch("b", &[(1, "e28011"), (2, "102")]), "ip", 1_000_000).unwrap();
    assign_device(&mut c, "AA:BB", "start", Some(ids[0])).unwrap();
    ingest(&mut c, &batch("b", &[(3, "E28011")]), "ip", 1_000_500).unwrap(); // same tag, other case, in debounce
    assign_device(&mut c, "AA:BB", "finish", Some(ids[1])).unwrap_or(());
    let mut fin = batch("b2", &[(1, "E28011")]);
    fin.device_id = "CC:DD".into();
    ingest(&mut c, &fin, "ip", 1_600_000).unwrap();
    assign_device(&mut c, "CC:DD", "finish", Some(ids[1])).unwrap();

    let res = results(&c).unwrap();
    let rows = res["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let maria = rows.iter().find(|r| r["bib"] == "101").unwrap();
    assert_eq!(maria["name"], "Maria");
    assert_eq!(maria["elapsed_ms"], 600_000);
    let jo = rows.iter().find(|r| r["bib"] == "102").unwrap();
    assert!(jo["elapsed_ms"].is_null());
    // furthest station first
    assert_eq!(rows[0]["bib"], "101");
}

#[test]
fn tag_collision_is_reported() {
    let c = mem();
    save_runner(&c, "1", "A", "", "T").unwrap();
    assert!(save_runner(&c, "2", "B", "", "T").unwrap_err().contains("already"));
}

#[test]
fn station_with_reads_cannot_be_deleted() {
    let mut c = mem();
    save_station(&c, None, "S", "start", 1).unwrap();
    let sid = first_station(&c);
    ingest(&mut c, &batch("b", &[(1, "T")]), "ip", 1).unwrap();
    assign_device(&mut c, "AA:BB", "", Some(sid)).unwrap();
    assert!(delete_station(&c, sid).is_err());
}

#[test]
fn merge_export_import_is_idempotent_and_matches_stations_by_name() {
    let mut a = mem();
    save_station(&a, None, "CP1", "checkpoint", 1).unwrap();
    let sid = first_station(&a);
    ingest(&mut a, &batch("b", &[(1, "T1"), (2, "T2")]), "ip", 5000).unwrap();
    assign_device(&mut a, "AA:BB", "", Some(sid)).unwrap();
    let doc = export_reads_json(&a).unwrap();

    let mut b = mem();
    let r1 = import_reads_json(&mut b, &doc).unwrap();
    assert_eq!(r1["added"], 2);
    let r2 = import_reads_json(&mut b, &doc).unwrap();
    assert_eq!(r2["added"], 0);
    assert_eq!(r2["duplicates"], 2);
    let st = list_stations(&b).unwrap();
    assert_eq!(st.len(), 1);
    assert_eq!(st[0]["name"], "CP1");
    assert!(import_reads_json(&mut b, &json!({"format": "nope"})).is_err());
}

#[test]
fn csv_cells_resist_formula_injection() {
    assert_eq!(csv_cell("=1+1"), "'=1+1");
    assert_eq!(csv_cell("a,b"), "\"a,b\"");
}

fn runner(c: &Connection, bib: &str) -> (String, String, Option<String>) {
    c.query_row("SELECT name,category,tag FROM runners WHERE bib=?1", [bib], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
}

#[test]
fn runner_import_matches_header_columns_in_any_order() {
    let mut c = mem();
    let csv = "\u{feff}Name,Bib,Category,RFID\n\"Santos, Maria\",101,10K,0000000001\nJuan Cruz,102,5K,\n";
    let (ok, errs) = import_runners(&mut c, csv).unwrap();
    assert_eq!((ok, errs.len()), (2, 0));
    assert_eq!(runner(&c, "101"), ("Santos, Maria".into(), "10K".into(), Some("0000000001".into())));
    assert_eq!(runner(&c, "102"), ("Juan Cruz".into(), "5K".into(), None));
}

#[test]
fn runner_import_without_header_uses_default_order_and_semicolons() {
    let mut c = mem();
    let (ok, errs) = import_runners(&mut c, "7;Ana Reyes;abc;21K\n\n8;Ben Lim;;5K\n").unwrap();
    assert_eq!((ok, errs.len()), (2, 0));
    assert_eq!(runner(&c, "7"), ("Ana Reyes".into(), "21K".into(), Some("ABC".into())));
    assert_eq!(runner(&c, "8").2, None);
}

#[test]
fn runner_import_updates_existing_and_reports_bad_lines() {
    let mut c = mem();
    import_runners(&mut c, "bib,name,tag,category\n1,Old,T1,5K\n").unwrap();
    // bib 1 is updated, bib 2 reuses tag T1 (rejected), bib missing (rejected), bib 3 ok
    let (ok, errs) = import_runners(&mut c, "bib,name,tag,category\n1,New,T1,10K\n2,Dup,T1,5K\n,NoBib,T9,5K\n3,Fine,T3,5K\n").unwrap();
    assert_eq!(ok, 2);
    assert_eq!(errs.len(), 2);
    assert!(errs[0].starts_with("line 3"), "{}", errs[0]);
    assert!(errs[1].starts_with("line 4"), "{}", errs[1]);
    assert_eq!(runner(&c, "1").0, "New");
}

#[test]
fn clear_event_keeps_setup_unless_asked_to_wipe_it() {
    let mut c = mem();
    save_station(&c, None, "Start", "start", 1).unwrap();
    let sid = first_station(&c);
    save_runner(&c, "1", "A", "", "T1").unwrap();
    ingest(&mut c, &batch("b", &[(1, "T1"), (2, "T2")]), "ip", 1000).unwrap();
    assign_device(&mut c, "AA:BB", "gate", Some(sid)).unwrap();

    assert_eq!(clear_event(&mut c, false).unwrap(), 2);
    assert!(query_reads(&c, &ReadFilter::default()).unwrap().is_empty());
    assert_eq!(list_stations(&c).unwrap().len(), 1);
    assert_eq!(list_runners(&c).unwrap().len(), 1);

    ingest(&mut c, &batch("b", &[(1, "T1")]), "ip", 2000).unwrap();
    assert_eq!(clear_event(&mut c, true).unwrap(), 1);
    assert!(list_stations(&c).unwrap().is_empty());
    assert!(list_runners(&c).unwrap().is_empty());
    assert_eq!(list_devices(&c).unwrap().len(), 1);
}

#[test]
fn iso_utc_formats_known_instants() {
    assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso_utc(1_709_164_800_123), "2024-02-29T00:00:00.123Z");
    assert_eq!(iso_utc(1_791_100_000_000), "2026-10-04T07:46:40.000Z");
}

#[test]
fn results_json_lists_each_runners_passings_with_utc_times() {
    let mut c = mem();
    save_station(&c, None, "Start", "start", 1).unwrap();
    save_station(&c, None, "Finish", "finish", 2).unwrap();
    save_runner(&c, "101", "Maria", "10K", "T1").unwrap();
    let ids: Vec<i64> = {
        let mut st = c.prepare("SELECT id FROM stations ORDER BY id").unwrap();
        let v: Vec<i64> = st.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
        v
    };
    ingest(&mut c, &batch("b", &[(1, "T1")]), "ip", 1_000_000).unwrap();
    assign_device(&mut c, "AA:BB", "gate", Some(ids[0])).unwrap();
    let doc = results_json(&c).unwrap();
    assert_eq!(doc["format"], "race-tracker-results-v1");
    assert_eq!(doc["stations"].as_array().unwrap().len(), 2);
    let r = &doc["results"][0];
    assert_eq!(r["bib"], "101");
    assert_eq!(r["rank"], 1);
    assert_eq!(r["passings"][0]["station"], "Start");
    assert_eq!(r["passings"][0]["time_utc"], "1970-01-01T00:16:40.000Z");
    assert!(r["elapsed_ms"].is_null());
    assert_eq!(passings_json(&c, "").unwrap()["passings"].as_array().unwrap().len(), 1);
    let all = all_reads_json(&c, "").unwrap();
    assert_eq!(all["format"], "race-tracker-allreads-v1");
    assert_eq!(all["reads"].as_array().unwrap().len(), 1);
}

#[test]
fn reads_export_can_be_limited_to_one_station() {
    let mut c = mem();
    save_station(&c, None, "Start", "start", 1).unwrap();
    save_station(&c, None, "Check, 1", "checkpoint", 2).unwrap();
    save_runner(&c, "7", "Z", "", "abc").unwrap();
    let id = |n: &str| c.query_row("SELECT id FROM stations WHERE name=?1", [n], |r| r.get::<_, i64>(0)).unwrap();
    let (a, b) = (id("Start"), id("Check, 1"));
    manual_read(&mut c, "7", a, 1000).unwrap();
    manual_read(&mut c, "7", b, 2000).unwrap();
    assert_eq!(all_reads_json(&c, "").unwrap()["reads"].as_array().unwrap().len(), 2);
    let one = all_reads_json(&c, "Check, 1").unwrap();
    assert_eq!(one["reads"].as_array().unwrap().len(), 1);
    assert_eq!(one["reads"][0]["station"], "Check, 1");
    assert_eq!(reads_csv(&c, false, "Start").unwrap().lines().count(), 2); // header + 1 row
    assert_eq!(reads_csv(&c, false, "").unwrap().lines().count(), 3);
    assert_eq!(reads_csv(&c, false, "Nowhere").unwrap().lines().count(), 1);
}

#[test]
fn manual_entry_by_bib_uses_runner_tag() {
    let mut c = mem();
    save_station(&c, None, "S", "start", 1).unwrap();
    save_runner(&c, "7", "Z", "", "abc").unwrap();
    let id = manual_read(&mut c, "7", 1, 1234).unwrap();
    let r = query_reads(&c, &ReadFilter { ids: vec![id], ..Default::default() }).unwrap();
    assert_eq!(r[0]["tag"], "ABC");
    assert_eq!(r[0]["bib"], "7");
}

// ---- central sync

fn with_station(c: &mut Connection, name: &str) -> i64 {
    save_station(c, None, name, "finish", 0).unwrap();
    let id: i64 = c.query_row("SELECT id FROM stations WHERE name=?1", [name], |r| r.get(0)).unwrap();
    c.execute(
        "INSERT INTO devices(device_id,station_id) VALUES('AA:BB',?1) ON CONFLICT(device_id) DO UPDATE SET station_id=?1",
        [id],
    )
    .unwrap();
    id
}

#[test]
fn only_unconfirmed_reads_with_a_station_are_uploaded() {
    let mut c = mem();
    // read arrives before the reader is assigned to a station: it must wait, not be sent nameless
    ingest(&mut c, &batch("b", &[(1, "T1")]), "ip", 1000).unwrap();
    assert!(unsynced_reads(&c, 10).unwrap().is_empty());
    with_station(&mut c, "Finish line");
    ingest(&mut c, &batch("b", &[(2, "T2")]), "ip", 2000).unwrap();
    save_runner(&c, "101", "Ann", "10K", "T2").unwrap();
    let r = unsynced_reads(&c, 10).unwrap();
    assert_eq!((r.len(), r[0].station.as_str(), r[0].bib.as_deref()), (1, "Finish line", Some("101")));
    mark_synced(&mut c, &[(r[0].id, false)]).unwrap();
    assert_eq!(pending_count(&c).unwrap(), 0);
}

#[test]
fn manual_entry_by_bib_for_a_runner_without_a_tag_is_uploaded_with_its_bib() {
    let mut c = mem();
    let st = with_station(&mut c, "Checkpoint 1");
    save_runner(&c, "7", "No Tag Runner", "10K", "").unwrap(); // no RFID tag
    save_runner(&c, "8", "Tagged Runner", "10K", "T8").unwrap();
    manual_read(&mut c, "7", st, 1_000).unwrap(); // stored under the bib itself
    manual_read(&mut c, "8", st, 2_000).unwrap(); // stored under the runner's tag
    manual_read(&mut c, "999", st, 3_000).unwrap(); // nobody has this bib
    let r = unsynced_reads(&c, 10).unwrap();
    let bib = |tag: &str| r.iter().find(|x| x.tag == tag).and_then(|x| x.bib.clone());
    assert_eq!(bib("7"), Some("7".to_string()));
    assert_eq!(bib("T8"), Some("8".to_string()));
    assert_eq!(bib("999"), None);
}

#[test]
fn void_after_upload_is_sent_again() {
    let mut c = mem();
    with_station(&mut c, "S");
    let id = ingest(&mut c, &batch("b", &[(1, "T1")]), "ip", 1000).unwrap()[0];
    mark_synced(&mut c, &[(id, false)]).unwrap();
    void_read(&c, id, true, "test").unwrap();
    let r = unsynced_reads(&c, 10).unwrap();
    assert_eq!((r.len(), r[0].voided), (1, true));
}

#[test]
fn void_during_upload_stays_pending() {
    let mut c = mem();
    with_station(&mut c, "S");
    let id = ingest(&mut c, &batch("b", &[(1, "T1")]), "ip", 1000).unwrap()[0];
    void_read(&c, id, true, "").unwrap(); // voided after the batch was read (voided=false) but before the ack
    mark_synced(&mut c, &[(id, false)]).unwrap();
    assert_eq!(pending_count(&c).unwrap(), 1);
}

#[test]
fn central_roster_never_erases_local_data() {
    let c = mem();
    save_runner(&c, "7", "Local Name", "5K", "TAGLOCAL").unwrap();
    upsert_central_runner(&c, "7", "", "", "").unwrap();
    let r: (String, String, String) = c
        .query_row("SELECT name,category,tag FROM runners WHERE bib='7'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!(r, ("Local Name".into(), "5K".into(), "TAGLOCAL".into()));
    upsert_central_runner(&c, "8", "Bo", "10K", "tag8").unwrap();
    // the central app moved the tag to 9: it follows, and 8 keeps its other data
    upsert_central_runner(&c, "9", "Cy", "10K", "TAG8").unwrap();
    let tags: Vec<(String, Option<String>)> =
        c.prepare("SELECT bib,tag FROM runners WHERE bib IN ('8','9') ORDER BY bib").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
    assert_eq!(tags, vec![("8".into(), None), ("9".into(), Some("TAG8".into()))]);
}

/// BUG-5 in centralapp/e2e/BUGS.md.
#[test]
fn central_bib_renumber_moves_the_tag_to_the_new_bib() {
    let mut c = mem();
    let sid = with_station(&mut c, "Finish");
    upsert_central_runner(&c, "101", "Ana", "5K", "T101").unwrap();
    // the director renumbers 101 -> 111 on the central app; the next roster pull says 111 has T101 and 101 is gone
    upsert_central_runner(&c, "111", "Ana", "5K", "T101").unwrap();
    ingest(&mut c, &batch("b", &[(1, "T101")]), "ip", 1_000).unwrap();
    let up = unsynced_reads(&c, 10).unwrap();
    assert_eq!(up[0].station, c.query_row("SELECT name FROM stations WHERE id=?1", [sid], |r| r.get::<_, String>(0)).unwrap());
    // central trusts the bib it is sent and does not fall back to the tag, so bib 101 here means the read matches nobody
    assert_eq!(up[0].bib.as_deref(), Some("111"));
}

// ---- heartbeat

#[test]
fn heartbeat_reports_readers_online_and_reads_waiting() {
    let mut c = mem();
    let sid = with_station(&mut c, "Finish line");
    let now = 1_000_000_000;
    // the reader from with_station is online, a second one assigned to the same station went quiet a minute ago
    c.execute("UPDATE devices SET last_seen_ms=?1 WHERE device_id='AA:BB'", [now - 2_000]).unwrap();
    c.execute("INSERT INTO devices(device_id,station_id,last_seen_ms) VALUES('CC:DD',?1,?2)", rusqlite::params![sid, now - 60_000]).unwrap();
    ingest(&mut c, &batch("b", &[(1, "T1"), (2, "T2")]), "ip", now - 5_000).unwrap();
    let beats = station_beats(&c, now).unwrap();
    assert_eq!(beats.len(), 1);
    let b = &beats[0];
    assert_eq!((b["name"].as_str(), b["kind"].as_str()), (Some("Finish line"), Some("finish")));
    assert_eq!((b["readers_total"].as_i64(), b["readers_online"].as_i64()), (Some(2), Some(1)));
    assert_eq!(b["pending"].as_i64(), Some(2));
    assert!(b["last_read_ms"].as_i64().is_some());
    // once the central app confirms them, nothing is waiting any more
    let ids: Vec<(i64, bool)> = unsynced_reads(&c, 10).unwrap().iter().map(|r| (r.id, r.voided)).collect();
    mark_synced(&mut c, &ids).unwrap();
    assert_eq!(station_beats(&c, now).unwrap()[0]["pending"].as_i64(), Some(0));
}

#[test]
fn a_station_with_no_reader_and_no_reads_still_reports() {
    let mut c = mem();
    save_station(&mut c, None, "Halfway", "checkpoint", 1).unwrap();
    let b = &station_beats(&c, 1_000_000).unwrap()[0];
    assert_eq!((b["readers_total"].as_i64(), b["readers_online"].as_i64(), b["pending"].as_i64()), (Some(0), Some(0), Some(0)));
    assert!(b["last_read_ms"].is_null());
}

#[test]
fn laptop_identity_is_stable_and_the_name_can_be_set() {
    let c = mem();
    let (id1, _) = laptop_identity(&c);
    let (id2, _) = laptop_identity(&c);
    assert_eq!(id1, id2);
    assert!(!id1.is_empty());
    set_setting(&c, "laptop_name", "  Finish laptop ").unwrap();
    assert_eq!(laptop_identity(&c).1, "Finish laptop");
}

#[test]
fn test_reads_are_isolated_unsynced_and_deleted_on_going_live() {
    let mut c = mem();
    ingest(&mut c, &batch("b", &[(1, "LIVE1")]), "ip", 1000).unwrap();
    set_mode(&mut c, true).unwrap();
    ingest(&mut c, &batch("b", &[(2, "TEST1")]), "ip", 2000).unwrap();
    // test mode shows only test reads
    let rows = query_reads(&c, &ReadFilter::default()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["tag"], "TEST1");
    // and the test read is never queued for upload
    assert!(unsynced_reads(&c, 100).unwrap().is_empty());
    assert_eq!(set_mode(&mut c, false).unwrap(), 1);
    let rows = query_reads(&c, &ReadFilter::default()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["tag"], "LIVE1");
}

/// BUG-3 in centralapp/e2e/BUGS.md: the upload carries each read's own identity, and manual reads are unique per laptop.
#[test]
fn uploads_carry_the_read_identity_and_manual_reads_name_the_laptop() {
    let mut c = mem();
    let sid = with_station(&mut c, "Finish");
    ingest(&mut c, &batch("boot9", &[(4, "T1")]), "ip", 1_000).unwrap();
    manual_read(&mut c, "T1", sid, 1_000).unwrap();
    let (laptop, _) = laptop_identity(&c);
    let src: Vec<String> = unsynced_reads(&c, 10).unwrap().into_iter().map(|r| r.src).collect();
    assert_eq!(src, vec!["boot9:4".to_string(), format!("manual-{laptop}:1")]);
}
