/**
 * --------------------------------------------------------------------
 * File:
 * services/students/studentsCache.ts
 *
 * Purpose:
 * IndexedDB-backed local cache of a school's students, for the
 * Students admin page.
 *
 * Why this exists:
 * Student master data (name, DOB, parent, contact) is slow-changing —
 * a handful of edits a day out of possibly thousands of students. So
 * instead of re-querying Firestore on every filter/search/page change,
 * the Students page downloads the full roster once, caches it here,
 * and only asks Firestore for what changed since the last sync
 * (see StudentsRepository.getStudentsUpdatedSince). Filtering,
 * searching, and sorting all then run in-memory over the cache —
 * instant, and zero additional Firestore reads.
 *
 * This is explicitly NOT the right model for time-bounded, fast-
 * changing data (attendance, payments) — see the students/finance
 * conversation this was designed from. It's specifically because
 * student master data is headcount-bounded and rarely edited.
 *
 * Responsibilities:
 * ✅ Store/retrieve cached students for a school
 * ✅ Track the delta-sync watermark (lastSyncedAt) per school
 *
 * Does NOT:
 * ❌ Talk to Firestore (that's StudentsRepository)
 * ❌ Decide *when* to sync (that's StudentsService.syncStudents)
 * --------------------------------------------------------------------
 */

import { Student } from "@/types/students";
import { openCacheDb } from "@/services/cache/indexedDbCache";

const STUDENTS_STORE = "students";
const META_STORE = "meta";

// Students from different schools share one IndexedDB database (one
// per browser origin), so every record is namespaced by schoolId to
// avoid collisions if a device is ever used for more than one school.
function cacheKey(schoolId: string, studentId: string): string {
  return `${schoolId}:${studentId}`;
}

export const studentsCache = {
  /**
   * All cached students for a school, in whatever order IndexedDB
   * returns them — the caller is responsible for sorting/filtering.
   * Includes soft-deleted students; callers that want the visible
   * roster should filter out `deleted === true` themselves.
   */
  async getAll(schoolId: string): Promise<Student[]> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STUDENTS_STORE, "readonly");
      const store = tx.objectStore(STUDENTS_STORE);
      const range = IDBKeyRange.bound(`${schoolId}:`, `${schoolId}:\uffff`);
      const request = store.openCursor(range);
      const results: Student[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          // Strip the internal cacheKey field back off before handing
          // the record back out as a plain Student.
          const { cacheKey: _key, ...student } = cursor.value as Student & { cacheKey: string };
          results.push(student);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Insert or overwrite the given students in the cache (keyed by id,
   * so this is safe to call repeatedly with just the delta).
   */
  async upsertMany(schoolId: string, students: Student[]): Promise<void> {
    if (students.length === 0) return;
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STUDENTS_STORE, "readwrite");
      const store = tx.objectStore(STUDENTS_STORE);
      for (const student of students) {
        store.put({ ...student, cacheKey: cacheKey(schoolId, student.id) });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * The delta-sync watermark — "the last time we successfully synced
   * this school's students." 0 if this school has never been synced
   * on this device, which naturally makes the next sync a full fetch
   * (getStudentsUpdatedSince(schoolId, 0) matches every document).
   */
  async getLastSyncedAt(schoolId: string): Promise<number> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const request = tx.objectStore(META_STORE).get(schoolId);
      request.onsuccess = () => resolve(request.result?.lastSyncedAt ?? 0);
      request.onerror = () => reject(request.error);
    });
  },

  async setLastSyncedAt(schoolId: string, ms: number): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({ schoolId, lastSyncedAt: ms });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Wipes the cache for one school — e.g. on logout. */
  async clear(schoolId: string): Promise<void> {
    const all = await studentsCache.getAll(schoolId);
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STUDENTS_STORE, META_STORE], "readwrite");
      const store = tx.objectStore(STUDENTS_STORE);
      for (const s of all) store.delete(cacheKey(schoolId, s.id));
      tx.objectStore(META_STORE).delete(schoolId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};