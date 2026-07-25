/**
 * --------------------------------------------------------------------
 * File:
 * repositories/timetable/timingsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/config/timings. Config data (CRUD), not money or
 * a multi-document write — fine directly through the client SDK, same
 * reasoning as routes/vehicles/trips.
 *
 * Responsibilities:
 * ✅ Subscribe to a school's master timings
 * ✅ Save the full slot list
 *
 * Does NOT:
 * ❌ Normalize, default, or validate slots (that's the service)
 * --------------------------------------------------------------------
 */

import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function timingsDocRef(schoolId: string) {
  return doc(db, "schools", schoolId, "config", "timings");
}

export class TimingsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's master timings. Callback receives
   * raw Firestore data (or null if the doc doesn't exist yet — a
   * brand-new school) — the service applies defaults.
   * ----------------------------------------------------
   */
  subscribeToTimings(
    schoolId: string,
    callback: (data: Record<string, unknown> | null) => void
  ): () => void {
    return onSnapshot(timingsDocRef(schoolId), (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : null);
    });
  }

  async saveTimings(schoolId: string, slots: Record<string, unknown>[]): Promise<void> {
    await setDoc(timingsDocRef(schoolId), { slots });
  }
}

export const timingsRepository = new TimingsRepository();