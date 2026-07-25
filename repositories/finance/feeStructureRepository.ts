/**
 * --------------------------------------------------------------------
 * File:
 * repositories/finance/feeStructureRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/feeStructure/current.
 *
 * Fee structure is configuration data (CRUD), not a money movement —
 * unlike payments, it's fine to read and write it directly through
 * the client SDK, gated by Firestore rules. See financeRepository.ts
 * for the payment-side rationale.
 *
 * Responsibilities:
 * ✅ Subscribe to the live fee structure document
 * ✅ Write the fee structure document
 *
 * Does NOT:
 * ❌ Apply default values for missing fields (that's the service)
 * ❌ Know about class labels, terms, or any other business concept
 * --------------------------------------------------------------------
 */

import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

function feeStructureCollectionRef(schoolId: string) {
  return collection(db, "schools", schoolId, "feeStructure");
}

function feeStructureDocRef(schoolId: string, academicYear: string) {
  return doc(db, "schools", schoolId, "feeStructure", academicYear);
}

export class FeeStructureRepository {
  /**
   * ----------------------------------------------------
   * One-time read of a school's fee structure document for a specific
   * academic year. Used where a live subscription isn't needed — e.g.
   * computing a single new invoice at admission-enrollment time.
   * ----------------------------------------------------
   */
  async getFeeStructure(schoolId: string, academicYear: string): Promise<Record<string, unknown> | null> {
    const snapshot = await getDoc(feeStructureDocRef(schoolId, academicYear));
    return snapshot.exists() ? snapshot.data() : null;
  }

  /**
   * ----------------------------------------------------
   * Finds the most recently saved fee structure across ALL years for
   * this school (excluding `excludeAcademicYear`, the year currently
   * being edited) — used to seed a brand-new academic year's form so
   * an admin isn't re-entering every class's tuition from scratch.
   *
   * Deliberately doc-id-agnostic: this also picks up the legacy
   * `feeStructure/current` doc from before per-year scoping existed,
   * for free — it's just another document in this same subcollection,
   * so a school's existing configuration seeds its first real year
   * without any separate migration step.
   * ----------------------------------------------------
   */
  async getMostRecentFeeStructure(
    schoolId: string,
    excludeAcademicYear: string
  ): Promise<Record<string, unknown> | null> {
    const snapshot = await getDocs(feeStructureCollectionRef(schoolId));
    const candidates = snapshot.docs.filter((d) => d.id !== excludeAcademicYear);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aTime = (a.data().updatedAt as Timestamp | undefined)?.toMillis() ?? 0;
      const bTime = (b.data().updatedAt as Timestamp | undefined)?.toMillis() ?? 0;
      return bTime - aTime;
    });

    return candidates[0].data();
  }

  /**
   * ----------------------------------------------------
   * Live subscription to a school's fee structure document for a
   * specific academic year.
   *
   * Calls back with null if the document doesn't exist yet (new
   * school, or a new academic year nothing's been saved for) — the
   * service is responsible for turning that into sensible defaults
   * or a copy-forward seed.
   * ----------------------------------------------------
   */
  subscribeToFeeStructure(
    schoolId: string,
    academicYear: string,
    callback: (data: Record<string, unknown> | null) => void
  ): () => void {
    return onSnapshot(feeStructureDocRef(schoolId, academicYear), (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : null);
    });
  }

  /**
   * ----------------------------------------------------
   * Overwrites the fee structure document for a specific academic
   * year. Stamps updatedAt so getMostRecentFeeStructure can find it
   * later as a copy-forward source for the next year.
   *
   * Firestore rejects `undefined` field values (e.g. MiscFee.classLabel
   * when applicableTo !== "class"), so the payload is round-tripped
   * through JSON first to strip them — plain data serialization, not
   * business logic. updatedAt is added AFTER that round-trip, since
   * JSON.stringify would otherwise destroy the serverTimestamp()
   * sentinel value.
   * ----------------------------------------------------
   */
  async saveFeeStructure(
    schoolId: string,
    academicYear: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const sanitized = JSON.parse(JSON.stringify(data));
    await setDoc(feeStructureDocRef(schoolId, academicYear), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
  }
}

export const feeStructureRepository = new FeeStructureRepository();