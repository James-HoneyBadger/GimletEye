import { afterEach, describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { auditPassword, hasSequence, passAudit } from '../src/tools/pass-audit.js';
import { fakeHost } from './fake-host.js';

const ctxFor = () => ({ host: fakeHost(), config: defaultConfig(), dryRun: false, paths: {} as never });

afterEach(() => {
  delete process.env.GIMLET_TEST_PASSWORD;
});

describe('password audit', () => {
  it('recognises a run of four steps but not a scattered alphabet', () => {
    expect(hasSequence('abcd')).toBe(true);
    expect(hasSequence('wxyz')).toBe(true);
    expect(hasSequence('dcba')).toBe(true);
    expect(hasSequence('1234')).toBe(true);
    expect(hasSequence('abce')).toBe(false);
    expect(hasSequence('a1b2c3')).toBe(false);
  });

  it('scores a common password at the bottom and says why', () => {
    const audit = auditPassword('password');
    expect(audit.score).toBe(0);
    expect(audit.issues).toContain('a common password');
    expect(audit.issues).toContain('shorter than 12 characters');
    expect(audit.issues).toContain('a single character class');
    expect(audit.entropy_bits).toBeCloseTo(37.6, 1);
  });

  it('scores a long mixed password at the top with nothing to say', () => {
    const audit = auditPassword('Tr0ub4dor&3xKp9z');
    expect(audit.score).toBe(4);
    expect(audit.issues).toEqual([]);
    expect(audit.classes).toEqual({ lowercase: true, uppercase: true, digit: true, symbol: true });
  });

  it('counts a year suffix and a repeat against the score', () => {
    const audit = auditPassword('S3cure-Passw0rd-2024');
    expect(audit.issues).toContain('ends with a year');
    expect(audit.score).toBeLessThan(4);
    expect(auditPassword('aaaaaaaaaaaaA1!').issues).toContain('repeated characters');
  });

  it('reports the measurements and never the password', async () => {
    process.env.GIMLET_TEST_PASSWORD = 'letmein';
    const report = await passAudit.run(ctxFor(), { password_env: 'GIMLET_TEST_PASSWORD' });
    expect(report.status).toBe('error');
    expect(report.findings?.map((finding) => finding.code)).toEqual(['password.weak']);
    expect(report.summary).toContain('score 0 of 4');
    expect(JSON.stringify(report)).not.toContain('letmein');
  });

  it('refuses a variable that is unset or empty', async () => {
    await expect(passAudit.run(ctxFor(), { password_env: 'GIMLET_TEST_PASSWORD' })).rejects.toThrow(/not set or is empty/);
    await expect(passAudit.run(ctxFor(), {})).rejects.toThrow(/password is required/);
  });

  it('accepts an inline password when asked, and flags a middling one', async () => {
    const report = await passAudit.run(ctxFor(), { password: 'Summer2024!' });
    expect(report.status).toBe('warning');
    expect(report.findings?.map((finding) => finding.code)).toEqual(['password.fair']);
  });
});
