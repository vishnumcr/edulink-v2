/**
 * --------------------------------------------------------------------
 * File:
 * services/finance/feeStructureService.ts
 *
 * Purpose:
 * Business logic for the Fee Structure config page.
 *
 * Responsibilities:
 * ✅ Normalize the raw fee structure document, keeping it in sync
 *    with the school's current class list (adds entries for new
 *    classes, drops entries for classes that no longer exist)
 * ✅ Build sensible defaults for a school with nothing configured yet
 * ✅ Build/resize the term list when the term count changes,
 *    preserving names/due dates already entered for terms that still
 *    exist
 * ✅ Persist the structure (this is CRUD config, not a money
 *    movement — direct client write is correct here, unlike payments)
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Touch invoices — existing invoices are immutable snapshots and
 *    are never rewritten when the structure changes
 * --------------------------------------------------------------------
 */

import { feeStructureRepository } from "@/repositories/finance/feeStructureRepository";
import {
  AdmissionFeeConfig,
  BooksEntry,
  FeeSchedule,
  FeeStructureDoc,
  FeeTerm,
  MiscFee,
  TuitionEntry,
} from "@/types/finance";

const DEFAULT_TERM_COUNT = 3;

function defaultSchedule(): FeeSchedule {
  return {
    mode: "scheduled",
    termCount: DEFAULT_TERM_COUNT,
    terms: buildTermsForCount(DEFAULT_TERM_COUNT, []),
    flexibleDueDate: "",
    finalDueDate: "",
  };
}

function normalizeTuition(
  classLabels: string[],
  raw: Record<string, unknown>[]
): TuitionEntry[] {
  const byClass = new Map<string, number>();
  for (const entry of raw) {
    const classLabel = entry.classLabel as string;
    if (classLabel) byClass.set(classLabel, (entry.amount as number) ?? 0);
  }
  return classLabels.map((classLabel) => ({
    classLabel,
    amount: byClass.get(classLabel) ?? 0,
  }));
}

function normalizeBooks(
  classLabels: string[],
  raw: Record<string, unknown>[]
): BooksEntry[] {
  const byClass = new Map<string, { amount: number; note: string }>();
  for (const entry of raw) {
    const classLabel = entry.classLabel as string;
    if (classLabel) {
      byClass.set(classLabel, {
        amount: (entry.amount as number) ?? 0,
        note: (entry.note as string) ?? "",
      });
    }
  }
  return classLabels.map((classLabel) => ({
    classLabel,
    amount: byClass.get(classLabel)?.amount ?? 0,
    note: byClass.get(classLabel)?.note ?? "",
  }));
}

function normalizeMisc(raw: Record<string, unknown>[]): MiscFee[] {
  return raw.map((entry) => ({
    id: (entry.id as string) || "",
    name: (entry.name as string) || "",
    amount: (entry.amount as number) ?? 0,
    applicableTo: (entry.applicableTo as MiscFee["applicableTo"]) || "all",
    classLabel: entry.classLabel as string | undefined,
    frequency: (entry.frequency as MiscFee["frequency"]) || "once",
    isActive: (entry.isActive as boolean) ?? true,
  }));
}

function normalizeAdmissionFee(raw: Record<string, unknown> | undefined): AdmissionFeeConfig {
  if (!raw) return { amount: 0, isActive: false };
  return {
    amount: (raw.amount as number) ?? 0,
    // Defaults to false, not true — a school with nothing configured
    // yet should never silently start charging an admission fee.
    isActive: (raw.isActive as boolean) ?? false,
  };
}

function normalizeSchedule(raw: Record<string, unknown> | undefined): FeeSchedule {
  if (!raw) return defaultSchedule();

  const termCount = (raw.termCount as number) || DEFAULT_TERM_COUNT;
  const rawTerms = (raw.terms as Record<string, unknown>[] | undefined) ?? [];

  return {
    mode: (raw.mode as FeeSchedule["mode"]) || "scheduled",
    termCount,
    terms: buildTermsForCount(
      termCount,
      rawTerms.map((t) => ({
        id: (t.id as string) || "",
        name: (t.name as string) || "",
        dueDate: (t.dueDate as string) || "",
      }))
    ),
    flexibleDueDate: (raw.flexibleDueDate as string) || "",
    finalDueDate: (raw.finalDueDate as string) || "",
  };
}

/**
 * ----------------------------------------------------
 * Resizes a term list to `count` entries.
 *
 * Terms are keyed by deterministic id (term_1, term_2, ...), matching
 * the ids invoices already reference, so existing names/due dates are
 * preserved by position when the count changes — only the tail is
 * added or trimmed.
 * ----------------------------------------------------
 */
export function buildTermsForCount(count: number, existingTerms: FeeTerm[]): FeeTerm[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `term_${i + 1}`;
    const existing = existingTerms[i];
    return {
      id,
      name: existing?.name || `Term ${i + 1}`,
      dueDate: existing?.dueDate || "",
    };
  });
}

function normalizeFeeStructure(
  raw: Record<string, unknown> | null,
  classLabels: string[]
): FeeStructureDoc {
  if (!raw) return emptyFeeStructure(classLabels);

  return {
    tuition: normalizeTuition(classLabels, (raw.tuition as Record<string, unknown>[]) ?? []),
    books: normalizeBooks(classLabels, (raw.books as Record<string, unknown>[]) ?? []),
    misc: normalizeMisc((raw.misc as Record<string, unknown>[]) ?? []),
    schedule: normalizeSchedule(raw.schedule as Record<string, unknown>),
    admissionFee: normalizeAdmissionFee(raw.admissionFee as Record<string, unknown>),
  };
}

function emptyFeeStructure(classLabels: string[]): FeeStructureDoc {
  return {
    tuition: classLabels.map((classLabel) => ({ classLabel, amount: 0 })),
    books: classLabels.map((classLabel) => ({ classLabel, amount: 0, note: "" })),
    misc: [],
    schedule: defaultSchedule(),
    admissionFee: { amount: 0, isActive: false },
  };
}

export class FeeStructureService {
  /**
   * ----------------------------------------------------
   * A blank structure for a school with nothing configured yet —
   * one zeroed tuition/books entry per current class, no misc fees,
   * default 3-term schedule.
   * ----------------------------------------------------
   */
  emptyFeeStructure(classLabels: string[]): FeeStructureDoc {
    return emptyFeeStructure(classLabels);
  }

  /**
   * ----------------------------------------------------
   * Live subscription to a school's fee structure for a specific
   * academic year, normalized and kept in sync with its current class
   * list.
   *
   * If nothing has been saved yet for this academic year, this seeds
   * the callback with the most recently saved structure from ANY
   * prior year (or the school's pre-existing structure from before
   * per-year scoping existed) instead of a blank form — copy-forward,
   * not copy-nothing, since most years only change a handful of
   * amounts. This is a SEED ONLY: nothing is written to Firestore
   * until the admin explicitly saves, so visiting this page for a new
   * year never silently commits last year's numbers on its own.
   *
   * `isSeeded` tells the caller whether what it just received is an
   * unsaved copy-forward (so the UI can show a "review before saving"
   * hint) versus a structure that was already saved for this exact
   * year.
   * ----------------------------------------------------
   */
  subscribeToFeeStructure(
    schoolId: string,
    academicYear: string,
    classLabels: string[],
    callback: (data: FeeStructureDoc, isSeeded: boolean) => void
  ): () => void {
    return feeStructureRepository.subscribeToFeeStructure(schoolId, academicYear, async (raw) => {
      if (raw) {
        callback(normalizeFeeStructure(raw, classLabels), false);
        return;
      }

      const seed = await feeStructureRepository.getMostRecentFeeStructure(schoolId, academicYear);
      callback(normalizeFeeStructure(seed, classLabels), seed !== null);
    });
  }

  /**
   * ----------------------------------------------------
   * One-time, normalized read for a specific academic year — e.g.
   * computing a single invoice at admission-enrollment time, where a
   * live subscription isn't needed. `classLabels` only needs to
   * include the class actually being looked up; normalization builds
   * one entry per label given.
   *
   * Does NOT copy-forward/seed — admission-time invoice computation
   * should reflect exactly what's saved for that year, nothing
   * implicit. Seeding is a `settings/fees` editing-UX concern only.
   * ----------------------------------------------------
   */
  async getFeeStructure(schoolId: string, academicYear: string, classLabels: string[]): Promise<FeeStructureDoc> {
    const raw = await feeStructureRepository.getFeeStructure(schoolId, academicYear);
    return normalizeFeeStructure(raw, classLabels);
  }

  /**
   * ----------------------------------------------------
   * Persists the fee structure for a specific academic year.
   *
   * Config data, not a money movement — direct write is correct here
   * per the CRUD-vs-Cloud-Function rule (contrast with
   * FinanceService.recordPayment, which is a stub).
   * ----------------------------------------------------
   */
  async saveFeeStructure(schoolId: string, academicYear: string, data: FeeStructureDoc): Promise<void> {
    await feeStructureRepository.saveFeeStructure(schoolId, academicYear, { ...data });
  }
}

export const feeStructureService = new FeeStructureService();