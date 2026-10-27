//! The `.gimlet` container: one encrypted file, self-describing, authenticated.
//!
//! ```text
//! 0..4    magic "GIML"
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
//! Version 3 replaces the passphrase with recipients, and with it the 49-byte
//! header:
//!
//! ```text
//! 0..4    magic "GIML"
//! 4       format version (3)
//! 5       cipher id
//! 6       kdf id (3 = x25519-hkdf-sha256)
//! 7       reserved (0)
//! 8..40   ephemeral X25519 public key, one per file
//! 40..44  recipient count (u32le)
//! 44..    recipients, count × 92: public key(32) | wrap nonce(12) | wrapped file key(48)
//! ...     base nonce (12)
//! ...     the same chunk stream as version 2, under the unwrapped file key
//! ```
//!
//! The whole header is passed as associated data, so altering the cipher, the
//! KDF parameters, or the salt causes decryption to fail instead of silently
//! weakening the file. Parameter bounds are validated *before* key derivation so
//! a crafted header cannot demand gigabytes of memory.
//!
//! Containers written before the project was renamed carry the magic `MELV`
//! instead. Reading accepts both; writing uses `GIML`.

use std::io::{ErrorKind, Read, Write};

use gimlet_eye_core::{GimletEyeError, Result};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::backend::{AeadAlgorithm, CryptoBackend, KdfParams};
use crate::keys::hex_encode;

/// Magic written by this build.
pub const MAGIC: [u8; 4] = *b"GIML";
/// Magic of containers written before the rename. Read, never written.
pub const LEGACY_MAGIC: [u8; 4] = *b"MELV";
/// True when `bytes` begins with a magic this build understands.
pub fn has_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && (bytes[0..4] == MAGIC || bytes[0..4] == LEGACY_MAGIC)
}
/// v1: the whole file is one AEAD message.
pub const VERSION: u8 = 1;
/// v2: a header followed by independently authenticated chunks.
pub const VERSION_STREAMING: u8 = 2;
/// v3: a recipient block, then the same chunk stream as v2.
pub const VERSION_RECIPIENT: u8 = 3;
/// Plaintext per chunk in v2. Small enough to stay well inside memory, large
/// enough that per-chunk framing is noise.
pub const CHUNK_SIZE: usize = 64 * 1024;
pub const TAG_LEN: usize = 16;
const MAX_CHUNK_CIPHERTEXT: usize = CHUNK_SIZE + TAG_LEN;
const FLAG_FINAL: u8 = 0x01;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const HEADER_LEN: usize = 49;
pub const EXTENSION: &str = "gimlet";
/// Extension of containers written before the rename.
pub const LEGACY_EXTENSION: &str = "melv";
/// Bytes before the recipient block in a v3 header.
pub const RECIPIENT_PREFIX_LEN: usize = 44;
/// One recipient entry: public key, wrap nonce, wrapped file key.
pub const RECIPIENT_ENTRY_LEN: usize = 92;
/// A hostile file must not make the reader allocate without bound.
pub const MAX_RECIPIENTS: usize = 1024;

const KDF_ARGON2ID: u8 = 1;
const KDF_X25519_HKDF: u8 = 3;
/// Frozen: files written before the rename bind this label into their key
/// derivation, so it is part of the format rather than of the naming.
const WRAP_INFO: &[u8] = b"melv-v3-recipient";

/// How the payload key is reached: a passphrase (v1/v2) or a recipient (v3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kdf {
    Argon2id(KdfParams),
    X25519HkdfSha256,
}

impl Kdf {
    /// Argon2id parameters, or an error for containers that take a key instead.
    pub fn argon2id(&self) -> Result<KdfParams> {
        match self {
            Self::Argon2id(params) => Ok(*params),
            Self::X25519HkdfSha256 => Err(GimletEyeError::InvalidArgs(
                "this container is encrypted for keys, not for a passphrase".into(),
            )),
        }
    }
}

impl Serialize for Kdf {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::Argon2id(params) => params.serialize(serializer),
            Self::X25519HkdfSha256 => serializer.serialize_str("x25519-hkdf-sha256"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContainerHeader {
    pub version: u8,
    pub algorithm: AeadAlgorithm,
    pub kdf: Kdf,
    /// Argon2id salt; empty for version 3.
    pub salt_hex: String,
    /// Per-file ephemeral X25519 public key; empty before version 3.
    pub ephemeral_hex: String,
    /// Recipient public keys in hex; empty before version 3.
    pub recipients: Vec<String>,
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

/// Decrypt a complete container held in memory.
///
/// Both layouts are accepted: a version 2 file is handed to the chunked reader,
/// so `open` can never disagree with `crypto.decrypt` about what a file is and
/// report a chunked container as a wrong passphrase.
pub fn open(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let header = parse_header(bytes)?;
    if header.version == VERSION_STREAMING {
        let mut plaintext = Vec::new();
        open_stream(backend, passphrase, bytes, &mut plaintext)?;
        return Ok(Zeroizing::new(plaintext));
    }
    let key = backend.derive_key(passphrase, &header_salt(bytes)?, header.kdf.argon2id()?)?;
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
    if bytes.len() < 5 {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (file is too short)".into(),
        ));
    }
    if !has_magic(bytes) {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (bad magic bytes)".into(),
        ));
    }
    if bytes[4] == VERSION_RECIPIENT {
        return parse_recipient_header(bytes);
    }
    if bytes[4] != VERSION && bytes[4] != VERSION_STREAMING {
        return Err(GimletEyeError::Unsupported(format!(
            "container format version {} is not supported",
            bytes[4]
        )));
    }
    if bytes.len() < HEADER_LEN {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (file is too short)".into(),
        ));
    }
    if bytes[6] != KDF_ARGON2ID {
        return Err(GimletEyeError::Unsupported(format!(
            "container uses unknown key-derivation id {}",
            bytes[6]
        )));
    }
    // Reserved bytes must be zero: a non-zero value means a feature this build
    // does not understand, which must not be silently ignored.
    if bytes[7] != 0 || bytes[17..21] != [0, 0, 0, 0] {
        return Err(GimletEyeError::Unsupported(
            "container uses features this build does not support".into(),
        ));
    }

    Ok(ContainerHeader {
        version: bytes[4],
        algorithm: AeadAlgorithm::from_wire(bytes[5])?,
        kdf: Kdf::Argon2id(KdfParams::from_wire(&bytes[8..17])?),
        salt_hex: hex_encode(&bytes[21..37]),
        ephemeral_hex: String::new(),
        recipients: Vec::new(),
    })
}

fn recipient_count(bytes: &[u8]) -> Result<usize> {
    let raw = bytes.get(40..44).ok_or_else(|| {
        GimletEyeError::InvalidArgs("not an encrypted container (header is too short)".into())
    })?;
    let count = u32::from_le_bytes(raw.try_into().expect("4 bytes")) as usize;
    if count == 0 {
        return Err(GimletEyeError::InvalidArgs(
            "recipient container names no recipients".into(),
        ));
    }
    if count > MAX_RECIPIENTS {
        return Err(GimletEyeError::InvalidArgs(format!(
            "recipient container names {count} recipients (limit {MAX_RECIPIENTS})"
        )));
    }
    Ok(count)
}

fn parse_recipient_header(bytes: &[u8]) -> Result<ContainerHeader> {
    if bytes.len() < RECIPIENT_PREFIX_LEN {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (file is too short)".into(),
        ));
    }
    if !has_magic(bytes) {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (bad magic bytes)".into(),
        ));
    }
    if bytes[6] != KDF_X25519_HKDF {
        return Err(GimletEyeError::Unsupported(format!(
            "container uses unknown key-derivation id {}",
            bytes[6]
        )));
    }
    if bytes[7] != 0 {
        return Err(GimletEyeError::Unsupported(
            "container uses features this build does not support".into(),
        ));
    }
    let count = recipient_count(bytes)?;
    let needed = RECIPIENT_PREFIX_LEN + count * RECIPIENT_ENTRY_LEN + NONCE_LEN;
    if bytes.len() < needed {
        return Err(GimletEyeError::InvalidArgs(
            "container header is truncated".into(),
        ));
    }

    let recipients = (0..count)
        .map(|index| {
            let at = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN;
            hex_encode(&bytes[at..at + 32])
        })
        .collect();

    Ok(ContainerHeader {
        version: VERSION_RECIPIENT,
        algorithm: AeadAlgorithm::from_wire(bytes[5])?,
        kdf: Kdf::X25519HkdfSha256,
        salt_hex: String::new(),
        ephemeral_hex: hex_encode(&bytes[8..40]),
        recipients,
    })
}

fn header_salt(bytes: &[u8]) -> Result<[u8; SALT_LEN]> {
    bytes
        .get(21..37)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| GimletEyeError::InvalidArgs("container header is truncated".into()))
}

fn header_nonce(bytes: &[u8]) -> Result<[u8; NONCE_LEN]> {
    bytes
        .get(37..49)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| GimletEyeError::InvalidArgs("container header is truncated".into()))
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

/// The AAD for one recipient's wrapped key: the fixed prefix plus that
/// recipient's public key, so a block cannot be moved between files or swapped
/// between recipients.
fn recipient_aad(prefix: &[u8], recipient: &[u8; 32]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(prefix.len() + 32);
    aad.extend_from_slice(prefix);
    aad.extend_from_slice(recipient);
    aad
}

fn recipient_kek(
    backend: &dyn CryptoBackend,
    shared: &[u8; 32],
    ephemeral: &[u8; 32],
    recipient: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>> {
    let mut info = Vec::with_capacity(WRAP_INFO.len() + 32);
    info.extend_from_slice(WRAP_INFO);
    info.extend_from_slice(recipient);
    backend.hkdf_sha256(shared, ephemeral, &info)
}

/// Encrypt `reader` into `writer` for a list of X25519 recipients (version 3).
///
/// One ephemeral keypair per file is shared by every recipient; each recipient
/// gets its own wrap nonce and its own KEK, and all of them wrap the same random
/// file key. The chunk stream below the header is byte-for-byte the version 2
/// framing, so the streaming guarantees are unchanged.
pub fn seal_for_recipients<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    algorithm: AeadAlgorithm,
    recipients: &[[u8; 32]],
    mut reader: R,
    mut writer: W,
) -> Result<StreamStats> {
    if recipients.is_empty() {
        return Err(GimletEyeError::InvalidArgs(
            "provide at least one recipient public key".into(),
        ));
    }
    if recipients.len() > MAX_RECIPIENTS {
        return Err(GimletEyeError::InvalidArgs(format!(
            "{} recipients exceeds the limit of {MAX_RECIPIENTS}",
            recipients.len()
        )));
    }
    let mut seen: Vec<[u8; 32]> = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        if seen.contains(recipient) {
            return Err(GimletEyeError::InvalidArgs(
                "the same recipient is listed twice".into(),
            ));
        }
        seen.push(*recipient);
    }

    let ephemeral = backend.x25519_keygen();
    let mut file_key = Zeroizing::new([0u8; 32]);
    file_key.copy_from_slice(&backend.random_bytes(32));
    let mut base_nonce = [0u8; NONCE_LEN];
    base_nonce.copy_from_slice(&backend.random_bytes(NONCE_LEN));

    let mut header = Vec::with_capacity(
        RECIPIENT_PREFIX_LEN + recipients.len() * RECIPIENT_ENTRY_LEN + NONCE_LEN,
    );
    header.extend_from_slice(&MAGIC);
    header.push(VERSION_RECIPIENT);
    header.push(algorithm.to_wire());
    header.push(KDF_X25519_HKDF);
    header.push(0);
    header.extend_from_slice(&ephemeral.public);
    header.extend_from_slice(&(recipients.len() as u32).to_le_bytes());
    let prefix = header.clone();

    for recipient in recipients {
        let shared = backend.x25519_shared(&ephemeral.secret, recipient)?;
        let kek = recipient_kek(backend, &shared, &ephemeral.public, recipient)?;
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&backend.random_bytes(NONCE_LEN));
        let wrapped = backend.aead_encrypt(
            algorithm,
            &kek,
            &nonce,
            file_key.as_ref(),
            &recipient_aad(&prefix, recipient),
        )?;
        if wrapped.len() != 32 + TAG_LEN {
            return Err(GimletEyeError::Internal(
                "wrapped key has an unexpected length".into(),
            ));
        }
        header.extend_from_slice(recipient);
        header.extend_from_slice(&nonce);
        header.extend_from_slice(&wrapped);
    }
    header.extend_from_slice(&base_nonce);

    writer.write_all(&header)?;
    write_chunks(
        backend,
        algorithm,
        &file_key,
        &header,
        &base_nonce,
        &mut reader,
        &mut writer,
        VERSION_RECIPIENT,
    )
}

/// Decrypt a version 3 container with the secret half of one recipient key.
///
/// The recipient is found by comparing the public key derived from `secret`
/// against the header block, so a file meant for someone else is reported as
/// such instead of as a decryption failure.
pub fn open_for_recipient<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    secret: &[u8; 32],
    mut reader: R,
    mut writer: W,
) -> Result<(ContainerHeader, StreamStats)> {
    let mut prefix = [0u8; RECIPIENT_PREFIX_LEN];
    read_exact_or(&mut reader, &mut prefix, "container header is truncated")?;
    if !has_magic(&prefix) {
        return Err(GimletEyeError::InvalidArgs(
            "not an encrypted container (bad magic bytes)".into(),
        ));
    }
    if prefix[4] != VERSION_RECIPIENT {
        return Err(GimletEyeError::InvalidArgs(format!(
            "container version {} is not encrypted for a key (use its passphrase)",
            prefix[4]
        )));
    }
    let count = recipient_count(&prefix)?;
    let mut block = vec![0u8; count * RECIPIENT_ENTRY_LEN + NONCE_LEN];
    read_exact_or(&mut reader, &mut block, "container header is truncated")?;

    let mut header = Vec::with_capacity(RECIPIENT_PREFIX_LEN + block.len());
    header.extend_from_slice(&prefix);
    header.extend_from_slice(&block);
    let parsed = parse_recipient_header(&header)?;

    let me = backend.x25519_public(secret);
    let index = (0..count)
        .find(|index| {
            let at = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN;
            header[at..at + 32] == me
        })
        .ok_or_else(|| {
            GimletEyeError::Tool("this container is not encrypted for that key".into())
        })?;

    let ephemeral: [u8; 32] = header[8..40].try_into().expect("32 bytes");
    let shared = backend.x25519_shared(secret, &ephemeral)?;
    let kek = recipient_kek(backend, &shared, &ephemeral, &me)?;

    let at = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN;
    let wrap_nonce: [u8; NONCE_LEN] = header[at + 32..at + 44].try_into().expect("12 bytes");
    let wrapped = &header[at + 44..at + RECIPIENT_ENTRY_LEN];
    let unwrapped = backend.aead_decrypt(
        parsed.algorithm,
        &kek,
        &wrap_nonce,
        wrapped,
        &recipient_aad(&prefix, &me),
    )?;
    let mut file_key = Zeroizing::new([0u8; 32]);
    if unwrapped.len() != 32 {
        return Err(GimletEyeError::Tool(
            "the wrapped file key has an unexpected length".into(),
        ));
    }
    file_key.copy_from_slice(&unwrapped);

    let base_nonce: [u8; NONCE_LEN] = header[header.len() - NONCE_LEN..]
        .try_into()
        .expect("12 bytes");
    let stats = read_chunks(
        backend,
        parsed.algorithm,
        &file_key,
        &header,
        &base_nonce,
        &mut reader,
        &mut writer,
        VERSION_RECIPIENT,
    )?;
    Ok((parsed, stats))
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

    write_chunks(
        backend,
        algorithm,
        &key,
        &header,
        &base_nonce,
        &mut reader,
        &mut writer,
        VERSION_STREAMING,
    )
}

/// Write the chunk stream shared by versions 2 and 3.
///
/// One chunk of lookahead: the last chunk is the one after which nothing
/// follows, and it has to say so inside its associated data.
#[allow(clippy::too_many_arguments)]
fn write_chunks<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    algorithm: AeadAlgorithm,
    key: &[u8; 32],
    header: &[u8],
    base_nonce: &[u8; NONCE_LEN],
    reader: &mut R,
    writer: &mut W,
    version: u8,
) -> Result<StreamStats> {
    let mut stats = StreamStats::new(version);
    stats.container_bytes = header.len() as u64;

    let mut current = vec![0u8; CHUNK_SIZE];
    let mut lookahead = vec![0u8; CHUNK_SIZE];
    let mut current_len = read_chunk(reader, &mut current)?;
    let mut index = 0u64;

    loop {
        let next_len = read_chunk(reader, &mut lookahead)?;
        let flags = if next_len == 0 { FLAG_FINAL } else { 0 };

        let nonce = chunk_nonce(base_nonce, index);
        let aad = chunk_aad(header, index, flags);
        let ciphertext =
            backend.aead_encrypt(algorithm, key, &nonce, &current[..current_len], &aad)?;

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
    let mut probe = [0u8; 5];
    read_exact_or(&mut reader, &mut probe, "container header is truncated")?;
    if probe[4] == VERSION_RECIPIENT {
        return Err(GimletEyeError::InvalidArgs(
            "this container is encrypted for keys; decrypt it with the recipient's key".into(),
        ));
    }

    let mut header_bytes = [0u8; HEADER_LEN];
    header_bytes[..5].copy_from_slice(&probe);
    read_exact_or(
        &mut reader,
        &mut header_bytes[5..],
        "container header is truncated",
    )?;
    let header = parse_header(&header_bytes)?;

    if header.version == VERSION {
        let mut ciphertext = Vec::new();
        reader.read_to_end(&mut ciphertext)?;
        let key = backend.derive_key(
            passphrase,
            &header_salt(&header_bytes)?,
            header.kdf.argon2id()?,
        )?;
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

    let key = backend.derive_key(
        passphrase,
        &header_salt(&header_bytes)?,
        header.kdf.argon2id()?,
    )?;
    let base_nonce = header_nonce(&header_bytes)?;
    let stats = read_chunks(
        backend,
        header.algorithm,
        &key,
        &header_bytes,
        &base_nonce,
        &mut reader,
        &mut writer,
        VERSION_STREAMING,
    )?;

    writer.flush()?;
    Ok((header, stats))
}

/// Read the chunk stream shared by versions 2 and 3.
#[allow(clippy::too_many_arguments)]
fn read_chunks<R: Read, W: Write>(
    backend: &dyn CryptoBackend,
    algorithm: AeadAlgorithm,
    key: &[u8; 32],
    header: &[u8],
    base_nonce: &[u8; NONCE_LEN],
    mut reader: &mut R,
    writer: &mut W,
    version: u8,
) -> Result<StreamStats> {
    let mut stats = StreamStats::new(version);
    stats.container_bytes = header.len() as u64;
    let mut index = 0u64;

    loop {
        let mut flags_byte = [0u8; 1];
        match reader.read_exact(&mut flags_byte) {
            Ok(()) => {}
            Err(err) if err.kind() == ErrorKind::UnexpectedEof => {
                return Err(GimletEyeError::InvalidArgs(format!(
                    "container is truncated after {} chunk(s)",
                    stats.chunks
                )))
            }
            Err(err) => return Err(err.into()),
        }
        let flags = flags_byte[0];
        if flags & !FLAG_FINAL != 0 {
            return Err(GimletEyeError::InvalidArgs(format!(
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
            return Err(GimletEyeError::InvalidArgs(format!(
                "container chunk {} declares an impossible length {length}",
                stats.chunks
            )));
        }

        let mut ciphertext = vec![0u8; length];
        read_exact_or(&mut reader, &mut ciphertext, "container chunk is truncated")?;

        let nonce = chunk_nonce(base_nonce, index);
        let aad = chunk_aad(header, index, flags);
        let plaintext = backend.aead_decrypt(algorithm, key, &nonce, &ciphertext, &aad)?;
        writer.write_all(&plaintext)?;

        stats.chunks += 1;
        stats.plaintext_bytes += plaintext.len() as u64;
        stats.container_bytes += 1 + 4 + length as u64;

        if flags == FLAG_FINAL {
            let mut trailing = [0u8; 1];
            if reader.read(&mut trailing)? != 0 {
                return Err(GimletEyeError::InvalidArgs(
                    "container has data after its final chunk".into(),
                ));
            }
            break;
        }
        index += 1;
    }

    Ok(stats)
}

/// Read only the header, so inspecting a large container stays cheap.
pub fn inspect_stream<R: Read>(reader: &mut R) -> Result<ContainerHeader> {
    let mut prefix = [0u8; RECIPIENT_PREFIX_LEN];
    read_exact_or(reader, &mut prefix, "container header is truncated")?;

    if prefix[4] == VERSION_RECIPIENT {
        let count = recipient_count(&prefix)?;
        let mut rest = vec![0u8; count * RECIPIENT_ENTRY_LEN + NONCE_LEN];
        read_exact_or(reader, &mut rest, "container header is truncated")?;
        let mut header = Vec::with_capacity(RECIPIENT_PREFIX_LEN + rest.len());
        header.extend_from_slice(&prefix);
        header.extend_from_slice(&rest);
        return parse_recipient_header(&header);
    }

    let mut header_bytes = [0u8; HEADER_LEN];
    header_bytes[..RECIPIENT_PREFIX_LEN].copy_from_slice(&prefix);
    read_exact_or(
        reader,
        &mut header_bytes[RECIPIENT_PREFIX_LEN..],
        "container header is truncated",
    )?;
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
fn chunk_aad(header: &[u8], index: u64, flags: u8) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header.len() + 9);
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
            GimletEyeError::InvalidArgs(message.into())
        } else {
            GimletEyeError::from(err)
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

    fn recipient_pair(seed: u8) -> crate::keys::X25519KeyPair {
        let secret = [seed; 32];
        crate::keys::X25519KeyPair {
            secret,
            public: NativeBackend.x25519_public(&secret),
        }
    }

    #[test]
    fn recipient_containers_round_trip_for_every_listed_key() {
        for algorithm in [AeadAlgorithm::Aes256Gcm, AeadAlgorithm::ChaCha20Poly1305] {
            let alice = recipient_pair(7);
            let bob = recipient_pair(9);

            let mut sealed = Vec::new();
            let stats = seal_for_recipients(
                &NativeBackend,
                algorithm,
                &[alice.public, bob.public],
                &b"for two people"[..],
                &mut sealed,
            )
            .expect("seal");
            assert_eq!(stats.version, VERSION_RECIPIENT);
            assert_eq!(stats.plaintext_bytes, 14);

            for pair in [alice, bob] {
                let mut plaintext = Vec::new();
                let (header, _) =
                    open_for_recipient(&NativeBackend, &pair.secret, &sealed[..], &mut plaintext)
                        .expect("open");
                assert_eq!(plaintext, b"for two people");
                assert_eq!(header.version, VERSION_RECIPIENT);
                assert_eq!(header.algorithm, algorithm);
                assert_eq!(header.recipients.len(), 2);
            }

            let header = inspect(&sealed).expect("inspect");
            assert_eq!(header.version, VERSION_RECIPIENT);
            assert_eq!(header.recipients.len(), 2);
            assert_eq!(header.ephemeral_hex.len(), 64);
            assert!(matches!(header.kdf, Kdf::X25519HkdfSha256));
        }
    }

    #[test]
    fn a_key_that_is_not_listed_is_told_so() {
        let alice = recipient_pair(7);
        let stranger = recipient_pair(11);
        let mut sealed = Vec::new();
        seal_for_recipients(
            &NativeBackend,
            AeadAlgorithm::ChaCha20Poly1305,
            &[alice.public],
            &b"secret"[..],
            &mut sealed,
        )
        .expect("seal");

        let error = open_for_recipient(
            &NativeBackend,
            &stranger.secret,
            &sealed[..],
            std::io::sink(),
        )
        .expect_err("not a recipient");
        assert!(
            error.to_string().contains("not encrypted for that key"),
            "unhelpful error: {error}"
        );
    }

    #[test]
    fn a_moved_or_edited_recipient_block_breaks_the_file() {
        let alice = recipient_pair(7);
        let bob = recipient_pair(9);
        let mut sealed = Vec::new();
        seal_for_recipients(
            &NativeBackend,
            AeadAlgorithm::ChaCha20Poly1305,
            &[alice.public, bob.public],
            &b"secret"[..],
            &mut sealed,
        )
        .expect("seal");

        // Claim Alice's entry belongs to Bob by swapping the public keys.
        let first = RECIPIENT_PREFIX_LEN;
        let second = RECIPIENT_PREFIX_LEN + RECIPIENT_ENTRY_LEN;
        for offset in 0..32 {
            sealed.swap(first + offset, second + offset);
        }
        assert!(
            open_for_recipient(&NativeBackend, &bob.secret, &sealed[..], std::io::sink()).is_err(),
            "a swapped recipient block must not open"
        );

        // And claiming a different cipher in the prefix fails too.
        let mut tampered = sealed.clone();
        tampered[5] = 1;
        assert!(open_for_recipient(
            &NativeBackend,
            &alice.secret,
            &tampered[..],
            std::io::sink()
        )
        .is_err());
    }

    #[test]
    fn passphrase_containers_refuse_to_be_opened_with_a_key_and_vice_versa() {
        let sealed = seal(
            &NativeBackend,
            b"hunter2",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            b"payload",
        )
        .expect("seal");

        let alice = recipient_pair(7);
        assert!(
            open_for_recipient(&NativeBackend, &alice.secret, &sealed[..], std::io::sink())
                .is_err(),
            "a v1 file is not a recipient container"
        );

        let mut recipient_file = Vec::new();
        seal_for_recipients(
            &NativeBackend,
            AeadAlgorithm::ChaCha20Poly1305,
            &[alice.public],
            &b"payload"[..],
            &mut recipient_file,
        )
        .expect("seal");
        let error = open_stream(
            &NativeBackend,
            b"hunter2",
            &recipient_file[..],
            std::io::sink(),
        )
        .expect_err("v3 has no passphrase");
        assert!(
            error.to_string().contains("encrypted for keys"),
            "unhelpful error: {error}"
        );
    }

    #[test]
    fn an_empty_or_duplicated_recipient_list_is_refused() {
        let alice = recipient_pair(7);
        assert_eq!(
            seal_for_recipients(
                &NativeBackend,
                AeadAlgorithm::ChaCha20Poly1305,
                &[],
                &b""[..],
                Vec::new()
            )
            .expect_err("no recipients")
            .code(),
            "invalid_args"
        );
        assert_eq!(
            seal_for_recipients(
                &NativeBackend,
                AeadAlgorithm::ChaCha20Poly1305,
                &[alice.public, alice.public],
                &b""[..],
                Vec::new()
            )
            .expect_err("duplicate recipient")
            .code(),
            "invalid_args"
        );
    }

    #[test]
    fn a_hostile_recipient_count_is_refused_before_allocating() {
        let mut header = vec![0u8; RECIPIENT_PREFIX_LEN];
        header[0..4].copy_from_slice(&MAGIC);
        header[4] = VERSION_RECIPIENT;
        header[5] = AeadAlgorithm::ChaCha20Poly1305.to_wire();
        header[6] = KDF_X25519_HKDF;
        header[40..44].copy_from_slice(&(u32::MAX).to_le_bytes());

        let error = inspect(&header).expect_err("impossible count");
        assert_eq!(error.code(), "invalid_args");
        assert!(error.to_string().contains("limit"), "{error}");
    }

    #[test]
    fn no_header_input_panics_a_reader() {
        // Headers are attacker-controlled and parsed before any key exists, so
        // every truncation and every single-bit flip has to be an error rather
        // than a panic, an over-allocation, or a silent success.
        let alice = recipient_pair(7);
        let mut sealed = Vec::new();
        seal_for_recipients(
            &NativeBackend,
            AeadAlgorithm::ChaCha20Poly1305,
            &[alice.public],
            &b"payload"[..],
            &mut sealed,
        )
        .expect("seal");

        for cut in 0..sealed.len() {
            let prefix = &sealed[..cut];
            let _ = inspect(prefix);
            let _ = open_for_recipient(&NativeBackend, &alice.secret, prefix, std::io::sink());
            let _ = open_stream(&NativeBackend, b"pass", prefix, std::io::sink());
            let _ = inspect_stream(&mut &prefix[..]);
        }

        for index in 0..sealed.len().min(64) {
            for bit in 0..8 {
                let mut mutated = sealed.clone();
                mutated[index] ^= 1 << bit;
                let _ = inspect(&mutated);
                let _ = open_for_recipient(
                    &NativeBackend,
                    &alice.secret,
                    &mutated[..],
                    std::io::sink(),
                );
                let _ = open_stream(&NativeBackend, b"pass", &mutated[..], std::io::sink());
            }
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
    fn open_accepts_a_chunked_container() {
        let data: Vec<u8> = (0..(CHUNK_SIZE + 7))
            .map(|index| (index % 253) as u8)
            .collect();
        let sealed = seal_to_vec(&NativeBackend, &data, AeadAlgorithm::ChaCha20Poly1305);
        assert_eq!(sealed[4], VERSION_STREAMING);

        let opened = open(&NativeBackend, b"hunter2", &sealed).expect("open v2");
        assert_eq!(opened.as_slice(), data.as_slice());
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
