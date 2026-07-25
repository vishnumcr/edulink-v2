/**
 * --------------------------------------------------------------------
 * File:
 * services/cache/indexedDbCache.ts
 *
 * Purpose:
 * Single shared opener for the "edulink-cache" IndexedDB database.
 *
 * Why this file exists:
 * studentsCache.ts and financeCache.ts both cache their data in the
 * SAME IndexedDB database (one database per browser origin — that's
 * how IndexedDB works, not a design choice). Each one used to open it
 * independently with its own `DB_VERSION = 1` and only create its own
 * object stores in `onupgradeneeded`.
 *
 * That's the exact bug that caused:
 *   "NotFoundError: One of the specified object stores was not found"
 *
 * What happened: opening Students first created the database at
 * version 1 with the students/meta stores. Opening Finance afterward
 * requested the SAME version 1 of the SAME database name — and
 * `onupgradeneeded` only fires when the requested version is HIGHER
 * than the database's current version. Since it didn't increase, the
 * invoices/finance_meta stores were never created, so any attempt to
 * read them threw NotFoundError.
 *
 * The fix: one shared schema, one shared version number, one
 * `onupgradeneeded` that creates every store any feature needs — so
 * there's only ever one place that can get this wrong, not one per
 * feature. Bumping SCHEMA_VERSION here is now the ONLY way any
 * feature adds a new object store; it must never be bumped in a
 * feature-specific cache file.
 * --------------------------------------------------------------------
 */

export const DB_NAME = "edulink-cache";

/**
 * Bump this — and only this — whenever ANY feature's cache needs a
 * new object store. Every existing user's browser is currently on
 * whatever version their last visit last saw; IndexedDB only runs
 * onupgradeneeded when it sees a version number higher than what's
 * already stored, so this number must always increase, never reset.
 */
export const SCHEMA_VERSION = 4;

// Every object store any feature's cache uses, in one place. Adding a
// new one here (and bumping SCHEMA_VERSION above) is the only correct
// way to add cache storage for a new feature.
const OBJECT_STORES: { name: string; keyPath: string }[] = [
  { name: "students", keyPath: "cacheKey" },
  { name: "meta", keyPath: "schoolId" },
  { name: "invoices", keyPath: "cacheKey" },
  { name: "finance_meta", keyPath: "schoolId" },
  // One row per class-section's WeeklyTimetable — see
  // services/timetable/timetableCache.ts. No separate watermark
  // store needed (unlike students/finance): the timetable document
  // itself carries `updatedAt`, which the delta-sync compares
  // directly against Firestore instead of a stored sync timestamp.
  { name: "timetables", keyPath: "cacheKey" },
  // One row per school+academicYear's full set of calendar day
  // exceptions (holidays/working-day overrides) — see
  // services/calendar/calendarCache.ts. Unlike timetables, this DOES
  // need its own stored watermark (the row's own `watermark` field):
  // a WeeklyTimetable is one document with its own `updatedAt`, but
  // calendarDays is a whole COLLECTION of exception documents with no
  // single `updatedAt` to compare against — the watermark here is
  // read from the small schools/{schoolId}/config/calendarMeta doc
  // instead.
  { name: "calendar_overrides", keyPath: "cacheKey" },
];

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens (or reuses an in-flight open of) the shared cache database.
 * Every feature-specific cache module (studentsCache.ts,
 * financeCache.ts, ...) should call this instead of calling
 * indexedDB.open() itself.
 */
export function openCacheDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of OBJECT_STORES) {
        if (!db.objectStoreNames.contains(store.name)) {
          db.createObjectStore(store.name, { keyPath: store.keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null; // allow a retry on the next call instead of caching a failure forever
      reject(request.error);
    };
  });

  return dbPromise;
}