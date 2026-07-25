/**
 * --------------------------------------------------------------------
 * File:
 * repositories/admission/admissionRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/admissions,
 * and for schools/{schoolId}/meta/counters (the registration number
 * sequence — see getNextNumber below).
 *
 * Submitting an application and approving/rejecting it are plain
 * config-style writes — fine directly through the client SDK, same
 * reasoning as routes/vehicles/trips. addAdmission is a transaction
 * only because it needs to atomically increment the registration
 * counter alongside creating the document, not because it's a money
 * operation.
 *
 * Enrollment (Student + Invoice + Payment creation, admission number
 * assignment) is NOT here — it used to be a client-side transaction
 * in this file (enrollAdmission), which per this codebase's own
 * CRUD-vs-Cloud-Function rule was a real gap: a modified client could
 * submit a different payment amount than the school's configured fee,
 * and the client-side invoice math never accounted for transport fees
 * the way the server-side version always has. That method is removed;
 * admissionService.collectAdmissionFee now calls the
 * collectAdmissionFee Cloud Function (functions/src/collectAdmissionFee.ts)
 * instead, which does the same thing with server-side validation and
 * shares this same counters document for its own ADM-000123 sequence
 * (see that file's counterRef).
 *
 * Responsibilities:
 * ✅ Subscribe to a school's admissions
 * ✅ Create an admission document with an auto-generated registration
 *    number (status always starts "pending")
 * ✅ Update status to "approved" / "rejected"
 *
 * Does NOT:
 * ❌ Enroll admissions (Cloud Function's job — see above)
 * ❌ Compute invoice amounts or validate the admission fee
 * --------------------------------------------------------------------
 */

import {
  collection, doc, updateDoc,
  onSnapshot, orderBy, query, runTransaction, serverTimestamp,
  Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

function countersDocRef(schoolId: string) {
  return doc(db, "schools", schoolId, "meta", "counters");
}

/**
 * ----------------------------------------------------
 * Reads schools/{schoolId}/meta/counters, increments `field` by 1,
 * and returns the new value formatted as `{prefix}-000123`. Must be
 * called with all of a transaction's other reads already done first
 * (Firestore requires every tx.get before any tx.set/update) — this
 * does the read itself, so call it before any writes in the caller.
 *
 * A single counters document (rather than one per number type) keeps
 * this to one read/write regardless of how many counters a school
 * ends up needing later, and avoids a proliferation of tiny docs.
 * Only "lastRegistrationNumber" is incremented from the client now —
 * "lastAdmissionNumber" is incremented server-side by the
 * collectAdmissionFee Cloud Function against this same document.
 * ----------------------------------------------------
 */
async function getNextNumber(
  tx: Transaction,
  schoolId: string,
  field: "lastRegistrationNumber",
  prefix: string
): Promise<string> {
  const ref = countersDocRef(schoolId);
  const snap = await tx.get(ref);
  const current = (snap.exists() ? (snap.data()[field] as number) : 0) || 0;
  const next = current + 1;

  tx.set(ref, { [field]: next }, { merge: true });

  return `${prefix}-${String(next).padStart(6, "0")}`;
}

export class AdmissionRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every admission in a school, newest first.
   * Callback receives raw Firestore data — the service normalizes it.
   * ----------------------------------------------------
   */
  subscribeToAdmissions(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "admissions"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  /**
   * ----------------------------------------------------
   * Creates the admission document with an atomically-assigned
   * registration number (REG-000001, REG-000002, ...). Transactional
   * so the counter can never be incremented without the admission
   * actually being created, or vice versa.
   * ----------------------------------------------------
   */
  async addAdmission(
    schoolId: string,
    data: Record<string, unknown>
  ): Promise<{ admissionId: string; registrationNumber: string }> {
    const admissionRef = doc(collection(db, "schools", schoolId, "admissions"));

    const registrationNumber = await runTransaction(db, async (tx) => {
      const number = await getNextNumber(tx, schoolId, "lastRegistrationNumber", "REG");
      tx.set(admissionRef, {
        ...data,
        registrationNumber: number,
        status: "pending",
        feeStatus: "unpaid",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return number;
    });

    return { admissionId: admissionRef.id, registrationNumber };
  }

  async approveAdmission(schoolId: string, admissionId: string): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "admissions", admissionId), {
      status: "approved",
      updatedAt: serverTimestamp(),
    });
  }

  async rejectAdmission(schoolId: string, admissionId: string, reason: string): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "admissions", admissionId), {
      status: "rejected",
      rejectionReason: reason,
      updatedAt: serverTimestamp(),
    });
  }
}

export const admissionRepository = new AdmissionRepository();