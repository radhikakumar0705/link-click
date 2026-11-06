import { isValidShortCode } from '@link-click/base62';
import { longUrlSchema, customAliasSchema, RESERVED_ALIASES } from '../index';

describe('longUrlSchema', () => {
  it('accepts a valid https URL', () => {
    const result = longUrlSchema.safeParse('https://example.com/page');
    expect(result.success).toBe(true);
  });

  it('accepts http URLs', () => {
    const result = longUrlSchema.safeParse('http://example.com');
    expect(result.success).toBe(true);
  });

  it('rejects URLs without a scheme', () => {
    const result = longUrlSchema.safeParse('example.com/page');
    expect(result.success).toBe(false);
  });

  it('rejects ftp:// URLs', () => {
    const result = longUrlSchema.safeParse('ftp://files.example.com');
    expect(result.success).toBe(false);
  });

  it('rejects localhost URLs (SSRF prevention)', () => {
    const result = longUrlSchema.safeParse('http://localhost:3000');
    expect(result.success).toBe(false);
  });

  it('rejects 127.0.0.1 (SSRF prevention)', () => {
    expect(longUrlSchema.safeParse('http://127.0.0.1/admin').success).toBe(false);
  });

  it('rejects private 192.168.x.x ranges (SSRF prevention)', () => {
    expect(longUrlSchema.safeParse('http://192.168.1.1').success).toBe(false);
  });

  it('rejects private 10.x.x.x ranges (SSRF prevention)', () => {
    expect(longUrlSchema.safeParse('http://10.0.0.1').success).toBe(false);
  });

  it('rejects URLs longer than 2048 characters', () => {
    const long = 'https://example.com/' + 'a'.repeat(2048);
    expect(longUrlSchema.safeParse(long).success).toBe(false);
  });

  it('trims leading/trailing whitespace', () => {
    const result = longUrlSchema.safeParse('  https://example.com  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toContain(' ');
    }
  });
});

describe('customAliasSchema', () => {
  it('accepts a valid alias', () => {
    expect(customAliasSchema.safeParse('my-product').success).toBe(true);
  });

  it('accepts aliases with underscores', () => {
    expect(customAliasSchema.safeParse('my_product_2').success).toBe(true);
  });

  it('accepts alphanumeric aliases', () => {
    expect(customAliasSchema.safeParse('launch2025').success).toBe(true);
  });

  it('rejects aliases shorter than 3 characters', () => {
    expect(customAliasSchema.safeParse('ab').success).toBe(false);
  });

  it('accepts aliases up to 12 characters (the short_code column width)', () => {
    expect(customAliasSchema.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('rejects aliases longer than 12 characters', () => {
    expect(customAliasSchema.safeParse('a'.repeat(13)).success).toBe(false);
  });

  it('only accepts aliases the redirect service will serve', () => {
    for (const alias of ['abc', 'my-link', 'my_link', 'launch2025', 'a'.repeat(12)]) {
      expect(customAliasSchema.safeParse(alias).success).toBe(true);
      expect(isValidShortCode(alias)).toBe(true);
    }
  });

  it('rejects aliases with spaces', () => {
    expect(customAliasSchema.safeParse('my product').success).toBe(false);
  });

  it('rejects aliases with Unicode/emoji characters', () => {
    expect(customAliasSchema.safeParse('my-🔗-product').success).toBe(false);
  });

  it('rejects all reserved words', () => {
    for (const word of RESERVED_ALIASES) {
      expect(customAliasSchema.safeParse(word).success).toBe(false);
    }
  });

  it('rejects reserved words regardless of case', () => {
    expect(customAliasSchema.safeParse('Admin').success).toBe(false);
    expect(customAliasSchema.safeParse('API').success).toBe(false);
  });
});
