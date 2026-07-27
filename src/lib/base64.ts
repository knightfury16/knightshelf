/**
 * UTF-8 safe base64, for the GitHub Contents API.
 *
 * `btoa(JSON.stringify(library))` **throws** on this app's own data: phonetics contain
 * IPA (`/ˈɡʌnəl/`) and definitions contain curly quotes, none of which fit in Latin-1.
 * Encoding to UTF-8 bytes first is the only correct route.
 */

/**
 * Chunked to avoid blowing the argument limit of `String.fromCharCode` on large
 * libraries — spreading a 500 KB byte array in one call overflows the stack.
 */
const CHUNK = 0x8000;

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }

  return btoa(binary);
}

export function decodeBase64(encoded: string): string {
  // GitHub wraps base64 payloads at 60 characters; atob rejects the newlines.
  const binary = atob(encoded.replace(/\s/g, ''));

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}
