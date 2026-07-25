/**
 * --------------------------------------------------------------------
 * File:
 * repositories/transport/vehiclesRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/vehicles.
 * Vehicles are configuration data (CRUD), not a money movement — fine
 * to read and write directly through the client SDK, gated by
 * Firestore rules.
 *
 * Responsibilities:
 * ✅ Subscribe to a school's vehicles
 * ✅ Create / update / delete a vehicle document
 *
 * Does NOT:
 * ❌ Normalize data or validate required fields (that's the service)
 * --------------------------------------------------------------------
 */

import {
  collection, deleteDoc, doc, addDoc, updateDoc,
  onSnapshot, orderBy, query, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export class VehiclesRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every vehicle in a school, ordered by
   * vehicle number. Callback receives raw Firestore data — the
   * service normalizes it.
   * ----------------------------------------------------
   */
  subscribeToVehicles(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "vehicles"),
      orderBy("vehicleNo", "asc")
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  async addVehicle(schoolId: string, data: Record<string, unknown>): Promise<void> {
    await addDoc(collection(db, "schools", schoolId, "vehicles"), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateVehicle(
    schoolId: string,
    vehicleId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "vehicles", vehicleId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteVehicle(schoolId: string, vehicleId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "vehicles", vehicleId));
  }
}

export const vehiclesRepository = new VehiclesRepository();