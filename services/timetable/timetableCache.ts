/**
 * --------------------------------------------------------------------
 * File:
 * services/timetable/timetableCache.ts
 *
 * Purpose:
 * IndexedDB-backed local cache of WeeklyTimetable documents, one row
 * per class-section, for the Timetable page's delta sync.
 *
 * Why this exists:
 * A timetable is configuration data — created once, rarely edited,
 * read constantly — so the page has no business re-downloading it on
 * every visit. Instead it keeps the last-known WeeklyTimetable here
 * and lets timetableService.getTimetableIfChanged decide whether
 * Firestore's copy has actually moved on (by comparing `updatedAt`)
 * before treating the cached copy as stale. See that method for the
 * full delta-sync workflow.
 *
 * Unlike studentsCache/financeCache, there's no separate "last synced
 * at" watermark store here: those features sync a whole COLLECTION
 * incrementally (many rows, one watermark), whereas each timetable is
 * a single self-describing document — its own `updatedAt` field IS
 * the watermark, so a separate one would just be a second copy of the
 * same number to keep in sync.
 *
 * Responsibilities:
 * ✅ Store/retrieve one cached WeeklyTimetable per class-section
 *
 * Does NOT:
 * ❌ Talk to Firestore (that's TimetableRepository)
 * ❌ Decide *when* the cache is stale (that's TimetableService)
 * --------------------------------------------------------------------
 */

import { WeeklyTimetable } from "@/types/timetable";
import { openCacheDb } from "@/services/cache/indexedDbCache";

const TIMETABLES_STORE = "timetables";

// Timetables from different schools share one IndexedDB database (one
// per browser origin), so every record is namespaced by schoolId to
// avoid collisions if a device is ever used for more than one school.
function cacheKey(schoolId: string, classId: string, sectionId: string): string {
  return `${schoolId}:${classId}_${sectionId}`;
}

export const timetableCache = {
  /** The cached WeeklyTimetable for one class-section, or null if this device has never cached it. */
  async get(schoolId: string, classId: string, sectionId: string): Promise<WeeklyTimetable | null> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TIMETABLES_STORE, "readonly");
      const request = tx.objectStore(TIMETABLES_STORE).get(cacheKey(schoolId, classId, sectionId));
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        // Strip the internal cacheKey field back off before handing
        // the record back out as a plain WeeklyTimetable.
        const { cacheKey: _key, ...timetable } = request.result as WeeklyTimetable & { cacheKey: string };
        resolve(timetable);
      };
      request.onerror = () => reject(request.error);
    });
  },

  /** Overwrites the cached copy for one class-section. */
  async set(schoolId: string, classId: string, sectionId: string, timetable: WeeklyTimetable): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TIMETABLES_STORE, "readwrite");
      tx.objectStore(TIMETABLES_STORE).put({
        ...timetable,
        cacheKey: cacheKey(schoolId, classId, sectionId),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Wipes the cached copy for one class-section — e.g. after a conflicted save forces a full reload. */
  async clear(schoolId: string, classId: string, sectionId: string): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TIMETABLES_STORE, "readwrite");
      tx.objectStore(TIMETABLES_STORE).delete(cacheKey(schoolId, classId, sectionId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
