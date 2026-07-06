//! BTE_WIRE_V0 serialization. See spec/index.md section 5.
//!
//! Every wire type: magic b"BTE0", one type byte, then fixed layout.
//! Group elements are arkworks canonical compressed (G1 48B, G2 96B,
//! G_T 576B, scalar 32B). Integers little-endian. Deserialization is strict:
//! points are subgroup-checked, trailing bytes rejected.

use crate::{BteError, OperatorSecret, PublicParams, SealedCiphertext, Share, BTE_WIRE_V0};
use ark_bls12_381::{Bls12_381, Fr, G1Affine, G2Affine};
use ark_ec::pairing::PairingOutput;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use simple_bte::bte::EncryptionKey;

pub const TYPE_SEALED_CIPHERTEXT: u8 = 0x01;
pub const TYPE_SHARE: u8 = 0x02;
pub const TYPE_PUBLIC_PARAMS: u8 = 0x03;
pub const TYPE_OPERATOR_SECRET: u8 = 0x04;

pub const G1_BYTES: usize = 48;
pub const G2_BYTES: usize = 96;
pub const GT_BYTES: usize = 576;
pub const SCALAR_BYTES: usize = 32;

fn wire_err(what: &str) -> BteError {
    BteError::Wire(what.to_string())
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8], expected_type: u8) -> Result<Self, BteError> {
        let mut r = Reader { buf, pos: 0 };
        let magic = r.take(4)?;
        if magic != BTE_WIRE_V0 {
            return Err(wire_err("bad magic, expected BTE0"));
        }
        let ty = r.u8()?;
        if ty != expected_type {
            return Err(wire_err("unexpected wire type byte"));
        }
        Ok(r)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], BteError> {
        if self.buf.len() - self.pos < n {
            return Err(wire_err("truncated"));
        }
        let out = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, BteError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, BteError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, BteError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn g1(&mut self) -> Result<G1Affine, BteError> {
        G1Affine::deserialize_compressed(self.take(G1_BYTES)?)
            .map_err(|_| wire_err("invalid G1 point"))
    }

    fn g2(&mut self) -> Result<G2Affine, BteError> {
        G2Affine::deserialize_compressed(self.take(G2_BYTES)?)
            .map_err(|_| wire_err("invalid G2 point"))
    }

    fn gt(&mut self) -> Result<PairingOutput<Bls12_381>, BteError> {
        PairingOutput::<Bls12_381>::deserialize_compressed(self.take(GT_BYTES)?)
            .map_err(|_| wire_err("invalid G_T element"))
    }

    fn scalar(&mut self) -> Result<Fr, BteError> {
        Fr::deserialize_compressed(self.take(SCALAR_BYTES)?).map_err(|_| wire_err("invalid scalar"))
    }

    fn finish(self) -> Result<(), BteError> {
        if self.pos != self.buf.len() {
            return Err(wire_err("trailing bytes"));
        }
        Ok(())
    }
}

fn header(out: &mut Vec<u8>, ty: u8) {
    out.extend_from_slice(BTE_WIRE_V0);
    out.push(ty);
}

fn put_point<T: CanonicalSerialize>(out: &mut Vec<u8>, p: &T, expect: usize) {
    let start = out.len();
    p.serialize_compressed(&mut *out)
        .expect("canonical serialization cannot fail on a Vec");
    debug_assert_eq!(out.len() - start, expect, "unexpected compressed size");
}

impl SealedCiphertext {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + G1_BYTES + 16 + 4 + self.ct2.len());
        header(&mut out, TYPE_SEALED_CIPHERTEXT);
        put_point(&mut out, &self.ct0, G1_BYTES);
        out.extend_from_slice(&self.ct1);
        out.extend_from_slice(&(self.ct2.len() as u32).to_le_bytes());
        out.extend_from_slice(&self.ct2);
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BteError> {
        let mut r = Reader::new(bytes, TYPE_SEALED_CIPHERTEXT)?;
        let ct0 = r.g1()?;
        let ct1: [u8; 16] = r.take(16)?.try_into().unwrap();
        let len = r.u32()? as usize;
        if len > crate::MAX_PAYLOAD_BYTES {
            return Err(BteError::PayloadTooLarge);
        }
        let ct2 = r.take(len)?.to_vec();
        r.finish()?;
        Ok(SealedCiphertext { ct0, ct1, ct2 })
    }
}

impl Share {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + 2 + G1_BYTES);
        header(&mut out, TYPE_SHARE);
        out.extend_from_slice(&self.party_index.to_le_bytes());
        put_point(&mut out, &self.value, G1_BYTES);
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BteError> {
        let mut r = Reader::new(bytes, TYPE_SHARE)?;
        let party_index = r.u16()?;
        let value = r.g1()?;
        r.finish()?;
        Ok(Share { party_index, value })
    }
}

impl PublicParams {
    pub fn to_bytes(&self) -> Vec<u8> {
        let b = self.b as usize;
        let n = self.n as usize;
        let cap = 5 + 8 + GT_BYTES + 4 + (2 * b + 1) * G2_BYTES + n * b * G2_BYTES;
        let mut out = Vec::with_capacity(cap);
        header(&mut out, TYPE_PUBLIC_PARAMS);
        out.extend_from_slice(&self.n.to_le_bytes());
        out.extend_from_slice(&self.t.to_le_bytes());
        out.extend_from_slice(&self.b.to_le_bytes());
        put_point(&mut out, &self.ek.e, GT_BYTES);
        out.extend_from_slice(&(self.powers_of_h.len() as u32).to_le_bytes());
        for h in &self.powers_of_h {
            put_point(&mut out, h, G2_BYTES);
        }
        for party in &self.verification_keys {
            for v in party {
                put_point(&mut out, v, G2_BYTES);
            }
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BteError> {
        let mut r = Reader::new(bytes, TYPE_PUBLIC_PARAMS)?;
        let n = r.u16()?;
        let t = r.u16()?;
        let b = r.u32()?;
        if n == 0 || t == 0 || t > n || b == 0 {
            return Err(wire_err("invalid committee parameters"));
        }
        let e = r.gt()?;
        let h_count = r.u32()? as usize;
        if h_count != 2 * b as usize + 1 {
            return Err(wire_err("powers_of_h count must be 2B+1"));
        }
        let mut powers_of_h = Vec::with_capacity(h_count);
        for _ in 0..h_count {
            powers_of_h.push(r.g2()?);
        }
        let mut verification_keys = Vec::with_capacity(n as usize);
        for _ in 0..n {
            let mut vk = Vec::with_capacity(b as usize);
            for _ in 0..b {
                vk.push(r.g2()?);
            }
            verification_keys.push(vk);
        }
        r.finish()?;
        Ok(PublicParams::assemble(
            n,
            t,
            b,
            EncryptionKey { e },
            powers_of_h,
            verification_keys,
        ))
    }
}

impl OperatorSecret {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + 2 + 4 + self.shares.len() * SCALAR_BYTES);
        header(&mut out, TYPE_OPERATOR_SECRET);
        out.extend_from_slice(&self.party_index.to_le_bytes());
        out.extend_from_slice(&(self.shares.len() as u32).to_le_bytes());
        for s in &self.shares {
            put_point(&mut out, s, SCALAR_BYTES);
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BteError> {
        let mut r = Reader::new(bytes, TYPE_OPERATOR_SECRET)?;
        let party_index = r.u16()?;
        if party_index == 0 {
            return Err(wire_err("party index is 1-based"));
        }
        let count = r.u32()? as usize;
        let mut shares = Vec::with_capacity(count);
        for _ in 0..count {
            shares.push(r.scalar()?);
        }
        r.finish()?;
        Ok(OperatorSecret {
            party_index,
            shares,
        })
    }
}

/// A ct header is the bare 48-byte compressed KEM element `[k]_1` — no magic,
/// because headers travel packed inside batch messages.
pub fn header_to_bytes(h: &crate::CtHeader) -> [u8; G1_BYTES] {
    let mut out = Vec::with_capacity(G1_BYTES);
    put_point(&mut out, &h.0, G1_BYTES);
    out.try_into().unwrap()
}

pub fn header_from_bytes(bytes: &[u8]) -> Result<crate::CtHeader, BteError> {
    if bytes.len() != G1_BYTES {
        return Err(wire_err("ct header must be exactly 48 bytes"));
    }
    let p = G1Affine::deserialize_compressed(bytes).map_err(|_| wire_err("invalid G1 point"))?;
    Ok(crate::CtHeader(p))
}
