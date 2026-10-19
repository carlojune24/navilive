use crate::{db, lock, PORT};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
}

async fn ingest(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(batch): Json<db::Batch>,
) -> (StatusCode, Json<Value>) {
    let db = ctx.db.clone();
    let ip = addr.ip().to_string();
    let ip_for_log = ip.clone();
    let res = tokio::task::spawn_blocking(move || {
        let mut c = lock(&db);
        let ids = db::ingest(&mut c, &batch, &ip, db::now_ms())?;
        let rows = if ids.is_empty() {
            vec![]
        } else {
            db::query_reads(&c, &db::ReadFilter { ids, ..Default::default() })?
        };
        Ok::<_, rusqlite::Error>((rows, batch.reads.iter().map(|r| r.seq).max().unwrap_or(0)))
    })
    .await;
    match res {
        Ok(Ok((rows, acked))) => {
            eprintln!("[ingest] {} {} new read(s), acked through seq {}", ip_for_log, rows.len(), acked);
            if !rows.is_empty() {
                let _ = ctx.app.emit("new-reads", &rows);
            }
            let _ = ctx.app.emit("device-ping", ());
            // 200 is only returned after the SQLite transaction committed
            (StatusCode::OK, Json(json!({"ok": true, "acked": acked, "now": db::now_ms()})))
        }
        // anything else makes the ESP32 keep the reads and retry
        _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false}))),
    }
}

/// Binds the port synchronously so the UI can report a failure immediately. Returns whether mDNS is up.
pub fn start(app: AppHandle, db: Arc<Mutex<Connection>>, status: Arc<Mutex<String>>) -> bool {
    let listener = std::net::TcpListener::bind(("0.0.0.0", PORT)).and_then(|l| l.set_nonblocking(true).map(|_| l));
    match listener {
        Err(e) => {
            *status.lock().unwrap() =
                format!("error: cannot listen on port {PORT} ({e}). Another copy of the app may be running.");
            return false;
        }
        Ok(l) => {
            *status.lock().unwrap() = "listening".into();
            let router = Router::new()
                .route("/ingest", post(ingest))
                .route("/ping", get(|| async { "race-tracker" }))
                .layer(DefaultBodyLimit::max(512 * 1024))
                .with_state(Ctx { app, db });
            tauri::async_runtime::spawn(async move {
                let l = tokio::net::TcpListener::from_std(l).expect("listener");
                let _ = axum::serve(l, router.into_make_service_with_connect_info::<SocketAddr>()).await;
            });
        }
    }
    start_discovery_responder();
    start_mdns()
}

fn start_mdns() -> bool {
    use mdns_sd::{ServiceDaemon, ServiceInfo};
    let Ok(daemon) = ServiceDaemon::new() else { return false };
    let Ok(info) = ServiceInfo::new(
        "_racetracker._tcp.local.",
        "racetracker",
        "racetracker.local.",
        "",
        PORT,
        None::<std::collections::HashMap<String, String>>,
    ) else {
        return false;
    };
    let ok = daemon.register(info.enable_addr_auto()).is_ok();
    std::mem::forget(daemon); // keep advertising for the life of the process
    ok
}

/// UDP discovery: an ESP32 broadcasts "RACETRACKER?" to port 4391 and we answer "RACETRACKER <port>".
/// The ESP32 takes our address from the reply packet, so no mDNS or typed IP is needed.
fn start_discovery_responder() {
    std::thread::spawn(|| {
        let Ok(sock) = std::net::UdpSocket::bind(("0.0.0.0", crate::DISCOVERY_PORT)) else { return };
        let mut buf = [0u8; 64];
        loop {
            if let Ok((n, from)) = sock.recv_from(&mut buf) {
                if buf[..n].starts_with(b"RACETRACKER?") {
                    eprintln!("[discovery] request from {from}, replying");
                    let _ = sock.send_to(format!("RACETRACKER {PORT}").as_bytes(), from);
                }
            }
        }
    });
}
