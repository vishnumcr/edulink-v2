/**
 * --------------------------------------------------------------------
 * File:
 * repositories/transport/routesRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/routes.
 * Routes are configuration data (CRUD), not a money movement — fine
 * to read and write directly through the client SDK, gated by
 * Firestore rules.
 *
 * The read side (subscribeToRoutes) is also used by Fee Structure to
 * display per-stop transport fees — that contract is unchanged.
 *
 * Responsibilities:
 * ✅ Subscribe to a school's routes
 * ✅ Create / update / delete a route document
 *
 * Does NOT:
 * ❌ Normalize data or validate stop counts (that's the service)
 * --------------------------------------------------------------------
 */

import {
  collection, deleteDoc, doc, addDoc, updateDoc,
  onSnapshot, orderBy, query, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export class RoutesRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every route in a school, ordered by name.
   * Callback receives raw Firestore data — the service normalizes it.
   * ----------------------------------------------------
   */
  subscribeToRoutes(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "routes"),
      orderBy("routeName", "asc")
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  async addRoute(schoolId: string, data: Record<string, unknown>): Promise<void> {
    await addDoc(collection(db, "schools", schoolId, "routes"), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateRoute(
    schoolId: string,
    routeId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "routes", routeId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteRoute(schoolId: string, routeId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "routes", routeId));
  }
}

export const routesRepository = new RoutesRepository();