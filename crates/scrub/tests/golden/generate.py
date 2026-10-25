#!/usr/bin/env python3
"""Generate the golden fixtures.

Every byte here is synthesized: no third-party photograph, no camera output, no
licence to track. Run this only when a fixture genuinely needs to change, and
update expected.json in the same commit - the whole point of the corpus is that
the bytes and the expectations move together, deliberately.

    python3 generate.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).parent / "fixtures"

# A tiny but valid 1x1 baseline JPEG body, shared by the JPEG fixtures. Segment
# order matters: APP0 (structural-ish), APP1/EXIF (identity), COM (text).
JPEG_SCAN = bytes(
    [
        0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,  # SOF0 payload
    ]
)


def seg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def jpeg(segments: list[bytes]) -> bytes:
    body = (
        b"\xFF\xDA" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3F\x00"  # SOS header
        + b"\x00\x11\x22\x33"                                              # entropy-coded data
        + b"\xFF\xD9"                                                      # EOI
    )
    return b"\xFF\xD8" + b"".join(segments) + body


def tiff_with_gps() -> bytes:
    """A minimal TIFF/EXIF block holding an IFD0 pointer to a GPS IFD."""
    # Little-endian TIFF header.
    header = b"II*\x00" + struct.pack("<I", 8)
    # IFD0 with one entry: GPS IFD pointer (tag 0x8825, type LONG, count 1).
    ifd0 = struct.pack("<H", 1) + struct.pack("<HHII", 0x8825, 4, 1, 26) + struct.pack("<I", 0)
    # GPS IFD with one entry: GPSLatitudeRef (tag 1, ASCII, 2 bytes inline).
    gps = struct.pack("<H", 1) + struct.pack("<HHII", 1, 2, 2, 0x4E000000) + struct.pack("<I", 0)
    return header + ifd0 + gps


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def png(chunks: list[bytes]) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit truecolour
    idat = zlib.compress(b"\x00\x00\x00\x00")
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + b"".join(chunks) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def webp_chunk(kind: bytes, data: bytes) -> bytes:
    return kind + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) % 2 else b"")


def webp(chunks: list[bytes]) -> bytes:
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    exif = b"Exif\x00\x00" + tiff_with_gps()
    xmp = b'http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>'
    # A JPEG ICC profile segment is "ICC_PROFILE\0", chunk number, chunk count,
    # then the profile. Without that prefix it is just an unnamed APP2.
    icc = b"ICC_PROFILE\x00\x01\x01mellivora-test-profile"

    files = {
        # Identity, text, and a colour profile that must survive every profile.
        "photo-gps.jpg": jpeg([
            seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"),
            seg(0xE1, exif),
            seg(0xE2, icc),
            seg(0xFE, b"shot on a camera that should not be named"),
        ]),
        "photo-xmp.jpg": jpeg([
            seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"),
            seg(0xE1, xmp),
        ]),
        "shot-plain.jpg": jpeg([seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")]),
        "scan-text.png": png([
            png_chunk(b"tEXt", b"Author\x00Someone"),
            png_chunk(b"tIME", struct.pack(">HBBBBB", 2026, 10, 25, 18, 0, 0)),
            png_chunk(b"iCCP", b"profile\x00\x00" + zlib.compress(icc)),
        ]),
        "scan-clean.png": png([png_chunk(b"iCCP", b"profile\x00\x00" + zlib.compress(icc))]),
        "shot-extended.webp": webp([
            webp_chunk(b"VP8X", b"\x00\x00\x00\x00" + struct.pack("<I", 1) + struct.pack("<I", 1)),
            webp_chunk(b"EXIF", tiff_with_gps()),
            webp_chunk(b"XMP ", xmp),
        ]),
    }

    for name, data in files.items():
        (OUT / name).write_bytes(data)
        print(f"{name:24} {len(data):5} bytes")


if __name__ == "__main__":
    main()
