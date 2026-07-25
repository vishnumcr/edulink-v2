/**
 * --------------------------------------------------------------------
 * File:
 * repositories/transport/tripsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/trips.
 * Trips are configuration data (CRUD), not a money movement — fine
 * to read and write directly through the client SDK, gated by
 * Firestore rules.
 *
 * Responsibilities:
 * ✅ Subscribe to a school's trips
 * ✅ Create / update / delete a trip document
 *
 * Does NOT:
 * ❌ Resolve vehicleNo/routeName or validate the vehicle/route exist
 *    (that's the service)
 * --------------------------------------------------------------------
 */

import {
  collection, deleteDoc, doc, addDoc, updateDoc,
  onSnapshot, query, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export class TripsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every trip in a school. Unordered at the
   * query level — the service sorts by start time, since that's a
   * business-meaningful order, not a storage concern.
   * ----------------------------------------------------
   */
  subscribeToTrips(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(collection(db, "schools", schoolId, "trips"));

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  async addTrip(schoolId: string, data: Record<string, unknown>): Promise<void> {
    await addDoc(collection(db, "schools", schoolId, "trips"), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateTrip(
    schoolId: string,
    tripId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "trips", tripId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteTrip(schoolId: string, tripId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "trips", tripId));
  }
}

export const tripsRepository = new TripsRepository();