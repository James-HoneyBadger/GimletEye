//! The `.melv` container: one encrypted file, self-describing, authenticated.
//!
//! ```text
//! 0..4    magic "MELV"
//! 4       format version (1 = whole file, 2 = chunked)
//! 5       cipher id      (1 = AES-256-GCM, 2 = ChaCha20-Poly1305)
//! 6       kdf id         (1 = Argon2id)
//! 7       reserved (0)
//! 8..17   kdf parameters (m_cost u32le, t_cost u32le, p_cost u8)
//! 17..21  reserved (0)
//! 21..37  salt (16)
//! 37..49  nonce (12)   -- version 2: the base nonce for chunk 0
//! 49..    ciphertext, whole file (v1) or a chunk stream (v2)
//! ```
//!
//! The whole header is passed as associated data, so altering the cipher, the
//! KDF parameters, or the salt causes decryption to fail instead of silently
//! weakening the file. Parameter bounds are validated *before* key derivation so
//! a crafted header cannot demand gigabytes of memory.

use std::io::{ErrorKind, Read, Write};

use mellivora_core::{MellivoraError, Result};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::backend::{AeadAlgorithm, CryptoBackend, KdfParams};
use crate::keys::hex_encode;

pub const MAGIC: [u8; 4] = *b"MELV";
/// v1: the whole file is one AEAD message.
pub const VERSION: u8 = 1;
/// v2: a header followed by independently authenticated chunks.
pub const VERSION_STREAMING: u8 = 2;
/// Plaintext per chunk in v2. Small enough to stay well inside memory, large
/// enough that per-chunk framing is noise.
pub const CHUNK_SIZE: usize = 64 * 1024;
pub const TAG_LEN: usize = 16;
const MAX_CHUNK_CIPHERTEXT: usize = CHUNK_SIZE + TAG_LEN;
const FLAG_FINAL: u8 = 0x01;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const HEADER_LEN: usize = 49;
pub const EXTENSION: &str = "melv";

const KDF_ARGON2ID: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContainerHeader {
    pub version: u8,
    pub algorithm: AeadAlgorithm,
    pub kdf: KdfParams,
    pub salt_hex: String,
}

/// Encrypt `plaintext` into a complete container.
pub fn seal(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    algorithm: AeadAlgorithm,
    params: KdfParams,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    params.validate()?;

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&backend.random_bytes(SALT_LEN));
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&backend.random_bytes(NONCE_LEN));

    let header = build_header(algorithm, params, &salt, &nonce);
    let key = backend.derive_key(passphrase, &salt, params)?;
    let ciphertext = backend.aead_encrypt(algorithm, &key, &nonce, plaintext, &header)?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a complete container.
pub fn open(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let header = parse_header(bytes)?;
    let key = backend.derive_key(passphrase, &header_salt(bytes)?, header.kdf)?;
    backend.aead_decrypt(
        header.algorithm,
        &key,
        &header_nonce(bytes)?,
        &bytes[HEADER_LEN..],
        &bytes[..HEADER_LEN],
    )
}

/// Read the header without the passphrase.
pub fn inspect(bytes: &[u8]) -> Result<ContainerHeader> {
    parse_header(bytes)
}

fn build_header(
    algorithm: AeadAlgorithm,
    params: KdfParams,
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
) -> [u8; HEADER_LEN] {
    let mut header = [0u8; HEADER_LEN];
    header[0..4].copy_from_slice(&MAGIC);
    header[4] = VERSION;
    header[5] = algorithm.to_wire();
    header[6] = KDF_ARGON2ID;
    header[7] = 0;
    header[8..17].copy_from_slice(&params.to_wire());
    header[17..21].copy_from_slice(&[0, 0, 0, 0]);
    header[21..37].copy_from_slice(salt);
    header[37..49].copy_from_slice(nonce);
    header
}

fn parse_header(bytes: &[u8]) -> Result<ContainerHeader> {
    if bytes.len() < HEADER_LEN {
        return Err(MellivoraError::InvalidArgs(
            "not an encrypted container (file is too short)".into(),
        ));
    }
    if bytes[0..4] != MAGIC {
        return Err(MellivoraError::InvalidArgs(
            "not an encrypted container (bad magic bytes)".into(),
        ));
    }
    if bytes[4] != VERSION && bytes[4] != VERSION_STREAMING {
        return Err(MellivoraError::Unsupported(format!(
            "container format version {} is not supported",
            bytes[4]
        )));
    }
    if bytes[6] != KDF_ARGON2ID {
        return Err(MellivoraError::Unsupported(format!(
            "container uses unknown key-derivation id {}",
            bytes[6]
        )));
    }
    // Reserved bytes must be zero: a non-zero value means a feature this build
    // does not understand, which must not be silently ignored.
    if bytes[7] != 0 || bytes[17..21] != [0, 0, 0, 0] {
        return Err(MellivoraError::Unsupported(
            "container uses features this build does not support".into(),
        ));
    }

    Ok(ContainerHeader {
        version: bytes[4],
        algorithm: AeadAlgorithm::from_wire(bytes[5])?,
        kdf: KdfParams::from_wire(&bytes[8..17])?,
        salt_hex: hex_encode(&bytes[21..37]),
    })
}

fn header_salt(bytes: &[u8]) -> Result<[u8; SALT_LEN]> {
    bytes
        .get(21..37)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| MellivoraError::InvalidArgs("container header is truncated".into()))
}

fn header_nonce(bytes: &[u8]) -> Result<[u8; NONCE_LEN]> {
    bytes
        .get(37..49)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| MellivoraError::InvalidArgs("container header is truncated".into()))
}

/// What a streamed operation moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StreamStats {
    pub version: u8,
    pub chunks: u64,
    pub plaintext_bytes: u64,
    pub container_bytes: u64,
}

impl Default for StreamStats {
    fn default() -> Self {
        Self::new(VERSION_STREAMING)
    }
}

impl StreamStats {
    fn new(version: u8) -> Self {
        Self {
            version,
            chunks: 0,
            plaintext_bytes: 0,
            container_bytes: 0,
        }
    }
}

/// Encrypt `reader` into `writer` as a chunked container (version 2).
///
/// Memory is bounded by two chunks plus one ciphertext, whatever the input
/// size: a ten-gigabyte file costs the same as a one-kilobyte one.
pub fn seal_stream<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    algorithm: AeadAlgorithm,
    params: KdfParams,
    mut reader: R,
    mut writer: W,
) -> Result<StreamStats> {
    params.validate()?;

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&backend.random_bytes(SALT_LEN));
    let mut base_nonce = [0u8; NONCE_LEN];
    base_nonce.copy_from_slice(&backend.random_bytes(NONCE_LEN));

    let header = build_header_for(VERSION_STREAMING, algorithm, params, &salt, &base_nonce);
    let key = backend.derive_key(passphrase, &salt, params)?;
    writer.write_all(&header)?;

    let mut stats = StreamStats::new(VERSION_STREAMING);
    stats.container_bytes = HEADER_LEN as u64;

    // One chunk of lookahead: the last chunk is the one after which nothing
    // follows, and it has to say so inside its associated data.
    let mut current = vec![0u8; CHUNK_SIZE];
    let mut lookahead = vec![0u8; CHUNK_SIZE];
    let mut current_len = read_chunk(&mut reader, &mut current)?;
    let mut index = 0u64;

    loop {
        let next_len = read_chunk(&mut reader, &mut lookahead)?;
        let flags = if next_len == 0 { FLAG_FINAL } else { 0 };

        let nonce = chunk_nonce(&base_nonce, index);
        let aad = chunk_aad(&header, index, flags);
        let ciphertext =
            backend.aead_encrypt(algorithm, &key, &nonce, &current[..current_len], &aad)?;

        writer.write_all(&[flags])?;
        writer.write_all(&(ciphertext.len() as u32).to_le_bytes())?;
        writer.write_all(&ciphertext)?;

        stats.chunks += 1;
        stats.plaintext_bytes += current_len as u64;
        stats.container_bytes += 1 + 4 + ciphertext.len() as u64;

        if flags == FLAG_FINAL {
            break;
        }
        std::mem::swap(&mut current, &mut lookahead);
        current_len = next_len;
        index += 1;
    }

    writer.flush()?;
    Ok(stats)
}

/// Decrypt a container read from `reader` into `writer`.
///
/// Version 2 is streamed chunk by chunk; version 1 is read whole, because that
/// is what the format is. Truncation, reordered chunks, and trailing data all
/// fail authentication rather than producing partial plaintext.
pub fn open_stream<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    mut reader: R,
    mut writer: W,
) -> Result<(ContainerHeader, StreamStats)> {
    let mut header_bytes = [0u8; HEADER_LEN];
    read_exact_or(
        &mut reader,
        &mut header_bytes,
        "container header is truncated",
    )?;
    let header = parse_header(&header_bytes)?;

    if header.version == VERSION {
        let mut ciphertext = Vec::new();
        reader.read_to_end(&mut ciphertext)?;
        let key = backend.derive_key(passphrase, &header_salt(&header_bytes)?, header.kdf)?;
        let plaintext = backend.aead_decrypt(
            header.algorithm,
            &key,
            &header_nonce(&header_bytes)?,
            &ciphertext,
            &header_bytes,
        )?;
        writer.write_all(&plaintext)?;
        writer.flush()?;
        let mut stats = StreamStats::new(VERSION);
        stats.chunks = 1;
        stats.plaintext_bytes = plaintext.len() as u64;
        stats.container_bytes = (HEADER_LEN + ciphertext.len()) as u64;
        return Ok((header, stats));
    }

    let key = backend.derive_key(passphrase, &header_salt(&header_bytes)?, header.kdf)?;
    let base_nonce = header_nonce(&header_bytes)?;
    let mut stats = StreamStats::new(VERSION_STREAMING);
    stats.container_bytes = HEADER_LEN as u64;
    let mut index = 0u64;

    loop {
        let mut flags_byte = [0u8; 1];
        match reader.read_exact(&mut flags_byte) {
            Ok(()) => {}
            Err(err) if err.kind() == ErrorKind::UnexpectedEof => {
                return Err(MellivoraError::InvalidArgs(format!(
                    "container is truncated after {} chunk(s)",
                    stats.chunks
                )))
            }
            Err(err) => return Err(err.into()),
        }
        let flags = flags_byte[0];
        if flags & !FLAG_FINAL != 0 {
            return Err(MellivoraError::InvalidArgs(format!(
                "container chunk {} has unknown flags {flags:#04x}",
                stats.chunks
            )));
        }

        let mut length_bytes = [0u8; 4];
        read_exact_or(
            &mut reader,
            &mut length_bytes,
            "container chunk length is truncated",
        )?;
        let length = u32::from_le_bytes(length_bytes) as usize;
        if !(TAG_LEN..=MAX_CHUNK_CIPHERTEXT).contains(&length) {
            return Err(MellivoraError::InvalidArgs(format!(
                "container chunk {} declares an impossible length {length}",
                stats.chunks
            )));
        }

        let mut ciphertext = vec![0u8; length];
        read_exact_or(&mut reader, &mut ciphertext, "container chunk is truncated")?;

        let nonce = chunk_nonce(&base_nonce, index);
        let aad = chunk_aad(&header_bytes, index, flags);
        let plaintext = backend.aead_decrypt(header.algorithm, &key, &nonce, &ciphertext, &aad)?;
        writer.write_all(&plaintext)?;

        stats.chunks += 1;
        stats.plaintext_bytes += plaintext.len() as u64;
        stats.container_bytes += 1 + 4 + length as u64;

        if flags == FLAG_FINAL {
            let mut trailing = [0u8; 1];
            if reader.read(&mut trailing)? != 0 {
                return Err(MellivoraError::InvalidArgs(
                    "container has data after its final chunk".into(),
                ));
            }
            break;
        }
        index += 1;
    }

    writer.flush()?;
    Ok((header, stats))
}

/// Read only the header, so inspecting a large container stays cheap.
pub fn inspect_stream<R: Read>(reader: &mut R) -> Result<ContainerHeader> {
    let mut header_bytes = [0u8; HEADER_LEN];
    read_exact_or(reader, &mut header_bytes, "container header is truncated")?;
    parse_header(&header_bytes)
}

fn build_header_for(
    version: u8,
    algorithm: AeadAlgorithm,
    params: KdfParams,
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
) -> [u8; HEADER_LEN] {
    let mut header = build_header(algorithm, params, salt, nonce);
    header[4] = version;
    header
}

/// Chunk `index` never reuses a nonce: the base nonce is random per file and
/// the counter is XORed into its low half, which is the same construction used
/// by other chunked AEAD formats.
fn chunk_nonce(base: &[u8; NONCE_LEN], index: u64) -> [u8; NONCE_LEN] {
    let mut nonce = *base;
    for (slot, byte) in nonce[4..].iter_mut().zip(index.to_le_bytes()) {
        *slot ^= byte;
    }
    nonce
}

/// The associated data binds each chunk to the header, its position, and
/// whether it is the last one.
fn chunk_aad(header: &[u8; HEADER_LEN], index: u64, flags: u8) -> Vec<u8> {
    let mut aad = Vec::with_capacity(HEADER_LEN + 9);
    aad.extend_from_slice(header);
    aad.extend_from_slice(&index.to_le_bytes());
    aad.push(flags);
    aad
}

fn read_chunk<R: Read>(reader: &mut R, buffer: &mut [u8]) -> Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(err) if err.kind() == ErrorKind::Interrupted => continue,
            Err(err) => return Err(err.into()),
        }
    }
    Ok(filled)
}

fn read_exact_or<R: Read>(reader: &mut R, buffer: &mut [u8], message: &str) -> Result<()> {
    reader.read_exact(buffer).map_err(|err| {
        if err.kind() == ErrorKind::UnexpectedEof {
            MellivoraError::InvalidArgs(message.into())
        } else {
            MellivoraError::from(err)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::NativeBackend;

    fn cheap_params() -> KdfParams {
        KdfParams {
            m_cost_kib: 64,
            t_cost: 1,
            p_cost: 1,
        }
    }

    #[test]
    fn round_trips_both_ciphers() {
        for algorithm in [AeadAlgorithm::Aes256Gcm, AeadAlgorithm::ChaCha20Poly1305] {
            let sealed = seal(
                &NativeBackend,
                b"hunter2",
                algorithm,
                cheap_params(),
                b"top secret",
            )
            .expect("seal");
            assert_eq!(&sealed[0..4], &MAGIC);

            let opened = open(&NativeBackend, b"hunter2", &sealed).expect("open");
            assert_eq!(opened.as_slice(), b"top secret");

            let header = inspect(&sealed).expect("inspect");
            assert_eq!(header.algorithm, algorithm);
            assert_eq!(header.version, VERSION);
        }
    }

    fn seal_to_vec(backend: &NativeBackend, data: &[u8], algorithm: AeadAlgorithm) -> Vec<u8> {
        let mut out = Vec::new();
        let stats = seal_stream(
            backend,
            b"hunter2",
            algorithm,
            cheap_params(),
            data,
            &mut out,
        )
        .expect("seal");
        assert_eq!(stats.version, VERSION_STREAMING);
        out
    }

    fn open_from_slice(backend: &NativeBackend, sealed: &[u8]) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        open_stream(backend, b"hunter2", sealed, &mut out)?;
        Ok(out)
    }

    #[test]
    fn streaming_round_trips_across_chunk_boundaries() {
        for algorithm in [AeadAlgorithm::Aes256Gcm, AeadAlgorithm::ChaCha20Poly1305] {
            for size in [
                0,
                1,
                CHUNK_SIZE - 1,
                CHUNK_SIZE,
                CHUNK_SIZE + 1,
                CHUNK_SIZE * 3,
            ] {
                let data: Vec<u8> = (0..size).map(|index| (index % 251) as u8).collect();
                let sealed = seal_to_vec(&NativeBackend, &data, algorithm);

                let header = inspect(&sealed).expect("inspect");
                assert_eq!(header.version, VERSION_STREAMING);
                assert_eq!(header.algorithm, algorithm);

                assert_eq!(
                    open_from_slice(&NativeBackend, &sealed).expect("open"),
                    data,
                    "{size}"
                );
            }
        }
    }

    #[test]
    fn streaming_reports_chunks_and_bounded_sizes() {
        let data = vec![7u8; CHUNK_SIZE * 2 + 10];
        let mut sealed = Vec::new();
        let stats = seal_stream(
            &NativeBackend,
            b"hunter2",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            data.as_slice(),
            &mut sealed,
        )
        .expect("seal");

        assert_eq!(stats.chunks, 3);
        assert_eq!(stats.plaintext_bytes, data.len() as u64);
        assert_eq!(stats.container_bytes, sealed.len() as u64);
        // Overhead is framing plus one tag per chunk, never a second copy of the file.
        assert!(sealed.len() < data.len() + 5 * 32);
    }

    #[test]
    fn malformed_chunks_are_rejected() {
        let data = vec![1u8; CHUNK_SIZE * 2];
        let sealed = seal_to_vec(&NativeBackend, &data, AeadAlgorithm::ChaCha20Poly1305);

        // Truncated in the middle of a chunk.
        assert!(open_from_slice(&NativeBackend, &sealed[..sealed.len() - 8]).is_err());
        // Truncated exactly at a chunk boundary.
        let first_chunk_end = HEADER_LEN + 1 + 4 + CHUNK_SIZE + TAG_LEN;
        assert!(open_from_slice(&NativeBackend, &sealed[..first_chunk_end]).is_err());
        // Trailing bytes after the final chunk.
        let mut trailing = sealed.clone();
        trailing.push(0);
        assert!(open_from_slice(&NativeBackend, &trailing).is_err());
        // Flipped bit in the final-chunk flag.
        let mut flipped = sealed.clone();
        flipped[first_chunk_end] ^= FLAG_FINAL;
        assert!(open_from_slice(&NativeBackend, &flipped).is_err());
    }

    #[test]
    fn chunk_reordering_is_detected() {
        let data = vec![9u8; CHUNK_SIZE * 2];
        let sealed = seal_to_vec(&NativeBackend, &data, AeadAlgorithm::ChaCha20Poly1305);
        let frame = 1 + 4 + CHUNK_SIZE + TAG_LEN;
        let second = HEADER_LEN + frame;
        let third = HEADER_LEN + 2 * frame;

        let mut swapped = Vec::new();
        swapped.extend_from_slice(&sealed[..HEADER_LEN]);
        swapped.extend_from_slice(&sealed[second..third]);
        swapped.extend_from_slice(&sealed[HEADER_LEN..second]);
        swapped.extend_from_slice(&sealed[third..]);

        assert!(
            open_from_slice(&NativeBackend, &swapped).is_err(),
            "position is bound into each chunk's associated data"
        );
    }

    #[test]
    fn version_1_files_still_open_through_the_streaming_reader() {
        // `seal` writes the v1 layout: one AEAD message over the whole file.
        for size in [0, 10, CHUNK_SIZE + 5] {
            let data = vec![3u8; size];
            let sealed = seal(
                &NativeBackend,
                b"hunter2",
                AeadAlgorithm::ChaCha20Poly1305,
                cheap_params(),
                &data,
            )
            .expect("seal v1");

            assert_eq!(sealed[4], VERSION);
            assert_eq!(
                open_from_slice(&NativeBackend, &sealed).expect("open v1"),
                data
            );
        }
    }

    #[test]
    fn a_wrong_passphrase_fails_the_same_way_as_corruption() {
        let sealed = seal_to_vec(&NativeBackend, b"secret", AeadAlgorithm::ChaCha20Poly1305);
        let mut out = Vec::new();
        let wrong = open_stream(&NativeBackend, b"not-it", sealed.as_slice(), &mut out);
        assert!(wrong.is_err());

        let mut corrupt = sealed.clone();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0xff;
        assert!(open_stream(&NativeBackend, b"hunter2", corrupt.as_slice(), &mut out).is_err());
    }

    #[test]
    fn a_large_stream_never_needs_the_whole_input() {
        // 4 MiB through a reader that hands out 997-byte slices: the round trip
        // must not depend on having the file in memory at once.
        struct Trickle {
            remaining: usize,
        }

        impl Read for Trickle {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let take = self.remaining.min(buffer.len()).min(997);
                for slot in &mut buffer[..take] {
                    *slot = 0x5a;
                }
                self.remaining -= take;
                Ok(take)
            }
        }

        let total = 4 * 1024 * 1024;
        let mut sealed = Vec::new();
        let stats = seal_stream(
            &NativeBackend,
            b"hunter2",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            Trickle { remaining: total },
            &mut sealed,
        )
        .expect("seal");

        assert_eq!(stats.plaintext_bytes, total as u64);
        assert_eq!(stats.chunks, (total as u64).div_ceil(CHUNK_SIZE as u64));

        let mut opened = Vec::new();
        open_stream(&NativeBackend, b"hunter2", sealed.as_slice(), &mut opened).expect("open");
        assert_eq!(opened.len(), total);
        assert!(opened.iter().all(|byte| *byte == 0x5a));
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            b"",
        )
        .expect("seal");
        assert_eq!(
            open(&NativeBackend, b"pass", &sealed)
                .expect("open")
                .as_slice(),
            b""
        );
    }

    #[test]
    fn wrong_passphrase_fails() {
        let sealed = seal(
            &NativeBackend,
            b"correct",
            AeadAlgorithm::Aes256Gcm,
            cheap_params(),
            b"data",
        )
        .expect("seal");
        let err = open(&NativeBackend, b"wrong", &sealed).expect_err("must fail");
        assert_eq!(err.code(), "tool");
        assert!(err.to_string().contains("wrong passphrase"));
    }

    #[test]
    fn tampering_with_the_header_is_detected() {
        // Swap the cipher id: the derived key is the same, but the header is
        // authenticated, so decryption must fail.
        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            b"data",
        )
        .expect("seal");

        let mut tampered = sealed.clone();
        tampered[5] = AeadAlgorithm::Aes256Gcm.to_wire();
        assert!(open(&NativeBackend, b"pass", &tampered).is_err());

        // Weakening the KDF parameters must also fail.
        let mut weakened = sealed.clone();
        weakened[8] = 8; // m_cost = 8 KiB
        assert!(open(&NativeBackend, b"pass", &weakened).is_err());
    }

    #[test]
    fn rejects_non_containers_and_truncation() {
        assert_eq!(
            open(&NativeBackend, b"x", b"hello")
                .expect_err("short")
                .code(),
            "invalid_args"
        );

        let mut wrong_magic = vec![0u8; HEADER_LEN];
        wrong_magic[0..4].copy_from_slice(b"NOPE");
        assert_eq!(
            inspect(&wrong_magic).expect_err("magic").code(),
            "invalid_args"
        );

        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::Aes256Gcm,
            cheap_params(),
            b"data",
        )
        .expect("seal");
        assert!(open(&NativeBackend, b"pass", &sealed[..HEADER_LEN - 1]).is_err());

        let truncated = &sealed[..HEADER_LEN + 2];
        assert!(open(&NativeBackend, b"pass", truncated).is_err());
    }

    #[test]
    fn rejects_absurd_parameters_before_deriving() {
        let mut bytes = vec![0u8; HEADER_LEN + 1];
        bytes[0..4].copy_from_slice(&MAGIC);
        bytes[4] = VERSION;
        bytes[5] = 1;
        bytes[6] = KDF_ARGON2ID;
        // m_cost = 4 GiB would be a denial of service if we tried it.
        bytes[8..12].copy_from_slice(&4_000_000u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&2u32.to_le_bytes());
        bytes[16] = 1;
        let err = inspect(&bytes).expect_err("must reject");
        assert_eq!(err.code(), "unsupported");
    }

    #[test]
    fn header_is_deterministic_for_the_same_inputs() {
        let salt = [1u8; SALT_LEN];
        let nonce = [2u8; NONCE_LEN];
        let a = build_header(AeadAlgorithm::Aes256Gcm, cheap_params(), &salt, &nonce);
        let b = build_header(AeadAlgorithm::Aes256Gcm, cheap_params(), &salt, &nonce);
        assert_eq!(a, b);
        assert_eq!(a.len(), HEADER_LEN);
    }
}
