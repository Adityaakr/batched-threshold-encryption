//! Phase 1 required tests: roundtrip, t-1 failure, corrupted share, mauled
//! ciphertext, golden wire files, and the 48-byte size invariants.

use bte_crypto::rand::SeedableRng;
use bte_crypto::wire::{header_to_bytes, G1_BYTES};
use bte_crypto::{
    ceremony, combine, dummy_payload, is_dummy_payload, partial, pre_decrypt, recover, seal,
    sort_by_ct_hash, verify_share, BteError, CtHeader, OperatorSecret, PublicParams,
    SealedCiphertext, Share, MAX_PAYLOAD_BYTES,
};
use rand_chacha::ChaCha20Rng;
use std::collections::HashMap;

fn rng() -> ChaCha20Rng {
    ChaCha20Rng::seed_from_u64(42)
}

/// Small deterministic fixture: n=3, t=2, B=4; 3 real payloads + 1 dummy,
/// sorted into freeze order.
#[allow(clippy::type_complexity)]
fn fixture() -> (
    PublicParams,
    Vec<OperatorSecret>,
    Vec<SealedCiphertext>,
    HashMap<[u8; 32], Vec<u8>>,
) {
    let mut rng = rng();
    let (params, secrets) = ceremony(3, 2, 4, &mut rng).unwrap();

    let payloads: Vec<Vec<u8>> = vec![
        b"first sealed bid: 100".to_vec(),
        b"second sealed bid: 250".to_vec(),
        b"third sealed bid: 175".to_vec(),
        dummy_payload(&mut rng),
    ];
    let mut batch: Vec<SealedCiphertext> = payloads
        .iter()
        .map(|p| seal(&params, p, &mut rng).unwrap())
        .collect();
    let by_hash: HashMap<[u8; 32], Vec<u8>> = batch
        .iter()
        .zip(&payloads)
        .map(|(ct, p)| (ct.hash(), p.clone()))
        .collect();
    sort_by_ct_hash(&mut batch);
    (params, secrets, batch, by_hash)
}

fn headers(batch: &[SealedCiphertext]) -> Vec<CtHeader> {
    batch.iter().map(|ct| ct.header()).collect()
}

#[test]
fn roundtrip_small_case() {
    let (params, secrets, batch, by_hash) = fixture();
    let hdrs = headers(&batch);

    // Two partials (t = 2), both publicly verifiable.
    let s1 = partial(&secrets[0], &hdrs).unwrap();
    let s3 = partial(&secrets[2], &hdrs).unwrap();
    assert!(verify_share(&params, &hdrs, &s1));
    assert!(verify_share(&params, &hdrs, &s3));

    let recovered = recover(&params, &batch, &[s1, s3]).unwrap();
    assert_eq!(recovered.len(), 4);

    let mut dummies = 0;
    for (slot, ct) in recovered.iter().zip(&batch) {
        assert!(slot.valid, "honest ciphertext must recover as valid");
        assert_eq!(&slot.payload, &by_hash[&ct.hash()], "payload mismatch");
        if is_dummy_payload(&slot.payload) {
            dummies += 1;
        }
    }
    assert_eq!(dummies, 1);
}

#[test]
fn pipelined_matches_recover_and_needs_no_shares() {
    let (params, secrets, batch, _) = fixture();
    let hdrs = headers(&batch);
    let rk = params.recovery_key();

    // pre_decrypt runs with zero shares in existence (invariant 9).
    let pre = pre_decrypt(&rk, &batch).unwrap();

    let shares: Vec<Share> = secrets[..2]
        .iter()
        .map(|s| partial(s, &hdrs).unwrap())
        .collect();
    let combined = combine(&shares);
    let finalized = bte_crypto::finalize(&rk, &pre, &combined, &batch).unwrap();
    let recovered = recover(&params, &batch, &shares).unwrap();
    assert_eq!(finalized, recovered);
}

#[test]
fn t_minus_1_shares_fails_explicitly() {
    let (params, secrets, batch, _) = fixture();
    let hdrs = headers(&batch);
    let s1 = partial(&secrets[0], &hdrs).unwrap();

    match recover(&params, &batch, &[s1]) {
        Err(BteError::NotEnoughShares { need: 2, have: 1 }) => {}
        other => panic!("expected NotEnoughShares, got {other:?}"),
    }
    // Duplicate shares from the same party must not count twice.
    match recover(&params, &batch, &[s1, s1]) {
        Err(BteError::NotEnoughShares { need: 2, have: 1 }) => {}
        other => panic!("expected NotEnoughShares on duplicates, got {other:?}"),
    }
}

#[test]
fn corrupted_share_rejected_recovery_survives() {
    use ark_ec::{AffineRepr, CurveGroup};
    let (params, secrets, batch, by_hash) = fixture();
    let hdrs = headers(&batch);

    let good1 = partial(&secrets[0], &hdrs).unwrap();
    let good2 = partial(&secrets[1], &hdrs).unwrap();
    let mut bad = partial(&secrets[2], &hdrs).unwrap();
    bad.value = (bad.value + ark_bls12_381::G1Affine::generator()).into_affine();

    assert!(!verify_share(&params, &hdrs, &bad));
    assert!(verify_share(&params, &hdrs, &good1));

    // Recovery filters the bad share and still succeeds from t honest ones.
    let recovered = recover(&params, &batch, &[bad, good1, good2]).unwrap();
    for (slot, ct) in recovered.iter().zip(&batch) {
        assert!(slot.valid);
        assert_eq!(&slot.payload, &by_hash[&ct.hash()]);
    }

    // With the bad share and only t-1 honest ones, error — never garbage.
    match recover(&params, &batch, &[bad, good1]) {
        Err(BteError::NotEnoughShares { need: 2, have: 1 }) => {}
        other => panic!("expected NotEnoughShares, got {other:?}"),
    }
}

#[test]
fn mauled_ciphertext_flagged_without_poisoning_batch() {
    let (params, secrets, mut batch, by_hash) = fixture();

    // Bit-flip one payload byte through the wire encoding.
    let mut bytes = batch[1].to_bytes();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    let mauled_hash;
    {
        let mauled = SealedCiphertext::from_bytes(&bytes).unwrap();
        mauled_hash = mauled.hash();
        batch[1] = mauled;
    }

    // Operators sign whatever the frozen batch is — including the mauled ct.
    let hdrs = headers(&batch);
    let shares: Vec<Share> = secrets[..2]
        .iter()
        .map(|s| partial(s, &hdrs).unwrap())
        .collect();
    for s in &shares {
        assert!(verify_share(&params, &hdrs, s));
    }

    let recovered = recover(&params, &batch, &shares).unwrap();
    for (slot, ct) in recovered.iter().zip(&batch) {
        if ct.hash() == mauled_hash {
            assert!(!slot.valid, "mauled ciphertext must be flagged corrupt");
        } else {
            assert!(slot.valid, "honest slots must survive a mauled neighbor");
            assert_eq!(&slot.payload, &by_hash[&ct.hash()]);
        }
    }
}

#[test]
fn payload_cap_enforced() {
    let (params, _, _, _) = fixture();
    let mut rng = rng();
    assert!(seal(&params, &vec![0u8; MAX_PAYLOAD_BYTES], &mut rng).is_ok());
    match seal(&params, &vec![0u8; MAX_PAYLOAD_BYTES + 1], &mut rng) {
        Err(BteError::PayloadTooLarge) => {}
        other => panic!("expected PayloadTooLarge, got {other:?}"),
    }
}

#[test]
fn wire_sizes_are_48_bytes() {
    let (_params, secrets, batch, _) = fixture();
    let hdrs = headers(&batch);

    // Invariant 10: the KEM header is exactly 48 bytes on the wire.
    assert_eq!(header_to_bytes(&batch[0].header()).len(), G1_BYTES);
    assert_eq!(G1_BYTES, 48);

    // A share is one 48-byte G1 element regardless of B (wire framing adds
    // 4B magic + 1B type + 2B party index).
    let share = partial(&secrets[0], &hdrs).unwrap();
    let share_bytes = share.to_bytes();
    assert_eq!(share_bytes.len(), 4 + 1 + 2 + 48);

    // Sealed ciphertext overhead: 48B header + 16B key mask (+ framing + len).
    let ct = &batch[0];
    assert_eq!(ct.to_bytes().len(), 4 + 1 + 48 + 16 + 4 + ct.ct2.len());
}

#[test]
fn wire_rejects_malformed() {
    let (_, _, batch, _) = fixture();
    let good = batch[0].to_bytes();

    let mut bad_magic = good.clone();
    bad_magic[0] = b'X';
    assert!(SealedCiphertext::from_bytes(&bad_magic).is_err());

    let mut trailing = good.clone();
    trailing.push(0);
    assert!(SealedCiphertext::from_bytes(&trailing).is_err());

    assert!(SealedCiphertext::from_bytes(&good[..20]).is_err());

    // Corrupt the G1 point (not on curve / bad flags) must be rejected.
    let mut bad_point = good.clone();
    bad_point[5] ^= 0xff;
    bad_point[6] ^= 0xff;
    assert!(SealedCiphertext::from_bytes(&bad_point).is_err());
}

// ---------------------------------------------------------------------------
// Golden wire files (invariant 8). Regenerate with BTE_BLESS=1 cargo test.
// ---------------------------------------------------------------------------

fn golden(name: &str, actual: &[u8]) {
    let path = format!("{}/tests/golden/{name}.bin", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("BTE_BLESS").is_ok() {
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read(&path)
        .unwrap_or_else(|_| panic!("missing golden file {path}; run BTE_BLESS=1 cargo test"));
    assert_eq!(
        expected, actual,
        "golden mismatch for {name}: wire format changed — bump BTE_WIRE version"
    );
}

#[test]
fn golden_wire_files() {
    let (params, secrets, batch, _) = fixture();
    let hdrs = headers(&batch);

    let params_bytes = params.to_bytes();
    golden("public_params", &params_bytes);
    let ct_bytes = batch[0].to_bytes();
    golden("sealed_ciphertext", &ct_bytes);
    let share_bytes = partial(&secrets[0], &hdrs).unwrap().to_bytes();
    golden("share", &share_bytes);

    // Deserialize -> reserialize is the identity on golden bytes.
    assert_eq!(
        PublicParams::from_bytes(&params_bytes).unwrap().to_bytes(),
        params_bytes
    );
    assert_eq!(
        SealedCiphertext::from_bytes(&ct_bytes).unwrap().to_bytes(),
        ct_bytes
    );
    assert_eq!(
        Share::from_bytes(&share_bytes).unwrap().to_bytes(),
        share_bytes
    );

    // Digest is stable across a wire roundtrip.
    assert_eq!(
        PublicParams::from_bytes(&params_bytes).unwrap().digest(),
        params.digest()
    );
}
