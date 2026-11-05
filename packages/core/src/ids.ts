const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id. Does not rely on crypto.randomUUID (unavailable outside secure contexts). */
export function newId(prefix = '', length = 8): string {
  let s = '';
  const g = globalThis.crypto;
  if (g?.getRandomValues) {
    const bytes = g.getRandomValues(new Uint8Array(length));
    for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  } else {
    for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return prefix + s;
}
