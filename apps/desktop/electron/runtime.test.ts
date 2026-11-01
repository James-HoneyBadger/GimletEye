import { describe, expect, it } from 'vitest';

import { createRuntimeLoader } from './runtime.js';

const fake = { marker: 'runtime' } as never;

describe('the runtime loader', () => {
  it('loads once, however many callers ask', async () => {
    let calls = 0;
    const loader = createRuntimeLoader(async () => {
      calls += 1;
      return fake;
    });

    const [a, b] = await Promise.all([loader(), loader()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('tries again after a failure', async () => {
    let calls = 0;
    const loader = createRuntimeLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('configuration error: schema 99');
      return fake;
    });

    await expect(loader()).rejects.toThrow('schema 99');
    await expect(loader()).resolves.toBe(fake);
    expect(calls).toBe(2);
  });

  it('reports the same failure to everyone waiting on one attempt', async () => {
    const loader = createRuntimeLoader(async () => {
      throw new Error('broken');
    });
    const [first, second] = await Promise.allSettled([loader(), loader()]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
  });
});
