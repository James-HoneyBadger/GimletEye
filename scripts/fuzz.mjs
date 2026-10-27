#!/usr/bin/env node
/**
 * The TypeScript fuzz targets.
 *
 * The Rust targets found the bugs that matter here — a JPEG whose APP1 length
 * lies, coordinate tags pointing into each other, a container header claiming
 * more recipients than it has bytes. ADR 0010 retired them with the Rust and
 * admitted the loss; this is the replacement, because "the corpus is replayed"
 * is a regression test, not a soak.
 *
 * What counts as a failure is deliberately narrow:
 *
 *   clean rejection   a `ContainerError`, or any `Error` with a message. The
 *                     parsers are *supposed* to refuse most of this input.
 *   crash             anything else: a `TypeError` or `RangeError` out of a
 *                     bounds bug, a non-Error throw, or an input that throws
 *                     something the caller cannot describe.
 *
 * A hang cannot be caught in-process, so every parser keeps its own bounds and a
 * target that stops making progress is caught by the soak script's timeout.
 *
 * Usage: node scripts/fuzz.mjs --target jpeg --minutes 10 [--seed 1]
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = join(root, 'packages/engine/test/fixtures/corpus');

const engine = await import(join(root, 'packages/engine/dist/index.js'));

/** Deterministic PRNG, so a run is reproducible from its seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function args() {
  const out = { target: '', minutes: 10, seed: 1 };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--target') out.target = value ?? '';
    else if (key === '--minutes') out.minutes = Number(value);
    else if (key === '--seed') out.seed = Number(value);
  }
  return out;
}

/**
 * Seeds for a target: the saved fuzz corpus for containers, and the image
 * fixtures for the parsers. A target fed the wrong corpus spends its budget
 * being rejected at the first byte.
 */
function seedsFor(target) {
  if (target === 'container') {
    return readdirSync(join(corpus, 'container')).map((name) => readFileSync(join(corpus, 'container', name)));
  }
  const wanted = target === 'exif' || target === 'gps' ? ['exif', 'jpeg'] : [target];
  return readdirSync(join(corpus, 'scrub'))
    .filter((name) => wanted.some((prefix) => name.startsWith(prefix)))
    .map((name) => readFileSync(join(corpus, 'scrub', name)));
}

/**
 * Mutate in place: flip bytes, splice a chunk out, duplicate a run, or set a
 * length field to something absurd. Biased towards the headers, because that is
 * where the parsing decisions are.
 */
function mutate(bytes, random) {
  const out = Buffer.from(bytes);
  // A seed can be a single byte: the corpus is whatever the old targets saved.
  if (out.length < 8) return Buffer.concat([out, Buffer.from([Math.floor(random() * 256)])]);
  const rounds = 1 + Math.floor(random() * 4);
  for (let round = 0; round < rounds; round += 1) {
    const choice = random();
    const near = (limit) => Math.floor(random() * Math.min(limit, out.length));
    if (choice < 0.35) {
      out[near(out.length)] = Math.floor(random() * 256);
    } else if (choice < 0.55) {
      const at = near(Math.max(1, out.length - 4));
      out.writeUInt32LE(Math.floor(random() * 0xffffffff), Math.min(at, Math.max(0, out.length - 4)));
    } else if (choice < 0.7) {
      const at = near(out.length);
      out[at] = [0x00, 0xff, 0x7f, 0x80][Math.floor(random() * 4)];
    } else if (choice < 0.85 && out.length > 8) {
      const cut = near(out.length);
      return Buffer.concat([out.subarray(0, cut), out.subarray(Math.min(out.length, cut + 1 + Math.floor(random() * 16)))]);
    } else {
      const at = near(out.length);
      const run = out.subarray(at, Math.min(out.length, at + 1 + Math.floor(random() * 8)));
      return Buffer.concat([out.subarray(0, at), run, run, out.subarray(at)]);
    }
  }
  return out;
}

/** A container this build wrote, with the cheapest KDF the format allows. */
function freshContainer() {
  return engine.sealWithPassphrase(Buffer.from('fuzz seed\n'), 'fuzz-passphrase', {
    memoryKib: 8,
    timeCost: 1,
    lanes: 1,
  });
}

function targets() {
  return {
    jpeg: (input) => engine.scan(input),
    png: (input) => engine.scan(input),
    webp: (input) => engine.scan(input),
    exif: (input) => {
      // The scrubber is called whatever the bytes claim to be; it decides.
      const result = engine.scan(input);
      engine.strip(input, engine.policyAll());
      return result;
    },
    gps: (input) => {
      const copy = Buffer.from(input);
      return engine.redactGps(copy, 'city');
    },
    container: (input) => {
      const header = engine.inspect(input);
      if (header.version === 3) engine.openWithRecipient(input, Buffer.alloc(32, 3));
      else engine.openWithPassphrase(input, 'fuzz-passphrase');
      return header;
    },
  };
}

function classify(error) {
  if (!(error instanceof Error)) return 'non-error throw';
  if (error instanceof RangeError) return 'RangeError (a bounds check is missing)';
  if (error instanceof TypeError) return 'TypeError (a shape check is missing)';
  if (error instanceof engine.ContainerError) return null;
  // A plain Error with a message is how the parsers refuse malformed input.
  return error.message === '' ? 'empty error' : null;
}

const { target, minutes, seed } = args();
const table = targets();
if (table[target] === undefined) {
  console.error(`fuzz: unknown target '${target}'. One of: ${Object.keys(table).join(', ')}`);
  process.exit(2);
}

const seeds = seedsFor(target);
if (target === 'container' || target === 'gps') seeds.push(freshContainer());

const random = mulberry32(seed * 2654435761);
const deadline = Date.now() + minutes * 60_000;
const crashes = [];
let iterations = 0;
let parsed = 0;

while (Date.now() < deadline) {
  const seedBytes = seeds[Math.floor(random() * seeds.length)];
  const input = mutate(seedBytes, random);
  iterations += 1;
  try {
    if (table[target](input) !== undefined) parsed += 1;
  } catch (error) {
    const kind = classify(error);
    if (kind !== null) {
      crashes.push({ kind, message: error instanceof Error ? error.message : String(error), input: input.toString('hex').slice(0, 400) });
      const dir = join(root, 'fuzz', 'crashes');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${target}-${Date.now()}-${crashes.length}.bin`);
      writeFileSync(path, input);
      if (crashes.length >= 5) break;
    }
  }
}

const result = {
  target,
  seed,
  minutes,
  iterations,
  parsed,
  crashes: crashes.length,
  details: crashes.slice(0, 5),
};
console.log(JSON.stringify(result));

// A crash is a finding: the soak records the run and reports it as failed.
process.exitCode = crashes.length === 0 ? 0 : 1;
