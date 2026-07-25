/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/createFeeOrder.ts
 *
 * Purpose:
 * Creates a Razorpay order so a PARENT (via the separate parent app)
 * can pay one term of their child's invoice online. This is the
 * "stage 3b" piece collectAdmissionFee.ts's own comments already
 * flagged as not-yet-built — online gateway collection, as opposed
 * to recordPayment.ts's staff-entered manual/cash payments.
 *
 * ⚠️ SCOPE BOUNDARY — this function only CREATES the order. It does
 * NOT verify payment, does NOT update the invoice, and does NOT create
 * a payments audit record. Razorpay Checkout runs client-side after
 * this returns; the client then gets back
 * (razorpay_payment_id, razorpay_order_id, razorpay_signature), which
 * MUST be verified server-side by a separate function (not yet built)
 * before the invoice/term is ever marked paid — never trust those
 * values from the client directly, and never mark anything paid here,
 * since this function runs BEFORE any money has actually moved.
 *
 * Caller: the parent app, using the Firebase session established by
 * verifyOtp.ts's custom token (once that mints one — see that file's
 * own scope note; until then this function has no real caller yet
 * either, which is fine, this is built ahead of that in isolation).
 *
 * Authorization implemented here (this is NOT a staff caller, so
 * requireRole.ts does not apply — see types/parent.ts for why the
 * two shapes are deliberately not unioned):
 * ✅ Caller must be signed in
 * ✅ Caller's users/{uid} doc must exist, type === "parent", status === "active"
 * ✅ The (schoolId, studentId) pair being paid for must appear in the
 *    caller's OWN linkedStudents[] — this is the one place in this
 *    project that actively enforces the "parents can only touch their
 *    own linked students" rule for a WRITE-adjacent action; Firestore
 *    security rules don't help here because Cloud Functions run with
 *    admin privileges and bypass them entirely, so this check has to
 *    happen in code, not be assumed from rules written elsewhere.
 *
 * studentId is DERIVED from the invoice, not accepted from the client
 * (the parent app's actual request only sends schoolId/invoiceId/
 * termId — see FeeFragment.kt's payTerm()). This is also just more
 * correct: the invoice is the source of truth for which student it
 * belongs to, so there's no reason to trust a client-asserted value
 * for something the server can look up itself.
 *
 * amount is OPTIONAL and defaults to the term's full remaining
 * balance — the parent app has no partial-amount input anywhere in
 * its UI (its "Pay Now"/"Pay Balance" button always means "clear what
 * remains"), so requiring an explicit amount doesn't match how the
 * only real caller actually works. An explicit amount is still
 * accepted and validated against the partial-payment policy below,
 * for whenever a partial-payment UI is added — but it's optional, not
 * assumed.
 *
 * Per-school payment gateway (NOT the shared MSG91 account — every
 * school connects its own Razorpay account, see paymentGatewayService):
 * ✅ schools/{schoolId}/config/paymentGateway.connected must be true
 * ✅ Credentials read from Secret Manager at
 *    "edulink-school-{schoolId}-razorpay" (same secret ID
 *    paymentGatewayService.connect() already writes to)
 * --------------------------------------------------------------------
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "./services/firebaseAdmin";
import { secretManager } from "./services/secretManager";
import { razorpayProvider } from "./paymentGateway/providers/razorpay";
import { ParentAccount } from "./parent/types";

interface CreateFeeOrderRequest {
  schoolId: string;
  invoiceId: string;
  termId: string;
  /** Whole rupees. Optional — defaults to the term's full remaining
   * balance (see file header). Never trusted as-is even when provided. */
  amount?: number;
}

interface InvoiceTerm {
  id: string;
  name: string;
  amount: number;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
}

interface RazorpaySecretPayload {
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

interface PaymentGatewayConfig {
  enabled?: boolean;
  connected?: boolean;
  provider?: string;
  allowPartialPayments?: boolean;
  minimumPartialAmount?: number;
}

// Amounts are whole rupees throughout this app — same epsilon and
// convention as recordPayment.ts, kept consistent rather than
// reinvented here.
const EPSILON = 0.5;

export const createFeeOrder = onCall(
  { region: "asia-south1" },
  async (request) => {
    // ── Authentication ──────────────────────────────────────────────
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to pay a fee.");
    }

    // ── Input validation ────────────────────────────────────────────
    const data = (request.data ?? {}) as Partial<CreateFeeOrderRequest>;

    if (!data.schoolId || typeof data.schoolId !== "string") {
      throw new HttpsError("invalid-argument", "schoolId is required.");
    }
    if (!data.invoiceId || typeof data.invoiceId !== "string") {
      throw new HttpsError("invalid-argument", "invoiceId is required.");
    }
    if (!data.termId || typeof data.termId !== "string") {
      throw new HttpsError("invalid-argument", "termId is required.");
    }
    if (
      data.amount !== undefined &&
      (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0)
    ) {
      throw new HttpsError("invalid-argument", "amount, if provided, must be a positive number.");
    }

    const schoolId = data.schoolId;
    const invoiceId = data.invoiceId;
    const termId = data.termId;
    const requestedAmount = data.amount;

    // ── Load the invoice + term FIRST — studentId is derived from
    //    here, never accepted from the client (see file header) ─────
    const invoiceRef = db.collection("schools").doc(schoolId).collection("invoices").doc(invoiceId);
    const invoiceSnap = await invoiceRef.get();
    if (!invoiceSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found.");
    }
    const invoice = invoiceSnap.data()!;
    const studentId = invoice.studentId as string;
    if (!studentId) {
      throw new HttpsError("internal", "This invoice has no student on file.");
    }

    // ── Authorization: caller must be an active parent linked to THIS
    //    student at THIS school ────────────────────────────────────
    const callerSnap = await db.collection("users").doc(auth.uid).get();
    if (!callerSnap.exists) {
      throw new HttpsError("permission-denied", "No parent account found for this login.");
    }
    const caller = callerSnap.data() as ParentAccount;
    if (caller.type !== "parent") {
      throw new HttpsError("permission-denied", "This action is only available to parent accounts.");
    }
    if (caller.status !== "active") {
      throw new HttpsError("permission-denied", "This account is disabled.");
    }
    const isLinked = (caller.linkedStudents ?? []).some(
      (s) => s.schoolId === schoolId && s.studentId === studentId
    );
    if (!isLinked) {
      throw new HttpsError(
        "permission-denied",
        "This student is not linked to your account."
      );
    }

    // ── Term lookup, compute what's actually owed ────────────────────
    const terms: InvoiceTerm[] = Array.isArray(invoice.terms) ? invoice.terms : [];
    const term = terms.find((t) => t.id === termId);
    if (!term) {
      throw new HttpsError("not-found", "Term not found on this invoice.");
    }

    const termRemaining = (Number(term.amount) || 0) - (Number(term.paidAmount) || 0);
    if (termRemaining <= EPSILON) {
      throw new HttpsError("failed-precondition", "This term is already fully paid.");
    }

    // Default to the full remaining balance when the client doesn't
    // send an amount — see file header for why that's the normal case.
    const amount = requestedAmount ?? termRemaining;

    if (amount > termRemaining + EPSILON) {
      throw new HttpsError(
        "failed-precondition",
        `Amount (${amount}) exceeds this term's remaining balance (${termRemaining}).`
      );
    }

    // ── Payment gateway config + partial-payment policy for this school ─
    const gatewayConfigSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("config")
      .doc("paymentGateway")
      .get();

    const gatewayConfig = (gatewayConfigSnap.exists ? gatewayConfigSnap.data() : {}) as PaymentGatewayConfig;

    if (!gatewayConfig.connected || !gatewayConfig.enabled) {
      throw new HttpsError(
        "failed-precondition",
        "Online fee payment is not enabled for this school yet."
      );
    }

    const isPartial = amount < termRemaining - EPSILON;
    if (isPartial) {
      if (!gatewayConfig.allowPartialPayments) {
        throw new HttpsError(
          "failed-precondition",
          "This school requires the full term amount to be paid at once."
        );
      }
      const minimum = Number(gatewayConfig.minimumPartialAmount) || 0;
      if (minimum > 0 && amount < minimum) {
        throw new HttpsError(
          "failed-precondition",
          `The minimum partial payment for this school is ₹${minimum}.`
        );
      }
    }

    // ── Fetch this school's OWN Razorpay credentials ─────────────────
    // Deliberately per-school, unlike MSG91's single shared account —
    // see paymentGatewayService.connect() for where this secret ID
    // convention comes from.
    const secretId = `edulink-school-${schoolId}-razorpay`;
    let credentials: RazorpaySecretPayload;
    try {
      credentials = await secretManager.getSecret<RazorpaySecretPayload>(secretId);
    } catch {
      // Firestore said "connected", but the secret is missing/unreadable
      // — a real inconsistency worth its own error rather than letting
      // a raw Secret Manager NOT_FOUND leak to the parent app.
      throw new HttpsError(
        "internal",
        "This school's payment gateway is misconfigured. Please contact the school office."
      );
    }

    // ── Create the order ──────────────────────────────────────────────
    // Receipt must be unique per attempt and strictly under 40 characters for Razorpay.
    // Generate a truncated MD5 hash of the invoiceId + termId combination to ensure safety.
    const uniqueHash = crypto
      .createHash("md5")
      .update(`${invoiceId}-${termId}`)
      .digest("hex")
      .substring(0, 10);

    const receipt = `rcpt-${uniqueHash}-${Date.now()}`;

    const order = await razorpayProvider.createOrder(credentials.keyId, credentials.keySecret, {
      amountInRupees: amount,
      receipt,
      notes: {
        schoolId,
        studentId,
        invoiceId,
        termId,
        parentUid: auth.uid,
      },
    });

    // ── Record the pending order for reconciliation ───────────────────
    // The eventual verify-payment function looks this up by
    // razorpayOrderId to confirm the amount/term it's about to mark
    // paid actually matches what was created here — it must NOT trust
    // the amount/term the client claims to have just paid.
    await db
      .collection("schools")
      .doc(schoolId)
      .collection("paymentOrders")
      .doc(order.id)
      .set({
        schoolId,
        studentId,
        invoiceId,
        termId,
        amount,
        parentUid: auth.uid,
        razorpayOrderId: order.id,
        status: "created",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Field named amountPaise (not "amount") to match exactly what the
    // parent app's FeeFragment.kt already parses from the response.
    return {
      success: true,
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      // Public key — safe to send to the client, this is what Razorpay
      // Checkout needs to open. keySecret never leaves this function.
      keyId: credentials.keyId,
    };
  }
);
