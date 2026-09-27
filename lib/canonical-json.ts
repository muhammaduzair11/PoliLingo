/**
 * JSON with every object's keys sorted, recursively, and no whitespace.
 *
 * This is the content repository's canonicalJson() (scripts/build.mjs),
 * reproduced exactly, and the database's private.canonical_json() gives the
 * same text for the same JSON. The learner copy's contentHash, the progress
 * envelope's hash and the review fingerprints are all taken over this text,
 * so a difference of one byte here is a hash that never matches.
 *
 * Arrays keep their order, because order is content. Keys are sorted as
 * JavaScript's default sort orders them, by UTF-16 code unit. An undefined
 * value is dropped from an object and written as null in an array, as
 * JSON.stringify does. tests/fixtures/canonical-json-vectors.json holds
 * vectors made with the content repository's own function.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry: unknown) => (entry === undefined ? 'null' : canonicalJson(entry))).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
