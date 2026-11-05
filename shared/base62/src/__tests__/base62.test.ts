import { encode, decode, isValidShortCode } from '../index';

describe('Base62 encode/decode', () => {
  describe('encode', () => {
    it('encodes 1n to a padded 6-char string', () => {
      expect(encode(1n)).toHaveLength(6);
    });

    it('is deterministic — same input always gives same output', () => {
      expect(encode(12345n)).toBe(encode(12345n));
    });

    it('produces unique codes for sequential IDs', () => {
      const codes = new Set(Array.from({ length: 1000 }, (_, i) => encode(BigInt(i + 1))));
      expect(codes.size).toBe(1000);
    });

    it('handles large IDs (close to 56 billion)', () => {
      const large = 56_000_000_000n;
      const code = encode(large);
      expect(code.length).toBeGreaterThanOrEqual(6);
      expect(code.length).toBeLessThanOrEqual(7);
    });

    it('throws for negative IDs', () => {
      expect(() => encode(-1n)).toThrow(RangeError);
    });

    it('encodes 0n to all-zero Base62 characters', () => {
      expect(encode(0n)).toBe('000000');
    });
  });

  describe('decode', () => {
    it('is the inverse of encode', () => {
      const ids = [1n, 100n, 9999n, 1_234_567n, 999_999_999n];
      for (const id of ids) {
        expect(decode(encode(id))).toBe(id);
      }
    });

    it('throws on invalid characters', () => {
      expect(() => decode('abc!@#')).toThrow(RangeError);
    });

    it('throws on characters outside the alphabet (e.g. emoji)', () => {
      expect(() => decode('abc🔗ab')).toThrow(RangeError);
    });
  });

  describe('isValidShortCode', () => {
    it('accepts a valid 6-char code', () => {
      expect(isValidShortCode('aB3kP9')).toBe(true);
    });

    it('accepts codes up to 12 characters', () => {
      expect(isValidShortCode('aB3kP9xYzW12')).toBe(true);
    });

    it('rejects codes shorter than 6 characters', () => {
      expect(isValidShortCode('abc')).toBe(false);
    });

    it('rejects codes longer than 12 characters', () => {
      expect(isValidShortCode('aB3kP9xYzW123')).toBe(false);
    });

    it('rejects codes with special characters', () => {
      expect(isValidShortCode('aB3!P9')).toBe(false);
    });

    it('rejects codes with spaces', () => {
      expect(isValidShortCode('aB3 P9')).toBe(false);
    });
  });

  describe('collision resistance', () => {
    it('first 62^6 IDs all produce distinct 6-char codes', () => {
      // Spot-check: sample 10,000 IDs spread across the space
      const samples = Array.from({ length: 10_000 }, (_, i) =>
        encode(BigInt(Math.floor(i * 5_600_000))),
      );
      const unique = new Set(samples);
      expect(unique.size).toBe(samples.length);
    });
  });
});
