//! In-process integration tests: full seal -> freeze -> shares -> reveal flow
//! plus invariants 4 (no plaintext pre-reveal), 5 (padding), 6 (deterministic
//! positions).

use base64::Engine;
use bte_coordinator::{api, db, engine, state};
use bte_crypto::rand::SeedableRng;
use bte_crypto::wire::header_from_bytes;
use bte_crypto::{ceremony, partial, seal, CtHeader, OperatorSecret, PublicParams};
use rand_chacha::ChaCha20Rng;
use serde_json::{json, Value};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

struct Harness {
    app: state::App,
    base: String,
    client: reqwest::Client,
    params: PublicParams,
    secrets: Vec<OperatorSecret>,
    committee_id: String,
}

async fn harness() -> Harness {
    harness_seeded(7).await
}

/// Coordinator with an in-memory db and a registered n=3 t=2 B=4 committee.
/// The engine loop is NOT spawned; tests call engine::tick explicitly.
async fn harness_seeded(seed: u64) -> Harness {
    let mut rng = ChaCha20Rng::seed_from_u64(seed);
    let (params, secrets) = ceremony(3, 2, 4, &mut rng).unwrap();

    let conn = db::open(":memory:").unwrap();
    let app = state::App::new(conn, state::Config::from_env()).unwrap();
    let committee_id = app.register_committee(&params.to_bytes()).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = api::router(app.clone());
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    Harness {
        app,
        base,
        client: reqwest::Client::new(),
        params,
        secrets,
        committee_id,
    }
}

impl Harness {
    async fn post(&self, path: &str, body: Value) -> (u16, Value) {
        let resp = self
            .client
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = resp.status().as_u16();
        (status, resp.json().await.unwrap_or(Value::Null))
    }

    async fn get(&self, path: &str) -> (u16, Value) {
        let resp = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap();
        let status = resp.status().as_u16();
        (status, resp.json().await.unwrap_or(Value::Null))
    }

    /// Create a condition that is already due, seal payloads to it, and
    /// return (condition_id, sealed hashes).
    async fn seal_condition(&self, payloads: &[&[u8]]) -> (String, Vec<String>) {
        let (status, cond) = self
            .post(
                "/v0/conditions",
                json!({"committee_id": self.committee_id, "in_secs": 0}),
            )
            .await;
        assert_eq!(status, 200, "{cond}");
        let condition_id = cond["id"].as_str().unwrap().to_string();

        let mut rng = bte_crypto::os_rng();
        let mut hashes = Vec::new();
        for payload in payloads {
            let ct = seal(&self.params, payload, &mut rng).unwrap();
            let (status, resp) = self
                .post(
                    "/v0/ciphertexts",
                    json!({
                        "condition_id": condition_id,
                        "sealed_blob_b64": B64.encode(ct.to_bytes()),
                    }),
                )
                .await;
            assert_eq!(status, 200, "{resp}");
            hashes.push(resp["ct_hash"].as_str().unwrap().to_string());
        }
        (condition_id, hashes)
    }

    /// Fetch work for an operator and post its (honest) share everywhere.
    async fn work_and_share(&self, operator: &OperatorSecret) -> usize {
        let (status, work) = self
            .get(&format!("/v0/work?operator={}", operator.party_index))
            .await;
        assert_eq!(status, 200);
        let batches = work["batches"].as_array().unwrap();
        for batch in batches {
            let headers_raw = B64.decode(batch["headers_b64"].as_str().unwrap()).unwrap();
            let headers: Vec<CtHeader> = headers_raw
                .chunks(48)
                .map(|c| header_from_bytes(c).unwrap())
                .collect();
            let share = partial(operator, &headers).unwrap();
            let (status, resp) = self
                .post(
                    "/v0/shares",
                    json!({
                        "batch_id": batch["batch_id"],
                        "operator_id": operator.party_index,
                        "share_b64": B64.encode(share.to_bytes()),
                    }),
                )
                .await;
            assert_eq!(status, 200, "{resp}");
            assert_eq!(resp["verified"], json!(true), "{resp}");
        }
        batches.len()
    }
}

#[tokio::test]
async fn full_flow_seal_freeze_shares_reveal() {
    let h = harness().await;
    let (condition_id, _) = h
        .seal_condition(&[b"bid: alice 100", b"bid: bob 250"])
        .await;

    // Invariant 4: nothing readable before reveal.
    let (status, _) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 404);

    // Tick fires + freezes + runs pre_decrypt (pipelined, before any share).
    engine::tick(&h.app).await.unwrap();
    let (_, cond) = h.get(&format!("/v0/conditions/{condition_id}")).await;
    assert_eq!(cond["status"], "frozen", "{cond}");
    let batch = &cond["batches"][0];
    assert!(
        batch["predecrypt_ms"].is_i64(),
        "pre_decrypt must complete at freeze time, before any share exists: {cond}"
    );

    // Sealing is closed after freeze.
    let mut rng = bte_crypto::os_rng();
    let late = seal(&h.params, b"too late", &mut rng).unwrap();
    let (status, resp) = h
        .post(
            "/v0/ciphertexts",
            json!({"condition_id": condition_id, "sealed_blob_b64": B64.encode(late.to_bytes())}),
        )
        .await;
    assert_eq!(status, 400, "{resp}");

    // t = 2 operators do their one-share-per-batch duty.
    assert_eq!(h.work_and_share(&h.secrets[0]).await, 1);
    assert_eq!(h.work_and_share(&h.secrets[2]).await, 1);

    engine::tick(&h.app).await.unwrap();
    let (status, reveal) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 200, "{reveal}");

    let slots = reveal["slots"].as_array().unwrap();
    assert_eq!(slots.len(), 4, "padded to B");
    let real: Vec<&Value> = slots
        .iter()
        .filter(|s| s["is_dummy"] == json!(false))
        .collect();
    assert_eq!(real.len(), 2);
    let payloads: Vec<Vec<u8>> = real
        .iter()
        .map(|s| B64.decode(s["payload_b64"].as_str().unwrap()).unwrap())
        .collect();
    assert!(payloads.contains(&b"bid: alice 100".to_vec()));
    assert!(payloads.contains(&b"bid: bob 250".to_vec()));
    for slot in slots {
        assert_eq!(slot["valid"], json!(true));
    }
    assert_eq!(reveal["shares"].as_array().unwrap().len(), 2);
    assert!(reveal["merkle_root"].as_str().unwrap().len() == 64);
    let (_, cond) = h.get(&format!("/v0/conditions/{condition_id}")).await;
    assert_eq!(cond["status"], "revealed");
}

#[tokio::test]
async fn invariant_4_no_plaintext_before_reveal() {
    let h = harness().await;
    let secret = b"the secret nobody can read early";
    let (condition_id, _) = h.seal_condition(&[secret]).await;
    engine::tick(&h.app).await.unwrap();

    // Reveal endpoint 404s while pending shares.
    let (status, _) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 404);

    // The plaintext must not exist anywhere in the database.
    {
        let conn = h.app.0.db.lock().unwrap();
        let reveal_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM reveals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(reveal_count, 0);
        let mut stmt = conn.prepare("SELECT sealed_blob FROM ciphertexts").unwrap();
        let blobs: Vec<Vec<u8>> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for blob in blobs {
            assert!(
                !blob.windows(secret.len()).any(|w| w == secret.as_slice()),
                "plaintext bytes leaked into a stored blob"
            );
        }
    }
}

#[tokio::test]
async fn invariant_5_padding_with_dummies_marked() {
    let h = harness().await;
    let (condition_id, _) = h.seal_condition(&[b"only real payload"]).await;
    engine::tick(&h.app).await.unwrap();
    h.work_and_share(&h.secrets[0]).await;
    h.work_and_share(&h.secrets[1]).await;
    engine::tick(&h.app).await.unwrap();

    let (status, reveal) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 200);
    let slots = reveal["slots"].as_array().unwrap();
    assert_eq!(slots.len(), 4, "1 real ct pads to B=4");
    let real: Vec<&Value> = slots
        .iter()
        .filter(|s| s["is_dummy"] == json!(false))
        .collect();
    assert_eq!(real.len(), 1, "exactly one real payload revealed");
    assert_eq!(
        B64.decode(real[0]["payload_b64"].as_str().unwrap())
            .unwrap(),
        b"only real payload"
    );
    let dummies: Vec<&Value> = slots
        .iter()
        .filter(|s| s["is_dummy"] == json!(true))
        .collect();
    assert_eq!(dummies.len(), 3, "dummies marked");
    for d in dummies {
        let payload = B64.decode(d["payload_b64"].as_str().unwrap()).unwrap();
        assert!(bte_crypto::is_dummy_payload(&payload));
    }
}

#[tokio::test]
async fn invariant_6_positions_pure_function_of_ct_hashes() {
    // Two coordinators, same sealed ciphertexts -> identical positions for
    // the real ciphertexts, independent of dummy randomness.
    let mut rng = ChaCha20Rng::seed_from_u64(99);
    let (params, _) = ceremony(3, 2, 4, &mut rng).unwrap();
    let cts: Vec<Vec<u8>> = (0..2)
        .map(|i| {
            seal(&params, format!("payload {i}").as_bytes(), &mut rng)
                .unwrap()
                .to_bytes()
        })
        .collect();

    let mut runs: Vec<Vec<(String, i64)>> = Vec::new();
    for _ in 0..2 {
        let conn = db::open(":memory:").unwrap();
        let app = state::App::new(conn, state::Config::from_env()).unwrap();
        let committee_id = app.register_committee(&params.to_bytes()).unwrap();
        {
            let c = app.0.db.lock().unwrap();
            c.execute(
                "INSERT INTO conditions (id, committee_id, kind, fires_at, status, created_at)
                 VALUES ('cond_x', ?1, 'at_time', 0, 'pending', 0)",
                [&committee_id],
            )
            .unwrap();
            for blob in &cts {
                let ct = bte_crypto::SealedCiphertext::from_bytes(blob).unwrap();
                c.execute(
                    "INSERT INTO ciphertexts (ct_hash, condition_id, sealed_blob, is_dummy, created_at)
                     VALUES (?1, 'cond_x', ?2, 0, 0)",
                    rusqlite::params![hex::encode(ct.hash()), blob],
                )
                .unwrap();
            }
        }
        engine::tick(&app).await.unwrap();
        let positions: Vec<(String, i64)> = {
            let c = app.0.db.lock().unwrap();
            let mut stmt = c
                .prepare(
                    "SELECT ct_hash, position FROM ciphertexts
                     WHERE is_dummy = 0 ORDER BY ct_hash",
                )
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        runs.push(positions);
    }
    assert_eq!(
        runs[0], runs[1],
        "positions must be a pure function of the ct_hash set"
    );
}

#[tokio::test]
async fn rejected_share_flagged_never_used_and_stall_recovery() {
    let h = harness().await;
    let (condition_id, _) = h.seal_condition(&[b"resilient payload"]).await;
    engine::tick(&h.app).await.unwrap();

    // Operator 2 goes byzantine: submits operator 3's share under its own id
    // — wire-valid, cryptographically wrong.
    let (_, work) = h.get("/v0/work?operator=2").await;
    let batch = &work["batches"][0];
    let headers_raw = B64.decode(batch["headers_b64"].as_str().unwrap()).unwrap();
    let headers: Vec<CtHeader> = headers_raw
        .chunks(48)
        .map(|c| header_from_bytes(c).unwrap())
        .collect();
    let mut forged = partial(&h.secrets[2], &headers).unwrap();
    forged.party_index = 2;
    let (status, resp) = h
        .post(
            "/v0/shares",
            json!({
                "batch_id": batch["batch_id"],
                "operator_id": 2,
                "share_b64": B64.encode(forged.to_bytes()),
            }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(
        resp["verified"],
        json!(false),
        "forged share must be rejected: {resp}"
    );

    // One honest share is not enough (t=2): the condition must not reveal.
    h.work_and_share(&h.secrets[0]).await;
    engine::tick(&h.app).await.unwrap();
    let (status, _) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 404, "rejected share must never count toward t");

    // Force the stall path (timeout 0 via direct db poke on frozen_at).
    {
        let conn = h.app.0.db.lock().unwrap();
        conn.execute("UPDATE batches SET frozen_at = frozen_at - 100000", [])
            .unwrap();
    }
    engine::tick(&h.app).await.unwrap();
    let (_, cond) = h.get(&format!("/v0/conditions/{condition_id}")).await;
    assert_eq!(
        cond["status"], "stalled",
        "stall must be exposed, never a silent hang"
    );

    // A late honest share (operator 3 — operator 2 burned its slot on the
    // forged share) still recovers the batch.
    h.work_and_share(&h.secrets[2]).await;
    engine::tick(&h.app).await.unwrap();
    let (status, reveal) = h.get(&format!("/v0/reveals/{condition_id}")).await;
    assert_eq!(status, 200);
    // The rejected share appears in the log, flagged.
    let shares = reveal["shares"].as_array().unwrap();
    let rejected: Vec<&Value> = shares
        .iter()
        .filter(|s| s["verified"] == json!(false))
        .collect();
    assert_eq!(rejected.len(), 1);
    assert_eq!(rejected[0]["operator_id"], json!(2));
}
