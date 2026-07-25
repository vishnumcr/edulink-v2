/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/parent/createOrLinkParent.ts
 *
 * Purpose:
 * Creates a new parent account, or links an existing one, to a
 * student — called AFTER enrollment succeeds (see
 * collectAdmissionFee.ts), never at "pending" or "approved".
 *
 * Rationale (from the admission-flow design conversation): a pending
 * application could still be rejected; an approved one might never
 * pay. "Enrolled" is the first point where the student officially
 * exists in the system — that's when a parent account becomes useful,
 * not before.
 *
 * ⚠️ MUST NOT be called from inside a Firestore transaction, even
 * though it always runs immediately after one (collectAdmissionFee's
 * enrollment transaction). A transaction callback can be invoked MORE
 * THAN ONCE if it needs to retry under contention, and
 * auth.createUser() is not idempotent — a second call for the same
 * phone throws auth/phone-number-already-exists, and there's no way
 * to "undo" an Auth user if the surrounding transaction later aborts.
 * Any Firebase Auth call inside a Firestore transaction callback is a
 * correctness bug waiting to happen, not a style preference.
 *
 * Race safety without a transaction: two students of the same parent
 * (e.g. twins) could be enrolled at nearly the same moment, both
 * finding "no existing account" and both attempting to create one.
 * This leans on Firebase Auth's OWN uniqueness constraint on phone
 * number as the race guard, rather than a custom lock — see the catch
 * block in getOrCreateAuthUser below.
 *
 * Responsibilities:
 * ✅ Normalize the phone, look up an existing ParentAccount by it
 * ✅ Create the Firebase Auth user + ParentAccount doc if none exists
 * ✅ Append this student to the parent's linkedStudents[]
 * ✅ Write the reverse index (StudentParentLink) under the student
 *
 * Does NOT:
 * ❌ Send an OTP or authenticate anyone (see sendOtp.ts / verifyOtp.ts
 *    — those assume the parent identity already exists; this file is
 *    what makes that true)
 * ❌ Run inside a Firestore transaction (see above)
 * ❌ Fail the caller's enrollment if linking fails — the caller
 *    (collectAdmissionFee.ts) is expected to catch and report per
 *    parent, not let one bad phone number undo an already-successful
 *    enrollment
 * --------------------------------------------------------------------
 */

import { FieldValue } from "firebase-admin/firestore";
import { db, auth } from "../services/firebaseAdmin";
import { normalizeIndianPhone } from "./identity";
import { ParentAccount, ParentLinkRequest, ParentLinkResult, StudentParentLink } from "./types";

export interface CreateOrLinkParentInput {
  schoolId: string;
  schoolName: string;
  studentId: string;
  studentName: string;
  className: string;
  section: string | null;
  parent: ParentLinkRequest;
}

/**
 * Atomically generates the next parent ID ("EL00012458"). School-
 * agnostic on purpose — a parent account is never scoped to one
 * school (the same phone across multiple schools' kids must resolve
 * to the SAME account) — so this counter lives at the top level, not
 * under schools/{schoolId}. Its own tiny transaction, Firestore-only,
 * safe to retry — unlike the Auth call this is never combined with.
 */
async function generateEduLinkId(): Promise<string> {
  const counterRef = db.collection("config").doc("parentIdCounter");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = (snap.exists ? (snap.data()?.sequence as number) : 0) || 0;
    const next = current + 1;
    tx.set(counterRef, { sequence: next }, { merge: true });
    return `EL${String(next).padStart(8, "0")}`;
  });
}

/**
 * Finds an existing ParentAccount by phone, or creates a new Auth
 * user + ParentAccount doc. Returns wasCreated so the caller can
 * report "linked to existing account" vs. "new account created".
 */
async function getOrCreateAuthUser(
  phone: string,
  name: string,
  relationship: "father" | "mother"
): Promise<{ uid: string; eduLinkId: string; wasCreated: boolean }> {
  // 1. Check Firestore first — cheaper than an Auth lookup, and the
  //    normal path once an account already exists.
  const existingSnap = await db
    .collection("users")
    .where("phone", "==", phone)
    .where("type", "==", "parent")
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const found = existingSnap.docs[0];
    const data = found.data() as ParentAccount;
    return { uid: found.id, eduLinkId: data.eduLinkId, wasCreated: false };
  }

  // 2. Nothing in Firestore — try to create a new Auth user.
  const eduLinkId = await generateEduLinkId();
  try {
    const userRecord = await auth.createUser({ phoneNumber: phone, displayName: name });

    const account: ParentAccount = {
      uid: userRecord.uid,
      type: "parent",
      eduLinkId,
      name,
      phone,
      relationship,
      status: "active",
      linkedStudents: [],
      createdAt: FieldValue.serverTimestamp(),
    };
    await db.collection("users").doc(userRecord.uid).set(account);

    return { uid: userRecord.uid, eduLinkId, wasCreated: true };
  } catch (err) {
    // 3. Someone else won the race between our Firestore check above
    //    and this createUser call (e.g. a twin's enrollment a moment
    //    earlier) — Auth itself rejected the duplicate phone. That's
    //    our race-safety net instead of a custom lock: look up the
    //    account THEY created and use it, rather than treating this
    //    as a real failure.
    const authError = err as { code?: string };
    if (authError.code !== "auth/phone-number-already-exists") {
      throw err;
    }

    const existingUser = await auth.getUserByPhoneNumber(phone);
    const docSnap = await db.collection("users").doc(existingUser.uid).get();

    if (docSnap.exists) {
      const data = docSnap.data() as ParentAccount;
      return { uid: existingUser.uid, eduLinkId: data.eduLinkId, wasCreated: false };
    }

    // Auth user exists but its Firestore doc doesn't — a previous
    // attempt died between the two writes. Recreate the doc rather
    // than leaving an orphaned Auth-only account. The eduLinkId
    // generated above may end up unused if THIS was also a race with
    // a third concurrent attempt, leaving a small gap in the
    // sequence — the same acceptable tradeoff as admission-number
    // gaps from rejected applications, not a correctness problem.
    const account: ParentAccount = {
      uid: existingUser.uid,
      type: "parent",
      eduLinkId,
      name,
      phone,
      relationship,
      status: "active",
      linkedStudents: [],
      createdAt: FieldValue.serverTimestamp(),
    };
    await db.collection("users").doc(existingUser.uid).set(account);
    return { uid: existingUser.uid, eduLinkId, wasCreated: true };
  }
}

/**
 * Creates or links a parent account and connects it to a student.
 * Call once per parent (father, mother independently) — never a
 * shared account for both, per types/parent.ts.
 */
export async function createOrLinkParent(input: CreateOrLinkParentInput): Promise<ParentLinkResult> {
  const { schoolId, schoolName, studentId, studentName, className, section, parent } = input;

  const phone = normalizeIndianPhone(parent.phone);
  if (!phone) {
    throw new Error(`Invalid phone number for ${parent.relationship}: "${parent.phone}"`);
  }

  const { uid, eduLinkId, wasCreated } = await getOrCreateAuthUser(phone, parent.name, parent.relationship);

  // Append this student to the parent's linkedStudents — arrayUnion
  // is atomic at the single-document level, no transaction needed
  // (and, per the file header, must not be wrapped in one here).
  await db
    .collection("users")
    .doc(uid)
    .update({
      linkedStudents: FieldValue.arrayUnion({
        schoolId,
        schoolName,
        studentId,
        studentName,
        className,
        section,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

  // Reverse index, colocated with the student.
  const link: StudentParentLink = {
    uid,
    eduLinkId,
    name: parent.name,
    phone,
    relationship: parent.relationship,
    linkedAt: FieldValue.serverTimestamp(),
  };
  await db
    .collection("schools")
    .doc(schoolId)
    .collection("students")
    .doc(studentId)
    .collection("parents")
    .doc(uid)
    .set(link);

  return { uid, eduLinkId, wasCreated };
}