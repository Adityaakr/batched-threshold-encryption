//! Shared application state: sqlite handle, in-memory committee cache
//! (params + rebuilt recovery keys), and pipelined cross-terms.

use anyhow::{Context, Result};
use bte_crypto::{PrecomputedCrossTerms, PublicParams, RecoveryKey};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use crate::db;

pub struct Config {
    pub reveal_timeout_secs: i64,
    pub dev: bool,
    /// Token bucket per IP: sustained requests/second and burst size.
    pub rate_rps: f64,
    pub rate_burst: f64,
}

impl Config {
    pub fn from_env() -> Config {
        Config {
            reveal_timeout_secs: std::env::var("REVEAL_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
            dev: std::env::var("BTE_DEV").is_ok_and(|v| v == "1"),
            rate_rps: std::env::var("BTE_RATE_RPS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50.0),
            rate_burst: std::env::var("BTE_RATE_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(400.0),
        }
    }
}

pub struct Committee {
    pub params: Arc<PublicParams>,
    pub rk: Arc<RecoveryKey>,
}

pub struct Inner {
    pub db: Mutex<Connection>,
    pub committees: RwLock<HashMap<String, Arc<Committee>>>,
    /// batch_id -> pipelined cross-terms (recomputed after restart if absent).
    pub cross: Mutex<HashMap<i64, Arc<PrecomputedCrossTerms>>>,
    /// Rate limiter buckets: ip -> (tokens, last_refill_ms).
    pub buckets: Mutex<HashMap<String, (f64, i64)>>,
    pub cfg: Config,
}

#[derive(Clone)]
pub struct App(pub Arc<Inner>);

impl App {
    pub fn new(conn: Connection, cfg: Config) -> Result<App> {
        let app = App(Arc::new(Inner {
            db: Mutex::new(conn),
            committees: RwLock::new(HashMap::new()),
            cross: Mutex::new(HashMap::new()),
            buckets: Mutex::new(HashMap::new()),
            cfg,
        }));
        app.load_committees()?;
        Ok(app)
    }

    /// Load registered committees from sqlite and rebuild recovery keys.
    fn load_committees(&self) -> Result<()> {
        let blobs: Vec<Vec<u8>> = {
            let conn = self.0.db.lock().unwrap();
            let mut stmt = conn.prepare("SELECT params_blob FROM committees")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for blob in blobs {
            self.cache_committee(&blob)?;
        }
        Ok(())
    }

    pub fn cache_committee(&self, params_blob: &[u8]) -> Result<String> {
        let params =
            PublicParams::from_bytes(params_blob).context("invalid committee params blob")?;
        let id = hex::encode(params.digest());
        let committee = Arc::new(Committee {
            rk: Arc::new(params.recovery_key()),
            params: Arc::new(params),
        });
        self.0
            .committees
            .write()
            .unwrap()
            .insert(id.clone(), committee);
        Ok(id)
    }

    pub fn committee(&self, id: &str) -> Option<Arc<Committee>> {
        self.0.committees.read().unwrap().get(id).cloned()
    }

    /// Register a committee: persist + cache. Returns the id (digest hex).
    pub fn register_committee(&self, params_blob: &[u8]) -> Result<String> {
        let id = self.cache_committee(params_blob)?;
        let committee = self.committee(&id).expect("just cached");
        let p = &committee.params;
        let conn = self.0.db.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO committees (id, params_blob, params_digest, n, t, b, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, params_blob, id, p.n, p.t, p.b, db::unix_now()],
        )?;
        Ok(id)
    }
}

pub fn new_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    use bte_crypto::rand::Rng;
    bte_crypto::os_rng().fill(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}
