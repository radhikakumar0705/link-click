/**
 * Base62 encoding/decoding for short code generation.
 *
 * Strategy (per ADR-001): We use Postgres BIGSERIAL auto-increment IDs and
 * Base62-encode them. This is collision-free by construction, deterministically
 * reversible, and produces naturally ordered codes with no DB round-trips for
 * collision checking.
 *
 * Alphabet excludes visually ambiguous chars (0/O, 1/l/I are kept since we
 * render short codes in monospace contexts and copy-paste is the primary flow).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(ALPHABET.length); // 62n
const MIN_LENGTH = 6; // ~56 billion codes; extend to 7 at 80% capacity (see spec §7.2)

/**
 * Encode a positive integer (as bigint) to a Base62 string.
 * Always pads to MIN_LENGTH characters for consistent URL aesthetics.
 */
export function encode(id: bigint): string {
  if (id < 0n) throw new RangeError(`encode expects a non-negative id, got ${id}`);

  let result = '';
  let n = id;

  do {
    result = ALPHABET[Number(n % BASE)] + result;
    n = n / BASE;
  } while (n > 0n);

  return result.padStart(MIN_LENGTH, ALPHABET[0]);
}

/**
 * Decode a Base62 string back to its original bigint ID.
 * Throws if the input contains characters outside the alphabet.
 */
export function decode(code: string): bigint {
  let result = 0n;

  for (const char of code) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new RangeError(`Invalid Base62 character: '${char}' in code '${code}'`);
    }
    result = result * BASE + BigInt(index);
  }

  return result;
}

/** Width of the short_code column (VARCHAR(12)). */
export const SHORT_CODE_MAX_LENGTH = 12;

/**
 * Validate that a string could be a short code, before any DB lookup.
 * Short codes are either generated (Base62, ≥ 6 chars) or custom aliases
 * (3–12 chars of letters, digits, '-' and '_' — see customAliasSchema), so this
 * accepts the union of both. It must never reject something the API can create.
 */
const SHORT_CODE_PATTERN = new RegExp(`^[A-Za-z0-9_-]{3,${SHORT_CODE_MAX_LENGTH}}$`);
export function isValidShortCode(code: string): boolean {
  return SHORT_CODE_PATTERN.test(code);
}
