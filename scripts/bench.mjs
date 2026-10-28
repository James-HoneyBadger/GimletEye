#!/usr/bin/env node
/**
 * Time the operations that have to scale.
 *
 * The container reader, the metadata scrub, and hashing all stream: none of them
 * is allowed to hold a whole file, and none of them may go quadratic in its
 * size. A unit test can prove the first (the tests assert bounded reads); only a
 * clock notices the second, so this runs each one against a generated file and
 * refuses to pass under a floor.
 *
 *   node scripts/bench.mjs                  # 32 MiB, floors as below
 *   node scripts/bench.mjs --size 256 --json
 *
 * The floors are deliberately far below what this machine does (roughly 280
 * MiB/s hashing, 70 MiB/s encrypting), because CI is not this machine: they are
 * tripwires for an accidental n², not a performance target.
 */
import { randomBytes } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { NODE_TOOLS, Runtime } from '@gimlet-eye/core/node'
import { nodeHost } from '@gimlet-eye/core/host-node'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(root, 'packages/engine/test/fixtures/photo-exif-gps.jpg')

const FLOORS = {
    sha256_mib: Number(process.env.BENCH_MIN_SHA256_MIB ?? 25),
    encrypt_mib: Number(process.env.BENCH_MIN_ENCRYPT_MIB ?? 8),
    decrypt_mib: Number(process.env.BENCH_MIN_DECRYPT_MIB ?? 8),
    scan_ops: Number(process.env.BENCH_MIN_SCAN_OPS ?? 20),
    strip_ops: Number(process.env.BENCH_MIN_STRIP_OPS ?? 10),
}

function option(name, fallback) {
    const at = process.argv.indexOf(`--${name}`)
    const value = at < 0 ? undefined : process.argv[at + 1]
    if (value === undefined) return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} needs a positive number`)
    return parsed
}

const sizeMib = option('size', 32)
const json = process.argv.includes('--json')

async function writeBlob(file, mib) {
    const handle = await open(file, 'w')
    try {
        for (let written = 0; written < mib * 1024 * 1024; written += 1024 * 1024) {
            await handle.write(randomBytes(1024 * 1024))
        }
    } finally {
        await handle.close()
    }
}

async function measure(runtime, tool, args) {
    const started = performance.now()
    const { report } = await runtime.run(tool, args)
    if (report.status === 'error') {
        const first = report.findings?.[0]?.message ?? 'no finding'
        throw new Error(`${tool} failed: ${first}`)
    }
    return performance.now() - started
}

const work = await mkdtemp(path.join(tmpdir(), 'gimlet-bench-'))
const runtime = await Runtime.load(nodeHost(), { home: path.join(work, 'home'), localTools: NODE_TOOLS })

try {
    const blob = path.join(work, 'blob')
    const container = path.join(work, 'blob.gimlet')
    const restored = path.join(work, 'restored')
    const stripped = path.join(work, 'stripped.jpg')
    const passphrase = { passphrase_env: 'GIMLET_BENCH_PASSPHRASE' }
    process.env.GIMLET_BENCH_PASSPHRASE = 'bench-passphrase'

    await writeBlob(blob, sizeMib)
    const mib = sizeMib

    // One warm run each, so the clocks measure work rather than the first JIT.
    await measure(runtime, 'crypto.sha256', { path: blob })

    const results = []
    const record = (name, amount, unit, ms, floor) => {
        const rate = amount / (ms / 1000)
        results.push({ name, amount, unit, ms: Math.round(ms), rate: Math.round(rate * 10) / 10, floor, ok: rate >= floor })
    }

    record('crypto.sha256', mib, 'MiB/s', await measure(runtime, 'crypto.sha256', { path: blob }), FLOORS.sha256_mib)
    record('crypto.encrypt', mib, 'MiB/s', await measure(runtime, 'crypto.encrypt', { input: blob, output: container, ...passphrase }), FLOORS.encrypt_mib)
    record('crypto.decrypt', mib, 'MiB/s', await measure(runtime, 'crypto.decrypt', { input: container, output: restored, ...passphrase }), FLOORS.decrypt_mib)

    const iterations = option('iterations', 25)
    const loop = async (tool, args) => {
        const started = performance.now()
        for (let run = 0; run < iterations; run += 1) await measure(runtime, tool, args)
        return performance.now() - started
    }
    record('privacy.metadata-scan', iterations, 'op/s', await loop('privacy.metadata-scan', { input: fixture }), FLOORS.scan_ops)
    record('privacy.metadata-strip', iterations, 'op/s', await loop('privacy.metadata-strip', { input: fixture, output: stripped, profile: 'privacy', overwrite: true }), FLOORS.strip_ops)

    const ok = results.every((result) => result.ok)
    if (json) {
        console.log(JSON.stringify({ size_mib: mib, iterations, ok, results }, null, 2))
    } else {
        for (const result of results) {
            const verdict = result.ok ? 'ok' : 'BELOW FLOOR'
            console.log(
                `${result.name.padEnd(24)} ${String(result.amount).padStart(4)} ${result.unit.padEnd(5)} ` +
                    `${String(result.rate).padStart(8)} ${verdict.padEnd(11)} floor ${result.floor}`,
            )
        }
        console.log(ok ? '\nevery operation is above its floor' : '\nsomething is below its floor')
    }
    process.exitCode = ok ? 0 : 1
} finally {
    runtime.close()
    await rm(work, { recursive: true, force: true })
}
