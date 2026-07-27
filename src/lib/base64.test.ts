import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';

describe('base64', () => {
  it('round-trips plain ASCII', () => {
    expect(decodeBase64(encodeBase64('gunwale'))).toBe('gunwale');
  });

  it('round-trips the IPA that appears in every phonetic', () => {
    const phonetic = '/ˈɡʌnəl/';
    expect(decodeBase64(encodeBase64(phonetic))).toBe(phonetic);
  });

  it('proves why btoa alone cannot be used', () => {
    // This is the bug being guarded against: btoa is Latin-1 only.
    expect(() => btoa('/ˈɡʌnəl/')).toThrow();
    expect(() => encodeBase64('/ˈɡʌnəl/')).not.toThrow();
  });

  it('round-trips the curly quotes the dictionary returns in examples', () => {
    const example = '“Use the sheets in the hall closet.”';
    expect(decodeBase64(encodeBase64(example))).toBe(example);
  });

  it('round-trips characters outside the basic plane', () => {
    const text = 'a book 📖 and an em—dash';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('round-trips a realistic library payload', () => {
    const payload = JSON.stringify({
      version: 1,
      words: [{ term: 'sheet', phonetic: '/ʃiːt/', note: 'nautical — a rope' }],
    });
    expect(decodeBase64(encodeBase64(payload))).toBe(payload);
  });

  it('handles the empty string', () => {
    expect(decodeBase64(encodeBase64(''))).toBe('');
  });

  it('tolerates the line wrapping GitHub adds to base64 payloads', () => {
    const text = 'a'.repeat(200);
    const wrapped = encodeBase64(text).replace(/(.{60})/g, '$1\n');
    expect(decodeBase64(wrapped)).toBe(text);
  });

  it('handles a payload large enough to exercise chunking', () => {
    // Comfortably past the 0x8000 chunk boundary.
    const text = 'ǝ'.repeat(50_000);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});
