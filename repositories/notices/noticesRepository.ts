/**
 * --------------------------------------------------------------------
 * File:
 * repositories/notices/noticesRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/
 * notices — and unlike every other repository in this codebase, that
 * means READS ONLY. There is no create/update/delete method here on
 * purpose: every write goes through the publishNotice Cloud Function
 * (see functions/src/notices/publishNotice.ts), per the frozen
 * architecture this feature was built from. Adding a write method
 * here would be building the exact bypass that architecture exists
 * to prevent.
 *
 * Responsibilities:
 * ✅ Live subscription to a school's notices
 *
 * Does NOT:
 * ❌ Write anything, ever — see above
 * ❌ Normalize/default fields (that's the service)
 * ❌ Filter/search (that's the service/page)
 * --------------------------------------------------------------------
 */

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export class NoticesRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every notice in a school, newest first.
   * Notices are read constantly and change relatively rarely (a
   * handful of publishes a week), so a live listener here — unlike
   * Timetable/Calendar's deliberate move away from onSnapshot — is
   * the right call: there's no local cache to keep in sync, and
   * "the list updates the moment a Cloud Function publish lands" is
   * exactly the behavior this feature wants (see the composer drawer,
   * which never has to manually refetch after a successful publish).
   * ----------------------------------------------------
   */
  subscribeToNotices(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "notices"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(q, (snapshot) => {
      callback(
        snapshot.docs.map((d) => ({
          id: d.id,
          data: d.data(),
        }))
      );
    });
  }
}

export const noticesRepository = new NoticesRepository();