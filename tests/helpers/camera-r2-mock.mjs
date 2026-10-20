/**
 * Mock of the camera bucket's object operations (same shape as
 * `cameraObjectOperations` in server/media-api/_lib/r2.ts). Destructive
 * camera tests run against this — never a real bucket.
 *
 * `objects` is a Set of keys, or a Map of key -> lastModified ISO string when
 * a test needs object ages (the orphan sweep).
 */
export function mockOperations({ objects, deletes = [], failNext = { count: 0, name: "NetworkingError" } }) {
  return {
    async deleteObject(key) {
      deletes.push(key);
      if (failNext.count > 0) {
        failNext.count -= 1;
        const error = new Error(`connect failed with secret-ish detail key=${key}`);
        error.name = failNext.name ?? "NetworkingError";
        throw error;
      }
      objects.delete(key); // S3/R2 DeleteObject: deleting a missing key succeeds.
    },
    async objectExists(key) {
      return objects.has(key);
    },
    async listObjects({ prefix, cursor, limit }) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor === null ? 0 : Number(cursor);
      const page = keys.slice(start, start + limit);
      const lastModifiedOf = (k) => (objects instanceof Map ? objects.get(k) : null);
      return {
        objects: page.map((key) => ({ key, lastModified: lastModifiedOf(key) })),
        nextCursor: start + limit < keys.length ? String(start + limit) : null,
      };
    },
  };
}
