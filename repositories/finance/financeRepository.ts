/**
 * --------------------------------------------------------------------
 * File:
 * repositories/finance/financeRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/invoices.
 *
 * This repository is read-only for now — this pass only covers the
 * invoice dashboard (search/filter/view). Writing invoices (generation,
 * payment allocation) is a business transaction and belongs behind a
 * Cloud Function per the CRUD-vs-business-transaction rule, not here.
 *
 * Responsibilities:
 * ✅ Subscribe to the live invoice list
 *
 * Does NOT:
 * ❌ Apply default values for missing fields (that's the service)
 * ❌ Write invoices
 * --------------------------------------------------------------------
 */

import { collection, getDocs, limit, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface PaymentFilters {
  /** Inclusive lower bound on recordedAt, epoch ms. */
  startMs?: number;
  /** Inclusive upper bound on recordedAt, epoch ms. */
  endMs?: number;
  studentId?: string;
}

export class FinanceRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every invoice in a school.
   *
   * Not currently used by any page — kept available for a future
   * case that genuinely needs every invoice live (e.g. a real-time
   * "collections today" board). The Finance dashboard reads from a
   * local cache instead (see FinanceService.syncInvoices), and the
   * payment-collection flow (finance/collect) fetches only the one
   * invoice it's acting on (see getInvoiceForStudent below) — neither
   * needs, or should pay for, a permanent full-collection listener.
   *
   * Returns an unsubscribe function. Callback receives raw
   * Firestore data (loosely typed) — the service normalizes it.
   * ----------------------------------------------------
   */
  subscribeToInvoices(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "invoices"),
      orderBy("className", "asc")
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

  /**
   * ----------------------------------------------------
   * One-time fetch of a single student's invoice — one targeted
   * document read (billed per document returned, not per document in
   * the collection), used by the payment-collection flow
   * (finance/collect) instead of a live listener on every invoice in
   * the school.
   *
   * Not a live subscription on purpose: after a payment is recorded,
   * the Cloud Function's response already contains the new totals, so
   * there's no need to pay for another read just to see your own
   * change reflected — see FinanceService/finance/collect for how
   * that's patched in locally instead.
   * ----------------------------------------------------
   */
  async getInvoiceForStudent(
    schoolId: string,
    studentId: string
  ): Promise<{ id: string; data: Record<string, unknown> } | null> {
    const q = query(
      collection(db, "schools", schoolId, "invoices"),
      where("studentId", "==", studentId),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, data: doc.data() };
  }

  /**
   * ----------------------------------------------------
   * One-time fetch of every invoice updated after `sinceMs` (epoch
   * milliseconds) — the delta-sync primitive the Finance dashboard's
   * local cache is built on. sinceMs = 0 naturally becomes "fetch
   * everything", which is what a cold (never-synced) cache needs.
   *
   * See the ⚠️ requirement note on Invoice.updatedAt in
   * types/finance.ts — this query depends on every invoice document
   * always having that field set.
   * ----------------------------------------------------
   */
  async getInvoicesUpdatedSince(
    schoolId: string,
    sinceMs: number
  ): Promise<{ id: string; data: Record<string, unknown> }[]> {
    const q = query(
      collection(db, "schools", schoolId, "invoices"),
      where("updatedAt", ">", Timestamp.fromMillis(sinceMs))
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }

  /**
   * ----------------------------------------------------
   * Live subscription to payments recorded since `sinceMs`, newest
   * first, capped at `limitCount`. Built for the Collect Fee page's
   * "Today's Collections" panel — same "see colleagues' payments in
   * real time" reasoning as subscribeToInvoices above, deliberately
   * NOT a permanent full-collection listener (sinceMs scopes it to
   * "today", limitCount bounds the read cost regardless of volume).
   * ----------------------------------------------------
   */
  subscribeToPaymentsSince(
    schoolId: string,
    sinceMs: number,
    limitCount: number,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "payments"),
      where("recordedAt", ">=", Timestamp.fromMillis(sinceMs)),
      orderBy("recordedAt", "desc"),
      limit(limitCount)
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  /**
   * ----------------------------------------------------
   * One-time fetch of payments matching the given filters, newest
   * first. Built for the Payment History page — deliberately NOT a
   * live listener, since browsing historical records doesn't need
   * real-time updates and a "Refresh" button is the right affordance
   * there instead (same reasoning as the Finance dashboard's
   * cache/sync model, just without the offline cache since payment
   * history isn't needed offline the way the invoice dashboard is).
   *
   * studentId + a date range together requires a composite index
   * (recordedAt + studentId) — Firestore will report the exact index
   * to create if one doesn't exist yet when this combination is
   * actually queried.
   * ----------------------------------------------------
   */
  async getPayments(
    schoolId: string,
    filters: PaymentFilters,
    limitCount: number
  ): Promise<{ id: string; data: Record<string, unknown> }[]> {
    const constraints = [];
    if (filters.startMs !== undefined) {
      constraints.push(where("recordedAt", ">=", Timestamp.fromMillis(filters.startMs)));
    }
    if (filters.endMs !== undefined) {
      constraints.push(where("recordedAt", "<=", Timestamp.fromMillis(filters.endMs)));
    }
    if (filters.studentId) {
      constraints.push(where("studentId", "==", filters.studentId));
    }

    const q = query(
      collection(db, "schools", schoolId, "payments"),
      ...constraints,
      orderBy("recordedAt", "desc"),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
}

export const financeRepository = new FinanceRepository();