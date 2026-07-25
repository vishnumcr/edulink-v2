/**
 * --------------------------------------------------------------------
 * File:
 * repositories/calendar/calendarRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for the Academic Calendar —
 * schools/{schoolId}/academicCalendar/{academicYear}, schools/
 * {schoolId}/calendarDays/{date}, and schools/{schoolId}/
 * calendarEvents/{eventId}. Config/reference data scoped to a school
 * the caller already has permission to touch — plain CRUD, fine
 * directly through the client SDK, same reasoning as timingsRepository/
 * timetableRepository.
 *
 * Responsibilities:
 * ✅ One-time read/write of one academic year's start/end/terms, with
 *    optimistic concurrency (same pattern as timetableRepository.saveTimetable)
 * ✅ One-time read of every calendarDays exception in one academic
 *    year, or a single date's override by ID
 * ✅ Read schools/{schoolId}/config/calendarMeta — a tiny per-year
 *    watermark doc bumped on every calendarDays write, so callers can
 *    tell "has anything in this year's exceptions changed" without
 *    reading the whole calendarDays collection. See
 *    calendarService.getWorkingDayOverrides for how this is used.
 * ✅ CRUD for calendarEvents
 *
 * Does NOT:
 * ❌ Validate form input, or decide what counts as a working day
 *    (that's the service)
 * ❌ Use onSnapshot anywhere. Same reasoning as timetableRepository:
 *    this is read constantly, written rarely, so one-time reads plus
 *    local caching (see calendarCache.ts) instead of a live listener.
 * --------------------------------------------------------------------
 */

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface SaveConflictResult {
  ok: false;
  reason: "conflict";
}
export interface SaveYearSuccessResult {
  ok: true;
  doc: RawDoc;
}
export type SaveAcademicYearResult = SaveYearSuccessResult | SaveConflictResult;

export interface DayOverrideInput {
  type: "holiday" | "working_day";
  category?: "public" | "school";
  label: string;
  notes?: string;
}

export class CalendarRepository {
  private yearDocRef(schoolId: string, academicYear: string) {
    return doc(db, "schools", schoolId, "academicCalendar", academicYear);
  }

  private dayDocRef(schoolId: string, date: string) {
    return doc(db, "schools", schoolId, "calendarDays", date);
  }

  private metaDocRef(schoolId: string) {
    return doc(db, "schools", schoolId, "config", "calendarMeta");
  }

  private eventsCollectionRef(schoolId: string) {
    return collection(db, "schools", schoolId, "calendarEvents");
  }

  // ── Academic year (start/end/terms) ─────────────────────────────────────

  async getAcademicYear(schoolId: string, academicYear: string): Promise<RawDoc | null> {
    const snapshot = await getDoc(this.yearDocRef(schoolId, academicYear));
    return snapshot.exists() ? { id: snapshot.id, data: snapshot.data() } : null;
  }

  /**
   * Same optimistic-concurrency shape as timetableRepository.saveTimetable:
   * read the current version inside a transaction, reject a stale
   * `expectedVersion`, otherwise write and increment. See that method's
   * doc comment for the full reasoning — identical here.
   */
  async saveAcademicYear(
    schoolId: string,
    academicYear: string,
    fields: { startDate: string; endDate: string; terms: { id: string; name: string; startDate: string; endDate: string }[] },
    expectedVersion: number,
    updatedBy: string
  ): Promise<SaveAcademicYearResult> {
    const ref = this.yearDocRef(schoolId, academicYear);

    const outcome = await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      const currentVersion = snapshot.exists() ? ((snapshot.data().version as number) ?? 0) : 0;

      if (currentVersion !== expectedVersion) {
        return { ok: false as const };
      }

      tx.set(ref, {
        schoolId,
        academicYear,
        startDate: fields.startDate,
        endDate: fields.endDate,
        terms: fields.terms,
        version: currentVersion + 1,
        updatedAt: serverTimestamp(),
        updatedBy,
      });

      return { ok: true as const };
    });

    if (!outcome.ok) {
      return { ok: false, reason: "conflict" };
    }

    const saved = await this.getAcademicYear(schoolId, academicYear);
    return { ok: true, doc: saved! };
  }

  // ── Day overrides (holidays / working-day overrides) ────────────────────

  async getDayOverrides(schoolId: string, academicYear: string): Promise<RawDoc[]> {
    const q = query(
      collection(db, "schools", schoolId, "calendarDays"),
      where("academicYear", "==", academicYear)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }

  async getDayOverride(schoolId: string, date: string): Promise<RawDoc | null> {
    const snapshot = await getDoc(this.dayDocRef(schoolId, date));
    return snapshot.exists() ? { id: snapshot.id, data: snapshot.data() } : null;
  }

  /** The per-year watermark doc — `{ [academicYear]: Timestamp }`. Missing entirely, or missing a given year's field, both just mean "no exceptions have ever been saved for that year yet." */
  async getCalendarMeta(schoolId: string): Promise<Record<string, unknown> | null> {
    const snapshot = await getDoc(this.metaDocRef(schoolId));
    return snapshot.exists() ? snapshot.data() : null;
  }

  /**
   * Upserts one date's override and bumps that academic year's
   * watermark in the same batch, so a cache checking the watermark
   * can never observe "changed" without the underlying data actually
   * being there yet (or vice versa).
   */
  async saveDayOverride(
    schoolId: string,
    date: string,
    academicYear: string,
    input: DayOverrideInput,
    updatedBy: string
  ): Promise<void> {
    const ref = this.dayDocRef(schoolId, date);
    const existing = await getDoc(ref);

    const payload: Record<string, unknown> = {
      date,
      academicYear,
      type: input.type,
      label: input.label,
      category: input.category ?? deleteField(),
      notes: input.notes ?? deleteField(),
      updatedBy,
      updatedAt: serverTimestamp(),
    };
    if (!existing.exists()) {
      payload.createdBy = updatedBy;
      payload.createdAt = serverTimestamp();
    }

    const batch = writeBatch(db);
    batch.set(ref, payload, { merge: true });
    batch.set(this.metaDocRef(schoolId), { [academicYear]: serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  /**
   * Same upsert as saveDayOverride, but for N consecutive dates in one
   * batch — what a multi-day festival break (Dasara, Sankranthi) needs
   * instead of adding the same holiday one date at a time. Still one
   * document per date (see this file's own header comment on why:
   * O(1) single-date lookups for the teacher app) — this is a
   * convenience for the WRITE, not a new storage shape. A single
   * Firestore batch caps at 500 writes; even a generous multi-week
   * festival break is nowhere near that, so no chunking needed.
   *
   * Reads every date's existing doc first (in parallel) so createdBy/
   * createdAt is preserved for any date in the range that already had
   * an override on file — same care saveDayOverride already takes for
   * a single date, kept consistent here rather than silently dropped
   * for the bulk path.
   */
  async saveDayOverrideRange(
    schoolId: string,
    dates: string[],
    academicYear: string,
    input: DayOverrideInput,
    updatedBy: string
  ): Promise<void> {
    const refs = dates.map((date) => this.dayDocRef(schoolId, date));
    const existingSnaps = await Promise.all(refs.map((ref) => getDoc(ref)));

    const batch = writeBatch(db);
    dates.forEach((date, i) => {
      const payload: Record<string, unknown> = {
        date,
        academicYear,
        type: input.type,
        label: input.label,
        category: input.category ?? deleteField(),
        notes: input.notes ?? deleteField(),
        updatedBy,
        updatedAt: serverTimestamp(),
      };
      if (!existingSnaps[i].exists()) {
        payload.createdBy = updatedBy;
        payload.createdAt = serverTimestamp();
      }
      batch.set(refs[i], payload, { merge: true });
    });
    batch.set(this.metaDocRef(schoolId), { [academicYear]: serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  async deleteDayOverride(schoolId: string, date: string, academicYear: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(this.dayDocRef(schoolId, date));
    batch.set(this.metaDocRef(schoolId), { [academicYear]: serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  // ── Events (exams, PTMs, functions — informational only) ────────────────

  async getEvents(schoolId: string, academicYear: string): Promise<RawDoc[]> {
    const q = query(this.eventsCollectionRef(schoolId), where("academicYear", "==", academicYear));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }

  async saveEvent(
    schoolId: string,
    eventId: string | null,
    academicYear: string,
    fields: { title: string; description?: string; startDate: string; endDate: string; category: string },
    updatedBy: string
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      title: fields.title,
      description: fields.description ?? deleteField(),
      startDate: fields.startDate,
      endDate: fields.endDate,
      category: fields.category,
      academicYear,
      updatedBy,
      updatedAt: serverTimestamp(),
    };

    if (eventId) {
      await updateDoc(doc(db, "schools", schoolId, "calendarEvents", eventId), payload);
      return eventId;
    }

    payload.createdBy = updatedBy;
    payload.createdAt = serverTimestamp();
    const created = await addDoc(this.eventsCollectionRef(schoolId), payload);
    return created.id;
  }

  async deleteEvent(schoolId: string, eventId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "calendarEvents", eventId));
  }
}

export const calendarRepository = new CalendarRepository();