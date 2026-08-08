/**
 * --------------------------------------------------------------------
 * File:
 * repositories/calendar/calendarRepository.ts
 *
 * Purpose:
 * The only place that talks to Supabase for the Academic Calendar —
 * academic_years, calendar_day_overrides, and calendar_events (see
 * supabase/migrations/0001_academic_calendar.sql). This used to be a
 * thin Firestore CRUD wrapper; the calendar moved to Supabase because
 * it's read on every parent-app open and written a handful of times a
 * year, and Firestore bills per document read for that. Supabase is
 * now the SOURCE OF TRUTH for this data — nothing calendar-related
 * lives in Firestore anymore.
 *
 * Responsibilities:
 * ✅ One-time read/write of one academic year's start/end/terms, with
 *    optimistic concurrency via the save_academic_year RPC (same
 *    reject-a-stale-version semantics the old Firestore transaction had)
 * ✅ Read every calendar_day_overrides exception in one academic year,
 *    or a single date's override by ID
 * ✅ CRUD for calendar_events
 *
 * Does NOT:
 * ❌ Validate form input, or decide what counts as a working day
 *    (that's the service)
 * ❌ Do any local caching/delta-sync — that Firestore-specific trick
 *    (see the old calendarCache.ts) existed only to dodge Firestore's
 *    per-document read cost, which doesn't apply here. calendarService
 *    just calls this repository directly on every read now.
 * --------------------------------------------------------------------
 */

import { supabase } from "@/lib/supabase";

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

/** Postgres error code we raise ourselves (`raise exception ... using errcode = 'P0001'`) for a stale expected version. See save_academic_year in the migration. */
const VERSION_CONFLICT_MESSAGE = "version_conflict";

export class CalendarRepository {
  // ── Academic year (start/end/terms) ─────────────────────────────────────

  async getAcademicYear(schoolId: string, academicYear: string): Promise<RawDoc | null> {
    const { data, error } = await supabase
      .from("academic_years")
      .select("*")
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear)
      .maybeSingle();

    if (error) throw error;
    return data ? { id: data.academic_year as string, data } : null;
  }

  /**
   * Same optimistic-concurrency shape as the old Firestore transaction:
   * reject a stale `expectedVersion`, otherwise write and increment.
   * The row lock + version check both happen inside save_academic_year
   * itself, so this is atomic even under concurrent saves.
   */
  async saveAcademicYear(
    schoolId: string,
    academicYear: string,
    fields: { startDate: string; endDate: string; terms: { id: string; name: string; startDate: string; endDate: string }[] },
    expectedVersion: number,
    updatedBy: string
  ): Promise<SaveAcademicYearResult> {
    const { data, error } = await supabase.rpc("save_academic_year", {
      p_school_id: schoolId,
      p_academic_year: academicYear,
      p_start_date: fields.startDate,
      p_end_date: fields.endDate,
      p_terms: fields.terms,
      p_expected_version: expectedVersion,
      p_updated_by: updatedBy,
    });

    if (error) {
      if (error.message.includes(VERSION_CONFLICT_MESSAGE)) {
        return { ok: false, reason: "conflict" };
      }
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, doc: { id: row.academic_year as string, data: row } };
  }

  // ── Day overrides (holidays / working-day overrides) ────────────────────

  async getDayOverrides(schoolId: string, academicYear: string): Promise<RawDoc[]> {
    const { data, error } = await supabase
      .from("calendar_day_overrides")
      .select("*")
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear);

    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.date as string, data: row }));
  }

  async getDayOverride(schoolId: string, date: string): Promise<RawDoc | null> {
    const { data, error } = await supabase
      .from("calendar_day_overrides")
      .select("*")
      .eq("school_id", schoolId)
      .eq("date", date)
      .maybeSingle();

    if (error) throw error;
    return data ? { id: data.date as string, data } : null;
  }

  /** Upserts one date's override via the same RPC saveDayOverrideRange uses, with a single-element array. */
  async saveDayOverride(
    schoolId: string,
    date: string,
    academicYear: string,
    input: DayOverrideInput,
    updatedBy: string
  ): Promise<void> {
    await this.saveDayOverrideRange(schoolId, [date], academicYear, input, updatedBy);
  }

  /**
   * Same upsert as saveDayOverride, but for N consecutive dates in one
   * call — what a multi-day festival break (Dasara, Sankranthi) needs
   * instead of adding the same holiday one date at a time. The RPC
   * preserves created_by/created_at for any date that already had a
   * row on file, same care the single-date path takes.
   */
  async saveDayOverrideRange(
    schoolId: string,
    dates: string[],
    academicYear: string,
    input: DayOverrideInput,
    updatedBy: string
  ): Promise<void> {
    const { error } = await supabase.rpc("upsert_calendar_day_overrides", {
      p_school_id: schoolId,
      p_dates: dates,
      p_academic_year: academicYear,
      p_type: input.type,
      p_category: input.category ?? null,
      p_label: input.label,
      p_notes: input.notes ?? null,
      p_updated_by: updatedBy,
    });

    if (error) throw error;
  }

  async deleteDayOverride(schoolId: string, date: string): Promise<void> {
    const { error } = await supabase
      .from("calendar_day_overrides")
      .delete()
      .eq("school_id", schoolId)
      .eq("date", date);

    if (error) throw error;
  }

  // ── Events (exams, PTMs, functions — informational only) ────────────────

  async getEvents(schoolId: string, academicYear: string): Promise<RawDoc[]> {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("school_id", schoolId)
      .eq("academic_year", academicYear);

    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id as string, data: row }));
  }

  async saveEvent(
    schoolId: string,
    eventId: string | null,
    academicYear: string,
    fields: { title: string; description?: string; startDate: string; endDate: string; category: string },
    updatedBy: string
  ): Promise<string> {
    if (eventId) {
      const { error } = await supabase
        .from("calendar_events")
        .update({
          title: fields.title,
          description: fields.description ?? null,
          start_date: fields.startDate,
          end_date: fields.endDate,
          category: fields.category,
          academic_year: academicYear,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId)
        .eq("school_id", schoolId);

      if (error) throw error;
      return eventId;
    }

    const { data, error } = await supabase
      .from("calendar_events")
      .insert({
        school_id: schoolId,
        title: fields.title,
        description: fields.description ?? null,
        start_date: fields.startDate,
        end_date: fields.endDate,
        category: fields.category,
        academic_year: academicYear,
        created_by: updatedBy,
        updated_by: updatedBy,
      })
      .select("id")
      .single();

    if (error) throw error;
    return data.id as string;
  }

  async deleteEvent(schoolId: string, eventId: string): Promise<void> {
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", eventId)
      .eq("school_id", schoolId);

    if (error) throw error;
  }
}

export const calendarRepository = new CalendarRepository();
