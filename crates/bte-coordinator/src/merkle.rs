//! Merkle root over (position, payload) leaves.
//!
//! leaf = sha256(position_le_u32 || payload), parent = sha256(left || right),
//! odd node promoted. Committed onchain in phase 7; recomputed by the SDK's
//! verifyAnchor.

use sha2::{Digest, Sha256};

pub fn leaf(position: u32, payload: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(position.to_le_bytes());
    h.update(payload);
    h.finalize().into()
}

/// Root over leaves in position order. Empty input hashes to sha256("").
pub fn root(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return Sha256::digest([]).into();
    }
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    while level.len() > 1 {
        level = level
            .chunks(2)
            .map(|pair| {
                if pair.len() == 2 {
                    let mut h = Sha256::new();
                    h.update(pair[0]);
                    h.update(pair[1]);
                    h.finalize().into()
                } else {
                    pair[0] // odd node promoted
                }
            })
            .collect();
    }
    level[0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_order_sensitive() {
        let a = leaf(0, b"alpha");
        let b = leaf(1, b"beta");
        let c = leaf(2, b"gamma");
        assert_eq!(root(&[a, b, c]), root(&[a, b, c]));
        assert_ne!(root(&[a, b, c]), root(&[b, a, c]));
        assert_ne!(root(&[a, b]), root(&[a, b, c]));
        // Single leaf promotes to root.
        assert_eq!(root(&[a]), a);
    }
}
