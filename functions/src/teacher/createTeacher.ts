/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/teacher/createTeacher.ts
 *
 * Purpose:
 * Creates a Firebase Auth account for a new teacher, and writes both
 * their schools/{schoolId}/teachers/{uid} document AND their
 * users/{uid} staff profile — keyed by the SAME uid the Auth account
 * was just given.
 *
 * Why this can't be a client-side write:
 * schools/{schoolId}/teachers/{teacherId} used to be created directly
 * from the browser via the Firestore client SDK (see
 * teachersRepository.ts) — fine for profile fields, but it can never
 * create the Firebase Auth account a teacher needs to sign into the
 * Android app, because creating an Auth account FOR SOMEONE ELSE
 * requires the Admin SDK, which only runs server-side. Same
 * constraint createOrLinkParent.ts is built around.
 *
 * Unlike createOrLinkParent.ts, this does NOT need a two-tier "global
 * account + per-school reverse index" model — a teacher belongs to
 * exactly one school (confirmed in the design conversation this was
 * built from), so there's no cross-school identity to reconcile here.
 * One Auth account, one schools/{schoolId}/teachers/{uid} doc, one
 * users/{uid} doc — all three share the same id, on purpose, so
 * there's never a second id to keep in sync.
 *
 * Credential model: email + password, not phone+OTP like parents. The
 * account is created with NO password set — the admin never chooses
 * or sees one — and the CLIENT triggers Firebase's own "forgot
 * password" email (authRepository.sendPasswordReset, already existing
 * in this codebase) immediately after this function returns
 * successfully, so the teacher's first action is always setting their
 * own password. This function doesn't send that email itself: the
 * Admin SDK has no built-in "send a templated reset email" call
 * (auth.generatePasswordResetLink() only returns a URL — actually
 * delivering it would mean standing up a separate transactional-email
 * integration this codebase doesn't have yet), whereas the client
 * SDK's sendPasswordResetEmail already works today with zero extra
 * infrastructure. Simpler to let the client fire it right after this
 * call succeeds than to duplicate email delivery here.
 *
 * Authorization implemented here:
 * ✅ Caller must be signed in
 * ✅ Caller's users/{uid} profile must exist, be "active", and belong
 *    to the SAME schoolId as the teacher being created
 *
 * Authorization intentionally NOT implemented here yet (same
 * documented gap as recordPayment.ts — see that file): no role check
 * restricting this to "admin" callers specifically, since
 * users/{uid}.role has no formalized taxonomy anywhere in this
 * codebase yet. Any active staff member of a school can add a teacher
 * to it today. Add a role check here once roles are formalized.
 *
 * Duplicate-email handling — deliberately NOT the same as
 * createOrLinkParent's phone-collision handling: a parent with the
 * same phone at two different schools is a real, expected case
 * (siblings), so that flow reuses the existing account. A teacher's
 * email already existing in Auth is NOT an expected case here — it
 * would mean either a genuine duplicate add, or (worse) someone
 * else's unrelated account that happens to share this email. This
 * function fails loudly ("already-exists") instead of silently
 * attaching a "teacher" role to a stranger's account.
 * --------------------------------------------------------------------
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, auth } from "../services/firebaseAdmin";

interface CreateTeacherRequest {
  schoolId: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
}

interface CreateTeacherResult {
  uid: string;
  email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createTeacher = onCall(
  { region: "asia-south1" },
  async (request): Promise<CreateTeacherResult> => {
    // ── Authentication ──────────────────────────────────────────────
    const callerAuth = request.auth;
    if (!callerAuth) {
      throw new HttpsError("unauthenticated", "You must be signed in to add a teacher.");
    }

    // ── Input validation ────────────────────────────────────────────
    const data = (request.data ?? {}) as Partial<CreateTeacherRequest>;

    if (!data.schoolId || typeof data.schoolId !== "string") {
      throw new HttpsError("invalid-argument", "schoolId is required.");
    }
    if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
      throw new HttpsError("invalid-argument", "name is required.");
    }
    if (!data.email || typeof data.email !== "string" || !EMAIL_PATTERN.test(data.email)) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }

    const schoolId = data.schoolId;
    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";

    // ── Authorization: caller must belong to this school ────────────
    const callerSnap = await db.collection("users").doc(callerAuth.uid).get();
    if (!callerSnap.exists) {
      throw new HttpsError("permission-denied", "No user profile found for this account.");
    }
    const caller = callerSnap.data() as { schoolId?: string; status?: string };
    if (caller.status !== "active") {
      throw new HttpsError("permission-denied", "This account is disabled.");
    }
    if (caller.schoolId !== schoolId) {
      throw new HttpsError("permission-denied", "You do not have access to add teachers to this school.");
    }

    // ── Create the Auth account. No password set — the teacher sets
    // their own via the reset-email flow the client triggers next.
    // Not wrapped in a transaction with the Firestore writes below:
    // Auth calls must never run inside a Firestore transaction (a
    // transaction callback can retry more than once under contention,
    // and createUser() isn't idempotent) — see createOrLinkParent.ts's
    // header for the same constraint. ───────────────────────────────
    let uid: string;
    try {
      const userRecord = await auth.createUser({ email, displayName: name });
      uid = userRecord.uid;
    } catch (err) {
      const authError = err as { code?: string; message?: string };
      if (authError.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "An account with this email already exists. Use a different email, or check whether this teacher was already added."
        );
      }
      // Log the real cause server-side (Cloud Logging) — the raw error
      // is never safe to hand back to the client verbatim, but it must
      // not vanish entirely either. Re-throwing `err` as-is here (the
      // previous behavior) meant onCall's own framework masked it down
      // to a bare {code: "internal"} with NO text on the client, and
      // nothing logged the actual authError.code/message anywhere —
      // undiagnosable from either side. This is the fix for that blind
      // spot, whatever the underlying auth/* code turns out to be.
      console.error("createTeacher: auth.createUser failed", {
        email,
        code: authError.code,
        message: authError.message,
      });
      throw new HttpsError(
        "internal",
        `Failed to create the teacher's login (${authError.code ?? "unknown error"}). Please try again or check the function logs.`
      );
    }

    // ── Write both Firestore docs together in a batch, so they land
    // as one atomic pair even though the Auth call above isn't (and
    // can't be) part of the same atomic operation. If the batch fails
    // after the Auth account was already created, the result is an
    // orphaned Auth user with no Firestore docs — the same accepted,
    // self-evident failure mode createOrLinkParent.ts documents for
    // its own Auth-then-Firestore ordering; surfaced below as a
    // distinct error rather than a generic one. ────────────────────
    const batch = db.batch();

    batch.set(db.collection("schools").doc(schoolId).collection("teachers").doc(uid), {
      uid,
      name,
      email,
      phone,
      subject,
      photoUrl: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(db.collection("users").doc(uid), {
      uid,
      name,
      email,
      role: "Teacher", // exact casing required — the Android app checks role == "Teacher" verbatim (see LoginActivity.checkUserRoleAndNavigate)
      schoolId,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch {
      throw new HttpsError(
        "internal",
        "The teacher's login was created, but saving their profile failed. Please try again, or contact support before re-adding this teacher."
      );
    }

    return { uid, email };
  }
);