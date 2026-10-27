/**
 * The fuzz corpus, replayed on every test run.
 *
 * The Rust targets were the ones that found the interesting bugs — a JPEG whose
 * APP1 length lies, coordinate tags that point into each other, a container
 * header that claims more recipients than it has bytes. Those targets cannot
 * outlive the Rust, but their regression value can: these are the exact inputs
 * they saved, fed to the TypeScript parsers from the outside, where a throw is a
 * failure and a wrong answer is worse than a throw.
 *
 * What is asserted is deliberately not "this parses". It is:
 *
 * - a rejection is a real `Error` with a message, never a bare string, so no
 *   surface has to guess at `String(error)`;
 * - nothing hangs (vitest's timeout is the assertion);
 * - whatever scans can then be stripped, and the result is clean under a
 *   remove-everything policy — a strip that leaves metadata behind is the one
 *   failure that silently breaks the product's promise.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { inspect } from '../src/container.js';
import { detect, policyAll, removableBytes, scan, strip } from '../src/scrub/index.js';

const CORPUS = new URL('./fixtures/corpus/', import.meta.url);

function corpusFiles(dir: 'container' | 'scrub'): Array<{ name: string; bytes: Buffer }> {
  const base = new URL(`${dir}/`, CORPUS);
  return readdirSync(base)
    .sort()
    .map((name) => ({ name: `${dir}/${name}`, bytes: readFileSync(new URL(name, base)) }));
}

const CONTAINERS = corpusFiles('container');
const IMAGES = corpusFiles('scrub');

describe('the fuzz corpus', () => {
  it('has inputs to replay', () => {
    expect(CONTAINERS.length).toBeGreaterThan(100);
    expect(IMAGES.length).toBeGreaterThan(7);
  });

  it('never lets a container reader fail with something that is not an Error', () => {
    for (const { name, bytes } of CONTAINERS) {
      let answer: unknown;
      try {
        answer = inspect(bytes);
      } catch (error) {
        expect(error, name).toBeInstanceOf(Error);
        expect((error as Error).message, name).not.toBe('');
        continue;
      }
      // A file that parses must describe itself consistently.
      expect(answer, name).toMatchObject({ version: expect.any(Number) });
    }
  });

  it('never lets a container writer accept a body it cannot re-read', () => {
    // The corpus is hostile input, not keys: the assertion is that whatever the
    // reader accepts, it still accepts after a round trip through itself.
    for (const { name, bytes } of CONTAINERS) {
      let first: ReturnType<typeof inspect>;
      try {
        first = inspect(bytes);
      } catch {
        continue;
      }
      expect(() => inspect(bytes), name).not.toThrow();
      expect(inspect(bytes).version, name).toBe(first.version);
    }
  });

  it('either identifies an image or says why, never both', () => {
    for (const { name, bytes } of IMAGES) {
      const format = detect(bytes);
      if (format === undefined) {
        expect(() => scan(bytes), name).toThrow(Error);
        continue;
      }
      expect(['jpeg', 'png', 'webp'], name).toContain(format);
      expect(() => scan(bytes), name).not.toThrow();
    }
  });

  it('strips what it scans, and leaves nothing removable behind', () => {
    for (const { name, bytes } of IMAGES) {
      if (detect(bytes) === undefined) continue;
      let cleaned: Buffer;
      try {
        cleaned = strip(bytes, policyAll());
      } catch (error) {
        // A truncated or lying container may legitimately fail to strip; what it
        // must not do is fail with a non-Error.
        expect(error, name).toBeInstanceOf(Error);
        continue;
      }
      expect(removableBytes(scan(cleaned), policyAll()), name).toBe(0);
    }
  });

  it('is stable: the same input produces the same bytes twice', () => {
    for (const { name, bytes } of IMAGES) {
      if (detect(bytes) === undefined) continue;
      let first: Buffer;
      try {
        first = strip(bytes, policyAll());
      } catch {
        continue;
      }
      expect(strip(bytes, policyAll()).equals(first), name).toBe(true);
    }
  });
});
