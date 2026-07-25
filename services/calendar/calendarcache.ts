/**
 * --------------------------------------------------------------------
 * File:
 * services/calendar/calendarCache.ts
 *
 * Purpose:
 * IndexedDB-backed local cache of one academic year's calendarDays
 * exceptions (holidays + working-day overrides), one row per
 * school+academicYear.
 *
 * Why a stored watermark (unlike timetableCache):
 * A WeeklyTimetable is a single Firestore document with its own
 * `updatedAt` — the delta-sync there just compares that field
 * directly. calendarDays is a whole COLLECTION of exception documents
 * with no single field to compare. Instead, calendarService compares
 * this row's stored `watermark` against schools/{schoolId}/config/
 * calendarMeta[academicYear] — a tiny doc bumped by
 * calendarRepository on every calendarDays write — and only re-reads
 * the full collection when those two disagree. See
 * calendarService.getWorkingDayOverrides for the full workflow.
 *
 * Responsibilities:
 * ✅ Store/retrieve one cached override map + its watermark, per
 *    school+academicYear
 *
 * Does NOT:
 * ❌ Talk to Firestore (that's CalendarRepository)
 * ❌ Decide *when* the cache is stale (that's CalendarService)
 * --------------------------------------------------------------------
 */

import { CalendarDayOverrideMap } from "@/types/calendar";
import { openCacheDb } from "@/services/cache/indexedDbCache";

const STORE = "calendar_overrides";

export interface CachedOverrides {
  watermark: number;
  overrides: CalendarDayOverrideMap;
}

function cacheKey(schoolId: string, academicYear: string): string {
  return `${schoolId}:${academicYear}`;
}

export const calendarCache = {
  async get(schoolId: string, academicYear: string): Promise<CachedOverrides | null> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(cacheKey(schoolId, academicYear));
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        const { cacheKey: _key, ...cached } = request.result as CachedOverrides & { cacheKey: string };
        resolve(cached);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async set(schoolId: string, academicYear: string, cached: CachedOverrides): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...cached, cacheKey: cacheKey(schoolId, academicYear) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clear(schoolId: string, academicYear: string): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(cacheKey(schoolId, academicYear));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};