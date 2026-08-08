/**
 * --------------------------------------------------------------------
 * File:
 * services/calendar/calendarService.ts
 *
 * Purpose:
 * Business logic for the Academic Calendar. This is the reusable
 * module other features are meant to consume — today that's just
 * Attendance (via isWorkingDay/getDayInfo), but it's written to be
 * the single source of truth any future module (Timetable, Dashboard,
 * a parent-facing calendar) can ask "is this date a working day, and
 * why not" without re-implementing the weekly-pattern-plus-exceptions
 * logic itself.
 *
 * Responsibilities:
 * ✅ Normalize raw Supabase rows into well-formed AcademicCalendarYear
 *    / CalendarDayOverride / CalendarEvent values
 * ✅ Save the year's start/end/terms with optimistic concurrency,
 *    surfacing a friendly error on a version conflict (same pattern
 *    as timetableService.saveDay)
 * ✅ Fetch a year's day overrides straight from Supabase — no cache
 *    layer, see the note below
 * ✅ isWorkingDay / getDayInfo — the actual "should this day count"
 *    resolution logic: Monday–Friday are working by default, Saturday/
 *    Sunday aren't, and an exception on file always wins over the
 *    default. This is the one piece of logic every consumer needs and
 *    none of them should reimplement.
 * ✅ Validate a day override (holiday needs a label; a "working day"
 *    override is only meaningful on a date the default pattern
 *    already treats as non-working) and an event (title + valid range)
 *    before either reaches Supabase
 *
 * Does NOT:
 * ❌ Call Supabase directly (that's the repository's job)
 * ❌ Cache anything locally. The old IndexedDB delta-sync (calendarCache.ts,
 *    now removed) existed only to dodge Firestore's per-document read
 *    billing on a whole-collection scan — Postgres doesn't bill that
 *    way, and a single `select` already returns a year's worth of
 *    exceptions in one round trip, so there's nothing left to
 *    optimize around here.
 * ❌ Enforce anything against attendance itself — this only answers
 *    "is this a working day"; it's up to each write path (the teacher
 *    app, when it exists; this project's own attendance page for
 *    display) to act on that answer.
 * --------------------------------------------------------------------
 */

import { calendarRepository, RawDoc } from "@/repositories/calendar/calendarRepository";
import {
  AcademicCalendarYear,
  AcademicTerm,
  CalendarDayOverride,
  CalendarDayOverrideMap,
  CalendarDayType,
  CalendarEvent,
  CalendarEventCategory,
  CalendarEventFormValues,
  HolidayCategory,
  WorkingDayInfo,
} from "@/types/calendar";

const YEAR_CONFLICT_MESSAGE = "This calendar was modified by another user. Please reload before saving.";

/** Supabase's timestamptz columns come back as ISO strings; date columns come back as "YYYY-MM-DD" already, so only timestamp fields ever pass through here. */
function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** Monday(1)–Friday(5) working by default; Saturday(6)/Sunday(0) not — before any exception is applied. */
function isDefaultWorkingWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day >= 1 && day <= 5;
}

/** Local-date "YYYY-MM-DD", NOT via toISOString() — that converts to
 * UTC first, which silently shifts the date for any timezone ahead of
 * UTC (IST is UTC+5:30, so midnight IST becomes the PREVIOUS day in
 * UTC). A holiday landing on the wrong date is exactly the kind of
 * bug that only shows up for real users, never in a UTC-based test
 * environment — using local getters here keeps this consistent with
 * how the date was constructed in the first place. */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Every "YYYY-MM-DD" date from start to end, inclusive — including
 * weekends, since a multi-day festival break covers every calendar
 * day in it, not just weekdays (the point is to override the default
 * pattern entirely for that stretch, weekends included).
 */
function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function emptyAcademicYear(schoolId: string, academicYear: string): AcademicCalendarYear {
  return {
    schoolId,
    academicYear,
    startDate: "",
    endDate: "",
    terms: [],
    version: 0,
    updatedAt: 0,
    updatedBy: "",
  };
}

function normalizeTerm(raw: Record<string, unknown>): AcademicTerm {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || "",
    startDate: (raw.startDate as string) || "",
    endDate: (raw.endDate as string) || "",
  };
}

function normalizeAcademicYear(
  raw: RawDoc,
  fallback: { schoolId: string; academicYear: string }
): AcademicCalendarYear {
  const d = raw.data;
  const rawTerms = (d.terms as Record<string, unknown>[]) || [];
  return {
    schoolId: (d.school_id as string) || fallback.schoolId,
    academicYear: (d.academic_year as string) || fallback.academicYear,
    startDate: (d.start_date as string) || "",
    endDate: (d.end_date as string) || "",
    terms: rawTerms.map(normalizeTerm),
    version: (d.version as number) ?? 0,
    updatedAt: toMillis(d.updated_at),
    updatedBy: (d.updated_by as string) || "",
  };
}

function normalizeDayOverride(raw: RawDoc): CalendarDayOverride {
  const d = raw.data;
  return {
    date: (d.date as string) || raw.id,
    academicYear: (d.academic_year as string) || "",
    type: ((d.type as string) === "working_day" ? "working_day" : "holiday") as CalendarDayType,
    category: d.category as HolidayCategory | undefined,
    label: (d.label as string) || "",
    notes: (d.notes as string) || undefined,
    createdBy: (d.created_by as string) || "",
    createdAt: toMillis(d.created_at),
    updatedBy: (d.updated_by as string) || "",
    updatedAt: toMillis(d.updated_at),
  };
}

function normalizeEvent(raw: RawDoc): CalendarEvent {
  const d = raw.data;
  return {
    id: raw.id,
    title: (d.title as string) || "",
    description: (d.description as string) || undefined,
    startDate: (d.start_date as string) || "",
    endDate: (d.end_date as string) || (d.start_date as string) || "",
    category: ((d.category as string) || "other") as CalendarEventCategory,
    academicYear: (d.academic_year as string) || "",
    createdBy: (d.created_by as string) || "",
    createdAt: toMillis(d.created_at),
    updatedBy: (d.updated_by as string) || "",
    updatedAt: toMillis(d.updated_at),
  };
}

export class CalendarService {
  // ── Academic year (start/end/terms) ─────────────────────────────────────

  async getAcademicYear(schoolId: string, academicYear: string): Promise<AcademicCalendarYear> {
    const raw = await calendarRepository.getAcademicYear(schoolId, academicYear);
    return raw ? normalizeAcademicYear(raw, { schoolId, academicYear }) : emptyAcademicYear(schoolId, academicYear);
  }

  async saveAcademicYear(
    schoolId: string,
    updatedBy: string,
    current: AcademicCalendarYear,
    fields: { startDate: string; endDate: string; terms: AcademicTerm[] }
  ): Promise<{ ok: true; year: AcademicCalendarYear } | { ok: false; error: string }> {
    if (!fields.startDate || !fields.endDate) {
      return { ok: false, error: "Set both a start and end date for the academic year." };
    }
    if (fields.startDate > fields.endDate) {
      return { ok: false, error: "The academic year's start date must be before its end date." };
    }
    for (const term of fields.terms) {
      if (!term.name.trim()) return { ok: false, error: "Every term needs a name." };
      if (!term.startDate || !term.endDate) return { ok: false, error: `Set both dates for ${term.name}.` };
      if (term.startDate > term.endDate) return { ok: false, error: `${term.name}'s start date must be before its end date.` };
    }

    const result = await calendarRepository.saveAcademicYear(
      schoolId,
      current.academicYear,
      fields,
      current.version,
      updatedBy
    );

    if (!result.ok) {
      return { ok: false, error: YEAR_CONFLICT_MESSAGE };
    }

    return { ok: true, year: normalizeAcademicYear(result.doc, { schoolId, academicYear: current.academicYear }) };
  }

  // ── Working-day resolution — the reusable core of this module ───────────

  /** Straight read of every exception date in one academic year — see this file's header for why there's no cache layer anymore. */
  async getWorkingDayOverrides(schoolId: string, academicYear: string): Promise<CalendarDayOverrideMap> {
    const rawDocs = await calendarRepository.getDayOverrides(schoolId, academicYear);
    const overrides: CalendarDayOverrideMap = {};
    for (const raw of rawDocs) {
      const override = normalizeDayOverride(raw);
      overrides[override.date] = override;
    }
    return overrides;
  }

  /** Kept for call-site compatibility (used right after this page's own save/delete) — now identical to getWorkingDayOverrides since there's no cache to invalidate. */
  async refreshWorkingDayOverrides(schoolId: string, academicYear: string): Promise<CalendarDayOverrideMap> {
    return this.getWorkingDayOverrides(schoolId, academicYear);
  }

  /**
   * The core resolution: an exception on file always wins; otherwise
   * Monday–Friday are working, Saturday/Sunday aren't. Pure and sync
   * on purpose — every consumer already has the overrides map in hand
   * (from getWorkingDayOverrides) by the time it needs to ask this for
   * a specific date, often for many dates in a row (e.g. rendering a
   * month grid), so this never touches Supabase itself.
   */
  isWorkingDay(date: string, overrides: CalendarDayOverrideMap): boolean {
    const override = overrides[date];
    if (override) return override.type === "working_day";
    return isDefaultWorkingWeekday(date);
  }

  /** Same resolution as isWorkingDay, but returns the override (if any) too — what the Attendance page's holiday banner and any future "why is this a holiday" tooltip actually need. */
  getDayInfo(date: string, overrides: CalendarDayOverrideMap): WorkingDayInfo {
    const override = overrides[date];
    return {
      date,
      isWorkingDay: override ? override.type === "working_day" : isDefaultWorkingWeekday(date),
      override,
    };
  }

  // ── Day overrides (holidays / working-day overrides) ────────────────────

  async saveDayOverride(
    schoolId: string,
    academicYear: string,
    updatedBy: string,
    values: { date: string; type: CalendarDayType; category?: HolidayCategory; label: string; notes?: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!values.date) return { ok: false, error: "Pick a date." };
    if (values.type === "holiday" && !values.label.trim()) {
      return { ok: false, error: "Give this holiday a name." };
    }
    if (values.type === "working_day" && isDefaultWorkingWeekday(values.date)) {
      return { ok: false, error: "That's already a working day — no override needed." };
    }

    await calendarRepository.saveDayOverride(
      schoolId,
      values.date,
      academicYear,
      {
        type: values.type,
        category: values.type === "holiday" ? values.category : undefined,
        label: values.type === "holiday" ? values.label.trim() : values.label.trim() || "Working day",
        notes: values.notes?.trim() || undefined,
      },
      updatedBy
    );

    return { ok: true };
  }

  /**
   * Same validation spirit as saveDayOverride, plus range-specific
   * checks: start must be on/before end, and the range is capped at
   * 60 days — generous for any real festival break (even a long
   * Dasara/Sankranthi stretch), but enough to catch a typo'd end date
   * (e.g. wrong year) before it silently creates months of holiday
   * rows. type is NOT part of the form here — a bulk "working day
   * override" range isn't a real scenario (see saveDayOverride's own
   * check: a working-day override only makes sense on ONE specific
   * already-non-working date), so this only ever saves type "holiday".
   */
  async saveDayOverrideRange(
    schoolId: string,
    academicYear: string,
    updatedBy: string,
    values: { startDate: string; endDate: string; category: HolidayCategory; label: string; notes?: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!values.startDate || !values.endDate) return { ok: false, error: "Pick a start and end date." };
    if (values.startDate > values.endDate) return { ok: false, error: "The start date must be before the end date." };
    if (!values.label.trim()) return { ok: false, error: "Give this holiday a name." };

    const dates = datesBetween(values.startDate, values.endDate);
    if (dates.length > 60) {
      return { ok: false, error: `That's a ${dates.length}-day range — double check the dates.` };
    }

    await calendarRepository.saveDayOverrideRange(
      schoolId,
      dates,
      academicYear,
      {
        type: "holiday",
        category: values.category,
        label: values.label.trim(),
        notes: values.notes?.trim() || undefined,
      },
      updatedBy
    );

    return { ok: true };
  }

  async deleteDayOverride(schoolId: string, academicYear: string, date: string): Promise<void> {
    await calendarRepository.deleteDayOverride(schoolId, date);
  }

  // ── Events (exams, PTMs, functions — informational only) ────────────────

  async listEvents(schoolId: string, academicYear: string): Promise<CalendarEvent[]> {
    const rawDocs = await calendarRepository.getEvents(schoolId, academicYear);
    return rawDocs.map(normalizeEvent).sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async saveEvent(
    schoolId: string,
    academicYear: string,
    updatedBy: string,
    eventId: string | null,
    values: CalendarEventFormValues
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!values.title.trim()) return { ok: false, error: "Give this event a title." };
    if (!values.startDate || !values.endDate) return { ok: false, error: "Set both a start and end date." };
    if (values.startDate > values.endDate) return { ok: false, error: "The start date must be before the end date." };

    await calendarRepository.saveEvent(
      schoolId,
      eventId,
      academicYear,
      {
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        startDate: values.startDate,
        endDate: values.endDate,
        category: values.category,
      },
      updatedBy
    );

    return { ok: true };
  }

  async deleteEvent(schoolId: string, eventId: string): Promise<void> {
    await calendarRepository.deleteEvent(schoolId, eventId);
  }
}

export const calendarService = new CalendarService();
