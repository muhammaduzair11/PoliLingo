/** The parts of Web Crypto that randomId() uses. Either may be missing. */
export type RandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => Uint8Array;
};
/**
 * A random v4 UUID that works everywhere the app runs. `crypto.randomUUID`
 * exists only in secure contexts, so it is missing when the app is opened over
 * plain http on a LAN address, and it can throw. This falls back to
 * `crypto.getRandomValues`, which insecure contexts still have, and then to
 * `Math.random`, so it always returns an ID and never throws.
 */
export function randomId(
  source: RandomSource | undefined = globalThis.crypto,
): string {
  try {
    if (source?.randomUUID) return source.randomUUID();
  } catch {
    /* Fall through to the byte-level fallbacks. */
  }
  const bytes = new Uint8Array(16);
  try {
    if (!source?.getRandomValues) throw new Error('No getRandomValues');
    source.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
