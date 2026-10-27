/**
 * Raw terminal input, turned into intents.
 *
 * A terminal hands over escape sequences, not keys: an arrow is `ESC [ A`, and
 * a read can split one in half. The decoder keeps a remainder so a sequence
 * split across reads still arrives as one arrow.
 */

export type KeyIntent =
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'pageUp' }
  | { kind: 'pageDown' }
  | { kind: 'enter' }
  | { kind: 'escape' }
  | { kind: 'backspace' }
  | { kind: 'interrupt' }
  | { kind: 'char'; value: string }
  | { kind: 'other' };

const ESC = '\u001b';
const SEQUENCES: Readonly<Record<string, KeyIntent>> = {
  [`${ESC}[A`]: { kind: 'up' },
  [`${ESC}OA`]: { kind: 'up' },
  [`${ESC}[B`]: { kind: 'down' },
  [`${ESC}OB`]: { kind: 'down' },
  [`${ESC}[5~`]: { kind: 'pageUp' },
  [`${ESC}[6~`]: { kind: 'pageDown' },
};

export interface Decoded {
  intents: KeyIntent[];
  /** An incomplete escape sequence, to be prefixed to the next read. */
  remainder: string;
}

export function decodeKeys(chunk: string, carry = ''): Decoded {
  const input = carry + chunk;
  const intents: KeyIntent[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index] ?? '';

    if (char === ESC) {
      const matched = longestSequence(input.slice(index));
      if (matched !== undefined) {
        intents.push(SEQUENCES[matched] as KeyIntent);
        index += matched.length;
        continue;
      }
      // A lone ESC is the Escape key; anything longer that we do not know is a
      // sequence we can safely ignore rather than typing garbage into a filter.
      if (input.length - index === 1) {
        intents.push({ kind: 'escape' });
        return { intents, remainder: '' };
      }
      const endsEarly = looksIncomplete(input.slice(index));
      if (endsEarly) return { intents, remainder: input.slice(index) };
      intents.push({ kind: 'other' });
      index += escapeLength(input.slice(index));
      continue;
    }

    if (char === '\r' || char === '\n') {
      intents.push({ kind: 'enter' });
      index += 1;
      continue;
    }
    if (char === '\u007f' || char === '\b') {
      intents.push({ kind: 'backspace' });
      index += 1;
      continue;
    }
    if (char === '\u0003') {
      intents.push({ kind: 'interrupt' });
      index += 1;
      continue;
    }
    if (char >= ' ' && char !== '\u007f') {
      intents.push({ kind: 'char', value: char });
      index += 1;
      continue;
    }
    intents.push({ kind: 'other' });
    index += 1;
  }

  return { intents, remainder: '' };
}

function longestSequence(input: string): string | undefined {
  let best: string | undefined;
  for (const sequence of Object.keys(SEQUENCES)) {
    if (input.startsWith(sequence) && (best === undefined || sequence.length > best.length)) best = sequence;
  }
  return best;
}

/** A prefix of a known sequence is not a key on its own, yet. */
function looksIncomplete(input: string): boolean {
  return Object.keys(SEQUENCES).some((sequence) => sequence.startsWith(input) && sequence.length > input.length);
}

function escapeLength(input: string): number {
  const end = input.slice(1).search(/[A-Za-z~]/);
  return end < 0 ? input.length : end + 2;
}
