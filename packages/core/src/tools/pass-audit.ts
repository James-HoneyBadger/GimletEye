/**
 * The strength of an existing password, judged offline.
 *
 * Generation already exists (`crypto.passgen`); this is the other half: what is
 * wrong with the one somebody already uses. No wordlist download, no network, no
 * breach lookup, and the password itself never reaches the report — only the
 * measurements and the complaints.
 */

import { optString } from '../args.js';
import { invalidArgs } from '../errors.js';
import { sealed, type Finding, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

/** Lowercase only, because the comparison lowercases the candidate. */
export const COMMON_PASSWORDS = new Set([
  'password',
  'passw0rd',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'root',
  'toor',
  'monkey',
  'dragon',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'abc123',
  '111111',
  '000000',
  'trustno1',
  'master',
  'shadow',
  'superman',
  'batman',
  'starwars',
  'whatever',
  'freedom',
  'changeme',
  'secret',
  'default',
  'hunter2',
]);

const MIN_LENGTH = 12;

export interface PasswordAudit {
  length: number;
  entropy_bits: number;
  score: number;
  issues: string[];
  classes: { lowercase: boolean; uppercase: boolean; digit: boolean; symbol: boolean };
}

const MANIFEST: ToolManifest = {
  id: 'crypto.pass-audit',
  title: 'Password audit',
  summary: 'Offline strength and pattern audit of an existing password',
  category: 'crypto',
  capabilities: ['secrets'],
  args: [
    { name: 'password_env', type: 'string', help: 'Environment variable holding the password (preferred)' },
    { name: 'password', type: 'string', help: 'The password itself, when an environment variable is inconvenient' },
  ],
  data: {
    shape: 'object',
    required: {
      length: 'number',
      entropy_bits: 'number',
      score: 'number',
      issues: 'array',
      classes: 'object',
    },
  },
  tags: ['password', 'strength', 'audit'],
};

/** The alphabet a random password of this shape would have drawn from. */
function alphabetSize(classes: PasswordAudit['classes']): number {
  return (
    (classes.lowercase ? 26 : 0) +
    (classes.uppercase ? 26 : 0) +
    (classes.digit ? 10 : 0) +
    (classes.symbol ? 33 : 0)
  );
}

/** Four or more characters in a row, each one step from the last. */
export function hasSequence(value: string): boolean {
  let run = 1;
  let direction = 0;
  for (let index = 1; index < value.length; index += 1) {
    const delta = value.charCodeAt(index) - value.charCodeAt(index - 1);
    if (delta === 1 || delta === -1) {
      run = delta === direction ? run + 1 : 2;
      direction = delta;
      if (run >= 4) return true;
    } else {
      run = 1;
      direction = 0;
    }
  }
  return false;
}

export function auditPassword(password: string): PasswordAudit {
  const classes = {
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const alphabet = alphabetSize(classes);
  const entropy = password.length === 0 ? 0 : password.length * Math.log2(alphabet);
  const issues: string[] = [];

  if (password.length < MIN_LENGTH) issues.push(`shorter than ${MIN_LENGTH} characters`);
  if (COMMON_PASSWORDS.has(password.toLowerCase())) issues.push('a common password');
  if (/(.)\1{2,}/.test(password)) issues.push('repeated characters');
  if (hasSequence(password)) issues.push('sequential characters');
  if (/(19|20)\d{2}$/.test(password)) issues.push('ends with a year');
  if (!classes.uppercase && !classes.symbol && !classes.digit) issues.push('a single character class');

  const base = entropy >= 80 ? 4 : entropy >= 60 ? 3 : entropy >= 40 ? 2 : entropy >= 25 ? 1 : 0;
  const penalties =
    (issues.includes('a common password') ? 2 : 0) +
    (issues.includes(`shorter than ${MIN_LENGTH} characters`) ? 1 : 0) +
    (issues.includes('repeated characters') ? 1 : 0) +
    (issues.includes('sequential characters') ? 1 : 0) +
    (issues.includes('ends with a year') ? 1 : 0);

  return {
    length: password.length,
    entropy_bits: Math.round(entropy * 10) / 10,
    score: Math.max(0, base - penalties),
    issues,
    classes,
  };
}

/** The environment variable wins, so the password stays out of shell history. */
function passwordFrom(args: Args): string {
  const envVar = optString(args, 'password_env');
  if (envVar !== undefined) {
    const value = process.env[envVar];
    if (value === undefined || value === '') {
      throw invalidArgs(`environment variable '${envVar}' is not set or is empty`);
    }
    return value;
  }
  const inline = optString(args, 'password');
  if (inline !== undefined) return inline;
  throw invalidArgs('a password is required: pass password_env (preferred) or password');
}

export const passAudit: LocalTool = {
  manifest: MANIFEST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const password = passwordFrom(args);
    const audit = auditPassword(password);

    const findings: Finding[] = [];
    if (audit.score <= 1) {
      findings.push({
        severity: 'high',
        code: 'password.weak',
        message: `score ${audit.score} of 4 at ${audit.entropy_bits} bits: ${audit.issues.join('; ') || 'no pattern found, only length'}`,
      });
    } else if (audit.score === 2) {
      findings.push({
        severity: 'medium',
        code: 'password.fair',
        message: `score 2 of 4 at ${audit.entropy_bits} bits: ${audit.issues.join('; ')}`,
      });
    }

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary: `score ${audit.score} of 4, ${audit.entropy_bits} bits, ${audit.issues.length} issue(s)`,
      findings,
      data: audit,
      duration_ms: Date.now() - started,
    });
  },
};
