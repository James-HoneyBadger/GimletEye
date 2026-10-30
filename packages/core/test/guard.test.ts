/**
 * "Do not write over your own input" is a guard, not advice.
 *
 * It has to be right in the two directions that matter: a symlink or a `..`
 * detour names the same file, and a permission error while resolving a path is
 * not evidence that the paths differ. The second is the one that used to fail
 * open, and a container decrypted onto itself is gone.
 */

import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { pathsUnder } from '../src/paths.js';
import { samePath } from '../src/tools/guard.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const ctxFor = (host: FakeHost) => ({
  host,
  config: defaultConfig(),
  dryRun: false,
  paths: pathsUnder('/tmp/home'),
});

describe('the same-file guard', () => {
  it('sees through a symlink', async () => {
    const host = fakeHost();
    host.resolve = async (path) => (path === '/photos/link.jpg' ? '/photos/real.jpg' : path);

    expect(await samePath(ctxFor(host), '/photos/link.jpg', '/photos/real.jpg')).toBe(true);
  });

  it('reads a destination that does not exist as a different file', async () => {
    const host = fakeHost();
    host.resolve = async (path) => {
      if (path === '/photos/missing.jpg') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return path;
    };

    expect(await samePath(ctxFor(host), '/photos/a.jpg', '/photos/missing.jpg')).toBe(false);
  });

  it('does not read a permission error as a different file', async () => {
    const host = fakeHost();
    host.resolve = async (path) => {
      if (path === '/photos/forbidden.jpg') throw Object.assign(new Error('EACCES: forbidden'), { code: 'EACCES' });
      return path;
    };

    await expect(samePath(ctxFor(host), '/photos/a.jpg', '/photos/forbidden.jpg')).rejects.toThrow(/EACCES/);
  });
});
