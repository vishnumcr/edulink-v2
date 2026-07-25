/**
 * --------------------------------------------------------------------
 * File:
 * types/calendar.ts
 *
 * Purpose:
 * Shared types for the Academic Calendar — a school-wide, reusable
 * source of truth for "is this date a working day, and what's it
 * called if not." Three normalized Firestore collections remain the
 * editable SOURCE OF TRUTH:
 *
 *   schools/{schoolId}/academicCalendar/{academicYear}
 *     One document per academic year: the year's own start/end dates
 *     and its terms/semesters. Keyed by the academic year string
 *     (e.g. "2025-26" — the same string SchoolProfile.currentAcademicYear
 *     already uses) rather than a singleton config doc, on purpose:
 *     a school's calendar from last year shouldn't be overwritten the
 *     moment a new academic year starts, and a school should be able
 *     to look back at (or set up next year's) calendar without losing
 *     the current one.
 *
 *   schools/{schoolId}/calendarDays/{date}
 *     One document per EXCEPTION date, not one document per day of
 *     the year. The default weekly pattern (Monday–Friday working,
 *     Saturday/Sunday not) is implicit and never stored — only dates
 *     that deviate from it get a document here.
 *
 *   schools/{schoolId}/calendarEvents/{eventId}
 *     Auto-ID-shaped documents (ID generated client-side — see
 *     calendarRepository.saveEvent — so it can be written into the
 *     snapshot's dotted-path update in the same batch) for things
 *     worth marking on a calendar that have NOTHING to do with
 *     whether school is in session that day.
 *
 * A FOURTH document is the disposable READ MODEL every consumer
 * actually reads from — see CalendarSnapshot below. It is rebuilt
 * atomically (same batch/transaction) on every write to the
 * collections above; nothing ever reads calendarDays/calendarEvents
 * directly except the write paths themselves. See
 * calendarService.getSnapshot for the read-side workflow.
 * --------------------------------------------------------------------
 */

/**
 * Bump this whenever CalendarSnapshot's SHAPE changes (not its data).
 * calendarService compares a cached snapshot's own schemaVersion
 * against this constant and discards the cache on mismatch — even if
 * the cached `version` counter happens to still match, an old cached
 * document built under a previous shape shouldn't be trusted just
 * because nothing mutated it since. This is what makes a future
 * structural change (e.g. changing what a year entry contains) safe
 * to ship without also writing a data migration for every existing
 * cached copy sitting in someone's browser.
 */
export const CALENDAR_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * ------------------------------------------------------------------
 * One term/semester's date range within an academic year. Deliberately
 * NOT the same concept as ExamTerm (types/results.ts) — that's a
 * school's exam structure (FA1/SA1/Finals, tied to subjects and
 * marks); this is just a labeled date range on the calendar (e.g.
 * "Term 1: Apr 1 – Sep 30") with nothing to do with exams at all.
 * ------------------------------------------------------------------
 */
export interface AcademicTerm {
  id: string;
  name: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
}

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/academicCalendar/{academicYear}
 * ------------------------------------------------------------------
 */
export interface AcademicCalendarYear {
  schoolId: string;
  academicYear: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  terms: AcademicTerm[];
  /** Optimistic-concurrency counter — same pattern as WeeklyTimetable.version; see calendarRepository.saveAcademicYear. */
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export type CalendarDayType = "holiday" | "working_day";

/** Only meaningful when type is "holiday" — a government-mandated holiday vs. one the school itself declared (festival break, founder's day, an emergency closure). */
export type HolidayCategory = "public" | "school";

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/calendarDays/{date}
 *
 * One exception to the default Monday–Friday working week:
 *   - type "holiday": this date is NOT a working day, even though the
 *     default pattern says it would be (or it's a "holiday" declared
 *     on top of an already-non-working Saturday — redundant but
 *     harmless). `category` distinguishes a public holiday from a
 *     school-declared one (which covers festival breaks AND ad-hoc
 *     emergency closures — a snow day is just a school holiday with
 *     a specific label, not a fourth type).
 *   - type "working_day": this date (normally a non-working Saturday)
 *     IS a working day — a makeup day for a declared holiday
 *     elsewhere in the term, for instance.
 * ------------------------------------------------------------------
 */
export interface CalendarDayOverride {
  date: string; // "YYYY-MM-DD" — also the Firestore doc ID
  academicYear: string;
  type: CalendarDayType;
  category?: HolidayCategory;
  label: string;
  notes?: string;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}

/** date -> override, for every exception date in one academic year. See calendarService.getWorkingDayOverrides. */
export type CalendarDayOverrideMap = Record<string, CalendarDayOverride>;

/** What calendarService.getDayInfo resolves a single date down to — the thing every consuming module (Attendance today, Timetable/Dashboard later) actually wants to know. */
export interface WorkingDayInfo {
  date: string;
  isWorkingDay: boolean;
  /** Present only when this date is an exception — absent means "just an ordinary Mon–Fri/Sat/Sun, no override on file." */
  override?: CalendarDayOverride;
}

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/calendarEvents/{eventId}
 *
 * Purely informational — never consulted by isWorkingDay. An exam
 * period doesn't cancel school; a sports day doesn't either. Kept as
 * a small fixed category set rather than free text so a future
 * calendar view can color-code and filter by it without a school
 * having typed a dozen inconsistent spellings of "PTM."
 * ------------------------------------------------------------------
 */
export type CalendarEventCategory = "exam" | "ptm" | "function" | "sports" | "other";

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // same as startDate for a single-day event
  category: CalendarEventCategory;
  academicYear: string;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}

/** Shape submitted from the add/edit-event dialog. */
export interface CalendarEventFormValues {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  category: CalendarEventCategory;
}