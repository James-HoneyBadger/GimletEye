/**
 * Password generation with an entropy budget.
 *
 * Two properties are why this is not `Math.random()` in a loop: the index into
 * the alphabet is drawn without modulo bias, and one character from each class
 * is guaranteed before the fill, then shuffled so the guaranteed characters do
 * not sit in fixed positions.
 */

import { randomBytes } from 'node:crypto';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const AMBIGUOUS = 'Il1O0o';

export interface PassgenOptions {
  length?: number;
  count?: number;
  symbols?: boolean;
  noAmbiguous?: boolean;
  /** Injectable so a test can pin the sequence; defaults to the OS CSPRNG. */
  random?: (bytes: number) => Buffer;
}

export interface PassgenResult {
  passwords: string[];
  length: number;
  alphabet_size: number;
  entropy_bits: number;
  /** True when the budget is below the 60-bit guidance for a stored secret. */
  low_entropy: boolean;
}

export function alphabet(symbols: boolean, noAmbiguous: boolean): string {
  let pool = LOWER + UPPER + DIGITS + (symbols ? SYMBOLS : '');
  if (noAmbiguous) pool = [...pool].filter((char) => !AMBIGUOUS.includes(char)).join('');
  return pool;
}

export function entropyBits(length: number, alphabetSize: number): number {
  return Math.round(length * Math.log2(alphabetSize) * 10) / 10;
}

export function generatePasswords(options: PassgenOptions = {}): PassgenResult {
  const length = options.length ?? 24;
  const count = options.count ?? 1;
  const symbols = options.symbols ?? true;
  const noAmbiguous = options.noAmbiguous ?? false;
  const random = options.random ?? ((bytes: number) => randomBytes(bytes));

  if (!Number.isInteger(length) || length < 8 || length > 256) {
    throw new Error('length must be between 8 and 256');
  }
  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new Error('count must be between 1 and 256');
  }

  const pool = alphabet(symbols, noAmbiguous);
  const size = [...pool].length;
  const bits = entropyBits(length, size);

  const passwords: string[] = [];
  for (let index = 0; index < count; index += 1) {
    passwords.push(generateOne(length, symbols, noAmbiguous, pool, random));
  }

  return {
    passwords,
    length,
    alphabet_size: size,
    entropy_bits: bits,
    low_entropy: bits < 60,
  };
}

function generateOne(
  length: number,
  symbols: boolean,
  noAmbiguous: boolean,
  pool: string,
  random: (bytes: number) => Buffer,
): string {
  const index = (bound: number): number => unbiasedIndex(bound, random);
  const pick = (chars: string): string => chars[index([...chars].length)] ?? '?';

  const required: string[] = [];
  for (const classChars of [LOWER, UPPER, DIGITS]) {
    const filtered = [...classChars].filter((char) => !noAmbiguous || !AMBIGUOUS.includes(char)).join('');
    if (filtered !== '') required.push(pick(filtered));
  }
  if (symbols && length > required.length) required.push(pick(SYMBOLS));

  const alphabetChars = [...pool];
  const password = [...required];
  while (password.length < length) password.push(pick(pool));

  // Fisher–Yates, so the guaranteed classes are not in fixed positions.
  for (let position = password.length - 1; position >= 1; position -= 1) {
    const swap = index(position + 1);
    const current = password[position] as string;
    password[position] = password[swap] as string;
    password[swap] = current;
  }

  return password.join('');
}

/** Reject the incomplete tail of the 64-bit range so every index is equally likely. */
function unbiasedIndex(bound: number, random: (bytes: number) => Buffer): number {
  if (bound <= 1) return 0;
  const limit = 2n ** 64n;
  const span = BigInt(bound);
  const ceiling = limit - (limit % span);
  for (;;) {
    const raw = random(8);
    if (raw.length < 8) throw new Error('the random source returned fewer than 8 bytes');
    const value = raw.readBigUInt64LE(0);
    if (value < ceiling) return Number(value % span);
  }
}
