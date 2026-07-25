/**
 * --------------------------------------------------------------------
 * File:
 * services/timetable/timingsService.ts
 *
 * Purpose:
 * Business logic for the shared master timings clock.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into well-formed TimingSlot[],
 *    defaulting to a sensible starter schedule for a school that
 *    hasn't configured one yet
 * ✅ Tell callers whether those slots are the school's own SAVED
 *    config or just the unsaved DEFAULT_TIMINGS preview — see
 *    TimingsResult below. Collapsing this distinction away (the
 *    previous shape of this method) is what let a brand-new school
 *    silently build a real timetable against slot IDs that were never
 *    actually persisted anywhere — see the Timetable page's own
 *    empty-state comment for what that caused.
 * ✅ Validate before persisting
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Parse or validate start/end as real time values — they're
 *    free-text display strings (e.g. "09:00 AM"), matching how the
 *    Timetable feature actually uses them: period ORDER comes from
 *    each slot's position in this array, never from parsing the time
 *    text. Adding real time parsing/validation here would constrain
 *    a field nothing downstream actually needs constrained.
 * --------------------------------------------------------------------
 */

import { timingsRepository } from "@/repositories/timetable/timingsRepository";
import { TimingSlot, TimingSlotType } from "@/types/timetable";

export type { TimingSlot, TimingSlotType };

export interface TimingsResult {
  slots: TimingSlot[];
  /**
   * False means `slots` is DEFAULT_TIMINGS — a preview, not this
   * school's actual saved configuration. Callers that let staff BUILD
   * on top of this data (e.g. the Timetable page assigning subjects/
   * teachers to slot IDs) must gate on this, not on `slots.length`,
   * since slots is never empty either way.
   */
  isConfigured: boolean;
}

/**
 * A reasonable starter schedule — shown until a school saves their
 * own. Not written to Firestore automatically; the school still has
 * to hit Save at least once, same as every other "empty" default
 * elsewhere in this app (e.g. emptyFeeStructure).
 */
const DEFAULT_TIMINGS: TimingSlot[] = [
  { id: "1", label: "Period 1", start: "09:00 AM", end: "09:40 AM", type: "class" },
  { id: "2", label: "Period 2", start: "09:40 AM", end: "10:20 AM", type: "class" },
  { id: "3", label: "Short Break", start: "10:20 AM", end: "10:35 AM", type: "break" },
  { id: "4", label: "Period 3", start: "10:35 AM", end: "11:15 AM", type: "class" },
  { id: "5", label: "Period 4", start: "11:15 AM", end: "11:55 AM", type: "class" },
  { id: "6", label: "Lunch Break", start: "12:35 PM", end: "01:10 PM", type: "lunch" },
  { id: "7", label: "Period 5", start: "01:10 PM", end: "01:50 PM", type: "class" },
  { id: "8", label: "Period 6", start: "01:50 PM", end: "02:30 PM", type: "class" },
];

function normalizeSlot(raw: Record<string, unknown>): TimingSlot {
  return {
    id: (raw.id as string) || crypto.randomUUID(),
    label: (raw.label as string) || "",
    start: (raw.start as string) || "",
    end: (raw.end as string) || "",
    type: ((raw.type as TimingSlotType) || "class"),
  };
}

export class TimingsService {
  subscribeToTimings(
    schoolId: string,
    callback: (result: TimingsResult) => void
  ): () => void {
    return timingsRepository.subscribeToTimings(schoolId, (data) => {
      const rawSlots = (data?.slots as Record<string, unknown>[]) ?? null;
      callback(
        rawSlots
          ? { slots: rawSlots.map(normalizeSlot), isConfigured: true }
          : { slots: DEFAULT_TIMINGS, isConfigured: false }
      );
    });
  }

  defaultTimings(): TimingSlot[] {
    return DEFAULT_TIMINGS;
  }

  private validate(slots: TimingSlot[]): string | null {
    if (slots.length === 0) return "Add at least one period, break, or lunch slot.";
    if (slots.every((s) => s.type !== "class")) return "Add at least one class period.";
    if (slots.some((s) => !s.label.trim())) return "Every slot needs a label.";
    if (slots.some((s) => !s.start.trim() || !s.end.trim())) return "Every slot needs a start and end time.";
    return null;
  }

  async saveTimings(schoolId: string, slots: TimingSlot[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = this.validate(slots);
    if (error) return { ok: false, error };

    await timingsRepository.saveTimings(schoolId, slots as unknown as Record<string, unknown>[]);
    return { ok: true };
  }
}

export const timingsService = new TimingsService();