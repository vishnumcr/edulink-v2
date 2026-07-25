/**
 * --------------------------------------------------------------------
 * File:
 * services/finance/financeCache.ts
 *
 * Purpose:
 * IndexedDB-backed local cache of a school's invoices, for the
 * Finance dashboard page.
 *
 * Why this exists:
 * Same reasoning as services/students/studentsCache.ts — see that
 * file for the full rationale. Short version: instead of a permanent
 * live listener on the whole invoices collection, the Finance
 * dashboard downloads the full invoice set once, caches it here, and
 * only asks Firestore for what changed since the last sync
 * (FinanceRepository.getInvoicesUpdatedSince). Filtering, searching,
 * sorting, and the stat-card totals all then run in-memory over the
 * cache.
 *
 * Trade-off specific to Finance, worth knowing: unlike student
 * profiles, invoices change more often (every payment collected) and
 * multiple staff may be collecting payments concurrently. This page
 * intentionally trades a small amount of freshness (you won't see a
 * colleague's payment until your next sync) for a large reduction in
 * reads. The payment-collection flow itself (finance/collect) still
 * uses a live listener — see FinanceRepository.subscribeToInvoices —
 * because that flow does need to see changes in real time.
 *
 * Responsibilities:
 * ✅ Store/retrieve cached invoices for a school
 * ✅ Track the delta-sync watermark (lastSyncedAt) per school
 *
 * Does NOT:
 * ❌ Talk to Firestore (that's FinanceRepository)
 * ❌ Decide *when* to sync (that's FinanceService.syncInvoices)
 * --------------------------------------------------------------------
 */

import { Invoice } from "@/types/finance";
import { openCacheDb } from "@/services/cache/indexedDbCache";

const INVOICES_STORE = "invoices";
const META_STORE = "finance_meta";

function cacheKey(schoolId: string, invoiceId: string): string {
  return `${schoolId}:${invoiceId}`;
}

export const financeCache = {
  /** All cached invoices for a school, unsorted — the caller filters/sorts. */
  async getAll(schoolId: string): Promise<Invoice[]> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVOICES_STORE, "readonly");
      const store = tx.objectStore(INVOICES_STORE);
      const range = IDBKeyRange.bound(`${schoolId}:`, `${schoolId}:\uffff`);
      const request = store.openCursor(range);
      const results: Invoice[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const { cacheKey: _key, ...invoice } = cursor.value as Invoice & { cacheKey: string };
          results.push(invoice);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  /** Insert or overwrite the given invoices in the cache (keyed by id). */
  async upsertMany(schoolId: string, invoices: Invoice[]): Promise<void> {
    if (invoices.length === 0) return;
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVOICES_STORE, "readwrite");
      const store = tx.objectStore(INVOICES_STORE);
      for (const invoice of invoices) {
        store.put({ ...invoice, cacheKey: cacheKey(schoolId, invoice.id) });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getLastSyncedAt(schoolId: string): Promise<number> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const request = tx.objectStore(META_STORE).get(schoolId);
      request.onsuccess = () => resolve(request.result?.lastSyncedAt ?? 0);
      request.onerror = () => reject(request.error);
    });
  },

  async setLastSyncedAt(schoolId: string, ms: number): Promise<void> {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({ schoolId, lastSyncedAt: ms });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Wipes the cache for one school — e.g. on logout. */
  async clear(schoolId: string): Promise<void> {
    const all = await financeCache.getAll(schoolId);
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([INVOICES_STORE, META_STORE], "readwrite");
      const store = tx.objectStore(INVOICES_STORE);
      for (const inv of all) store.delete(cacheKey(schoolId, inv.id));
      tx.objectStore(META_STORE).delete(schoolId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};