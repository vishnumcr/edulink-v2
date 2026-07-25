/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/paymentWebhook.ts
 *
 * Purpose:
 * Receives Razorpay's server-to-server payment confirmation and marks
 * the corresponding invoice term paid. This is "the eventual
 * verify-payment function" createFeeOrder.ts's own comments already
 * referenced — the piece that actually confirms money moved, since
 * createFeeOrder.ts explicitly does NOT do that (order creation only).
 *
 * This is the reliability backstop, not the only confirmation path:
 * Razorpay's own docs put it plainly — "Webhooks are your source of
 * truth." A client-side post-Checkout verification call (using the
 * separate checkout-handoff signature scheme, NOT this one) is still
 * worth building for immediate UI feedback, but is NOT this file and
 * is NOT built here — this webhook alone is sufficient for
 * correctness (it fires even if the parent's browser/app closes
 * before any client-side call completes), just not as snappy UX.
 *
 * ⚠️ Named/routed to match settings/payment/page.tsx, NOT invented
 * here — that page already builds and displays this exact URL to
 * staff (Webhook URL field, with a copy button):
 *   https://asia-south1-eon-edulink.cloudfunctions.net/paymentWebhook/{schoolId}
 * That means:
 *   - the exported function MUST be named exactly `paymentWebhook`
 *     (Firebase's URL routing is name-literal)
 *   - schoolId is a PATH SEGMENT (/paymentWebhook/{schoolId}), not a
 *     query parameter — Firebase strips the function name off the
 *     front and forwards the remainder as req.path, so schoolId is
 *     req.path's first segment here, e.g. "/eonschool_001" → "eonschool_001"
 * An earlier version of this file got both of these wrong (named
 * razorpayWebhook, expected ?schoolId=... in the query string) —
 * every real Razorpay delivery 400'd immediately as a result, since
 * whoever configures the webhook in Razorpay's dashboard is just
 * copy-pasting whatever this app's own UI already shows them, and
 * that UI was never wrong — the webhook was.
 *
 * ⚠️ Multi-tenant signature verification — EVERY school has its OWN
 * Razorpay account (see paymentGatewayService — unlike MSG91's single
 * shared account) and therefore its OWN webhook secret, but all
 * schools' webhooks hit this SAME shared URL (schoolId as a path
 * segment, not a separately-provisioned URL per tenant). Razorpay's
 * webhook payload doesn't self-identify which school it's for in a
 * way that can be trusted before verification, so:
 *   - schoolId (from the path, set by whoever configured the webhook
 *     in THEIR OWN Razorpay dashboard — not attacker-influenced
 *     request content) is used ONLY to look up which secret to
 *     verify against.
 *   - The signature check is what actually proves the payload is
 *     genuine — until it passes, NOTHING in the body is trusted,
 *     including the notes.schoolId inside it (checked again AFTER
 *     verification, as a cheap sanity guard against a misconfigured
 *     webhook URL, not as the source of truth).
 *
 * Idempotency — Razorpay redelivers on any non-2xx response or
 * timeout, and can occasionally redeliver a successfully-processed
 * event anyway. Checked here explicitly (payments/{razorpay_payment_id}
 * existence) BEFORE running the invoice-math transaction — relying on
 * Firestore's .set() being naturally overwrite-safe would NOT be
 * enough on its own, since re-running the term/invoice recompute a
 * second time would double-count the same payment against the term.
 *
 * ⚠️ DUPLICATED LOGIC, KNOWINGLY — the invoice/term recompute
 * transaction below mirrors recordPayment.ts's transaction almost
 * exactly, adapted for order-based lookup instead of trusting direct
 * client input. Not extracted into a shared function in this pass —
 * recordPayment.ts is a working, tested, currently-relied-on function,
 * and refactoring it as a side effect of adding this webhook risks
 * regressing it for a change nobody asked for. Same tradeoff already
 * made between admissionService.ts and collectAdmissionFee.ts
 * elsewhere in this codebase — worth consolidating into one shared
 * "applyPayment" core once a third caller (the client-side verify
 * function mentioned above) makes the duplication three-deep instead
 * of two.
 *
 * Health-status fields — settings/payment/page.tsx's UI already reads
 * config.webhookActive / lastWebhookAt / lastSuccessfulPaymentAt from
 * schools/{schoolId}/config/paymentGateway (the same doc
 * paymentGatewayService.connect() writes enabled/connected/provider/
 * keyId to) and has for a while — this file is what actually keeps
 * those fields honest; without it, that panel would show "Awaiting
 * first event" forever regardless of real webhook traffic.
 *
 * Responsibilities:
 * ✅ Verify the webhook signature against the RAW request body, using
 *    the specific school's own webhook secret
 * ✅ Cross-check the payment against paymentOrders — never trust the
 *    webhook payload's amount/term/student alone
 * ✅ Apply the payment atomically (mirrors recordPayment.ts's math)
 * ✅ Keep config/paymentGateway's health-status fields current
 * ✅ Be safely re-deliverable (idempotent)
 *
 * Does NOT:
 * ❌ Handle events for schools with no connected gateway / no
 *    matching paymentOrders record — acknowledged (200) but skipped,
 *    since retrying wouldn't change that outcome
 * ❌ Implement the client-side checkout-handoff verification path
 * --------------------------------------------------------------------
 */

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

import { db } from "./services/firebaseAdmin";
import { secretManager } from "./services/secretManager";

const PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface RazorpaySecretPayload {
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number; // paise
  currency: string;
  status: string;
  method?: string;
  notes?: Record<string, string>;
}

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
  };
}

interface PaymentOrderRecord {
  schoolId: string;
  studentId: string;
  invoiceId: string;
  termId: string;
  amount: number; // whole rupees
  status: string;
}

interface InvoiceTerm {
  id: string;
  name: string;
  amount: number;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
}

// Same convention as recordPayment.ts — whole rupees throughout, this
// epsilon only guards float drift, not real paise.
const EPSILON = 0.5;

function statusFromAmounts(paid: number, total: number): "paid" | "partial" | "unpaid" {
  if (paid >= total - EPSILON) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

/**
 * Razorpay's payment.method values (card/netbanking/wallet/emi/upi)
 * don't map 1:1 onto this app's coarser PaymentMode enum. upi/card
 * map directly; everything else buckets into bank_transfer as the
 * closest fit — the RAW Razorpay method is also stored separately
 * (gatewayMethod) on the payment doc so this simplification never
 * actually loses information, just coarsens what's shown by default.
 */
function mapRazorpayMethod(method: string | undefined): PaymentMode {
  if (method === "upi") return "upi";
  if (method === "card") return "card";
  return "bank_transfer";
}

function paymentGatewayConfigRef(schoolId: string) {
  return db.collection("schools").doc(schoolId).collection("config").doc("paymentGateway");
}

export const paymentWebhook = onRequest(
  { region: "asia-south1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    // schoolId is a PATH SEGMENT — see the ⚠️ note above for why, and
    // why this must match settings/payment/page.tsx's URL exactly.
    const schoolId = req.path.split("/").filter(Boolean)[0];
    if (!schoolId) {
      res.status(400).json({ error: "Missing schoolId in webhook URL path." });
      return;
    }

    // ── Look up THIS school's webhook secret ────────────────────────
    let credentials: RazorpaySecretPayload;
    try {
      credentials = await secretManager.getSecret<RazorpaySecretPayload>(
        `edulink-school-${schoolId}-razorpay`
      );
    } catch {
      // Unknown school or gateway never connected — nothing to verify
      // against. Ack anyway; retrying won't fix a URL that's wrong.
      res.status(200).json({ received: true, warning: "Unknown school or gateway not connected." });
      return;
    }
    if (!credentials.webhookSecret) {
      res.status(200).json({ received: true, warning: "No webhook secret configured for this school." });
      return;
    }

    // ── Verify signature against the RAW body — MUST be the raw
    //    bytes, not JSON.stringify(req.body); re-serializing can
    //    subtly change byte content (key order, whitespace) and break
    //    the signature even for a completely genuine payload. Firebase
    //    Functions exposes rawBody specifically for this. ───────────
    const signature = req.headers["x-razorpay-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "Missing signature header." });
      return;
    }

    const expectedSignature = crypto
      .createHmac("sha256", credentials.webhookSecret)
      .update(req.rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature);
    const receivedBuffer = Buffer.from(signature);
    const isValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!isValid) {
      res.status(400).json({ error: "Invalid signature." });
      return;
    }

    // Signature verified — this IS a genuine delivery from this
    // school's Razorpay account. Record that regardless of which
    // event it turns out to be, so the settings page's health panel
    // reflects real traffic even for events we don't act on below.
    await paymentGatewayConfigRef(schoolId).set(
      { webhookActive: true, lastWebhookAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // ── Only now is the body trusted ─────────────────────────────────
    const body = req.body as RazorpayWebhookPayload;

    // Sanity guard, not the security boundary (see file header) — the
    // webhook URL's schoolId is what we verified against; this just
    // catches a genuinely misconfigured webhook URL early.
    const payload = body.payload?.payment?.entity;
    if (payload?.notes?.schoolId && payload.notes.schoolId !== schoolId) {
      res.status(200).json({ received: true, warning: "schoolId mismatch between URL and payload notes." });
      return;
    }

    if (body.event !== "payment.captured") {
      // payment.failed, order.paid, refund.*, etc. — acknowledged, not
      // acted on. Failure states don't need an invoice change (the
      // term simply stays unpaid, same as if no order were ever
      // created); refunds are a separate, not-yet-built flow.
      res.status(200).json({ received: true, handled: false, event: body.event });
      return;
    }

    if (!payload) {
      res.status(200).json({ received: true, warning: "Malformed payment.captured payload." });
      return;
    }

    const razorpayPaymentId = payload.id;
    const paymentRef = db.collection("schools").doc(schoolId).collection("payments").doc(razorpayPaymentId);

    // ── Idempotency check — BEFORE the transaction, not relying on
    //    .set() overwrite semantics (see file header for why) ────────
    const existingPayment = await paymentRef.get();
    if (existingPayment.exists) {
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }

    // ── Cross-check against the reconciliation record from
    //    createFeeOrder.ts — never trust notes/amount from the
    //    webhook payload alone, even though it's now signature-verified
    //    (verified means "genuinely from Razorpay," not "matches what
    //    we actually expected to be paid") ──────────────────────────
    const orderRef = db.collection("schools").doc(schoolId).collection("paymentOrders").doc(payload.order_id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(200).json({ received: true, warning: "No matching paymentOrders record — cannot apply." });
      return;
    }

    const order = orderSnap.data() as PaymentOrderRecord;
    const paidRupees = payload.amount / 100;

    if (Math.abs(paidRupees - order.amount) > EPSILON) {
      // Genuinely suspicious — flag for manual review rather than
      // either silently applying a mismatched amount or silently
      // dropping a real payment. Does not throw: retrying changes
      // nothing about this mismatch, so a 200 stops Razorpay's retries
      // while still leaving a clear trail to investigate.
      await orderRef.update({
        status: "amount_mismatch",
        razorpayPaymentId,
        flaggedAmountPaise: payload.amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.status(200).json({ received: true, warning: "Amount mismatch — flagged for review, not applied." });
      return;
    }

    const invoiceRef = db.collection("schools").doc(schoolId).collection("invoices").doc(order.invoiceId);

    try {
      await db.runTransaction(async (tx) => {
        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists) {
          throw new Error("Invoice not found.");
        }
        const invoice = invoiceSnap.data()!;

        const terms: InvoiceTerm[] = Array.isArray(invoice.terms) ? invoice.terms : [];
        const termIndex = terms.findIndex((t) => t.id === order.termId);
        if (termIndex === -1) {
          throw new Error("Term not found on this invoice.");
        }

        const term = terms[termIndex];
        const termAmount = Number(term.amount) || 0;
        const termPaidSoFar = Number(term.paidAmount) || 0;
        const newTermPaid = Math.min(termPaidSoFar + paidRupees, termAmount);
        const newTermStatus = statusFromAmounts(newTermPaid, termAmount);

        const updatedTerms = [...terms];
        updatedTerms[termIndex] = { ...term, paidAmount: newTermPaid, status: newTermStatus };

        const summary = (invoice.summary ?? {}) as { total?: number };
        const invoiceTotal = Number(summary.total) || 0;
        const newInvoicePaid = updatedTerms.reduce((sum, t) => sum + (Number(t.paidAmount) || 0), 0);
        const newInvoiceBalance = invoiceTotal - newInvoicePaid;
        const newInvoiceStatus = statusFromAmounts(newInvoicePaid, invoiceTotal);

        tx.update(invoiceRef, {
          terms: updatedTerms,
          paidAmount: newInvoicePaid,
          balanceAmount: newInvoiceBalance,
          status: newInvoiceStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(paymentRef, {
          invoiceId: order.invoiceId,
          studentId: order.studentId,
          termId: order.termId,
          amount: paidRupees,
          mode: mapRazorpayMethod(payload.method),
          gatewayMethod: payload.method ?? null,
          referenceNumber: razorpayPaymentId,
          note: "Paid via Razorpay (parent app)",
          recordedBy: "razorpay-webhook",
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(orderRef, {
          status: "paid",
          razorpayPaymentId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      // A transaction failure here (invoice/term not found, etc.) is a
      // real data problem, not something a retry fixes — log and ack
      // rather than returning 5xx and triggering Razorpay's retry loop.
      console.error("paymentWebhook: failed to apply payment", {
        schoolId,
        razorpayPaymentId,
        orderId: payload.order_id,
        error: error instanceof Error ? error.message : error,
      });
      res.status(200).json({ received: true, warning: "Failed to apply payment — see function logs." });
      return;
    }

    // Payment successfully applied — keep the health panel's "last
    // successful payment" honest too, not just "a webhook arrived."
    await paymentGatewayConfigRef(schoolId).set(
      { lastSuccessfulPaymentAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    res.status(200).json({ received: true, applied: true });
  }
);