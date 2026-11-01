import { describe, expect, it } from 'vitest';

import { describeArgs } from '../src/describe.js';
import type { ToolManifest } from '../src/manifest.js';

const tool = (args: ToolManifest['args']): ToolManifest => ({
  id: 'demo.tool',
  title: 'Demo',
  summary: 'demo',
  category: 'privacy',
  args,
});

describe('describeArgs', () => {
  it('offers a file picker for a file path', () => {
    expect(describeArgs(tool([{ name: 'input', type: 'path', help: 'File to inspect' }]))[0]).toMatchObject({
      picker: 'file',
      secret: false,
    });
  });

  it('offers a directory picker when the manifest names a folder or a root', () => {
    expect(describeArgs(tool([{ name: 'path', type: 'path', help: 'Root of the scan' }]))[0]?.picker).toBe('directory');
    expect(describeArgs(tool([{ name: 'dir', type: 'path', help: 'Directory to write the key files into' }]))[0]?.picker).toBe(
      'directory',
    );
    expect(describeArgs(tool([{ name: 'homedir', type: 'path', help: "GnuPG home directory" }]))[0]?.picker).toBe(
      'directory',
    );
  });

  it('offers both when the manifest accepts either', () => {
    expect(describeArgs(tool([{ name: 'input', type: 'path', help: 'File or directory to watch' }]))[0]?.picker).toBe(
      'either',
    );
  });

  it('does not offer a picker for a path that is not a filesystem path', () => {
    expect(describeArgs(tool([{ name: 'text', type: 'string' }]))[0]?.picker).toBeNull();
  });

  it('marks the arguments that carry a secret', () => {
    expect(describeArgs(tool([{ name: 'passphrase', type: 'string' }]))[0]?.secret).toBe(true);
    expect(describeArgs(tool([{ name: 'label', type: 'string' }]))[0]?.secret).toBe(false);
  });
});
