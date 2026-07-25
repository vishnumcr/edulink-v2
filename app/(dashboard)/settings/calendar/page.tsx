/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/calendar/page.tsx
 *
 * Purpose:
 * Admin editor for the Academic Calendar — the school's academic
 * year/term dates, its holidays and working-day overrides, and its
 * general calendar events. Routes everything through calendarService
 * (normalize/validate/optimistic-concurrency), same pattern as
 * settings/timings — no raw Firestore calls in this component.
 *
 * Three tabs, one Firestore-backed concept each:
 *   Year & Terms      → schools/{schoolId}/academicCalendar/{year}
 *   Holidays & Working Days → schools/{schoolId}/calendarDays/{date}
 *   Events            → schools/{schoolId}/calendarEvents/{id}
 *
 * Attendance is the only other module reading any of this today (see
 * that page's holiday banner) — Holidays & Working Days is the tab
 * that actually matters operationally right now; Events exists ahead
 * of any module consuming it yet, same spirit as Subjects existing
 * before Timetable could reference it.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { schoolService } from "@/services/school/schoolService";
import { calendarService } from "@/services/calendar/calendarService";
import {
  AcademicCalendarYear,
  AcademicTerm,
  CalendarDayOverride,
  CalendarDayOverrideMap,
  CalendarDayType,
  CalendarEvent,
  CalendarEventCategory,
  HolidayCategory,
} from "@/types/calendar";
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  PartyPopper,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import "@/styles/config-calendar.css";

type Tab = "year" | "holidays" | "events";

const EVENT_CATEGORIES: { value: CalendarEventCategory; label: string }[] = [
  { value: "exam", label: "Exam" },
  { value: "ptm", label: "PTM" },
  { value: "function", label: "Function" },
  { value: "sports", label: "Sports" },
  { value: "other", label: "Other" },
];

function weekdayShort(date: string): string {
  if (!date) return "";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}
function dayMonth(date: string): string {
  if (!date) return "";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}
function displayDate(date: string): string {
  if (!date) return "";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** Local date components, NOT toISOString() — same reasoning as
 * calendarService's toDateKey: toISOString() converts to UTC first,
 * which silently shifts the date for IST (UTC+5:30, always ahead of
 * UTC). Building the grid from local getters keeps every cell's key
 * matching what's actually stored for that calendar day. */
function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface MonthCell {
  day: number;
  dateKey: string;
  isWeekend: boolean;
}

/** Leading `null`s pad the grid to align day 1 under its actual weekday. */
function buildMonthCells(year: number, month: number): (MonthCell | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (MonthCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(year, month, day).getDay();
    cells.push({ day, dateKey: toDateKey(year, month, day), isWeekend: weekday === 0 || weekday === 6 });
  }
  return cells;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AcademicCalendarPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [tab, setTab] = useState<Tab>("holidays");
  const [academicYear, setAcademicYear] = useState("");
  const [academicYearLoading, setAcademicYearLoading] = useState(true);

  // ── Year & terms ──────────────────────────────────────────────────────
  const [yearDoc, setYearDoc] = useState<AcademicCalendarYear | null>(null);
  const [yearLoading, setYearLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [yearDirty, setYearDirty] = useState(false);
  const [yearSaving, setYearSaving] = useState(false);
  const [yearSaved, setYearSaved] = useState(false);
  const [yearError, setYearError] = useState("");

  // ── Holidays / working-day overrides ─────────────────────────────────
  const [overrides, setOverrides] = useState<CalendarDayOverrideMap>({});
  const [overridesLoading, setOverridesLoading] = useState(true);

  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState("");
  const [isDayRange, setIsDayRange] = useState(false);
  const [dayEndDate, setDayEndDate] = useState("");
  const [dayType, setDayType] = useState<CalendarDayType>("holiday");
  const [dayCategory, setDayCategory] = useState<HolidayCategory>("school");
  const [dayLabel, setDayLabel] = useState("");
  const [dayNotes, setDayNotes] = useState("");
  const [daySaving, setDaySaving] = useState(false);
  const [dayError, setDayError] = useState("");

  const [deletingDate, setDeletingDate] = useState<string | null>(null);
  const [deletingDayBusy, setDeletingDayBusy] = useState(false);

  // ── Month preview (visual calendar, above the list) ─────────────────
  const [previewMonth, setPreviewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() }; // month: 0–11
  });

  // ── Events ────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evStart, setEvStart] = useState("");
  const [evEnd, setEvEnd] = useState("");
  const [evCategory, setEvCategory] = useState<CalendarEventCategory>("exam");
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState("");

  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [deletingEventBusy, setDeletingEventBusy] = useState(false);

  // ── Load: current academic year (one-time — see schoolService) ────────
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    schoolService.getSchoolProfile(schoolId).then((p) => {
      if (!cancelled) {
        setAcademicYear(p.currentAcademicYear);
        setAcademicYearLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  // ── Load: year doc ──────────────────────────────────────────────────
  useEffect(() => {
    if (!schoolId || !academicYear) return;
    let cancelled = false;
    setYearLoading(true);
    calendarService.getAcademicYear(schoolId, academicYear).then((y) => {
      if (cancelled) return;
      setYearDoc(y);
      setStartDate(y.startDate);
      setEndDate(y.endDate);
      setTerms(y.terms);
      setYearLoading(false);
      setYearDirty(false);
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId, academicYear]);

  // ── Load: day overrides (delta-synced) ─────────────────────────────
  function loadOverrides() {
    if (!schoolId || !academicYear) return;
    setOverridesLoading(true);
    calendarService.getWorkingDayOverrides(schoolId, academicYear).then((map) => {
      setOverrides(map);
      setOverridesLoading(false);
    });
  }
  useEffect(loadOverrides, [schoolId, academicYear]);

  // ── Load: events ─────────────────────────────────────────────────────
  function loadEvents() {
    if (!schoolId || !academicYear) return;
    setEventsLoading(true);
    calendarService.listEvents(schoolId, academicYear).then((list) => {
      setEvents(list);
      setEventsLoading(false);
    });
  }
  useEffect(loadEvents, [schoolId, academicYear]);

  // ── Year & Terms handlers ────────────────────────────────────────────
  function markYearDirty() {
    setYearDirty(true);
    setYearSaved(false);
    setYearError("");
  }
  function addTerm() {
    setTerms((prev) => [...prev, { id: crypto.randomUUID(), name: `Term ${prev.length + 1}`, startDate: "", endDate: "" }]);
    markYearDirty();
  }
  function updateTerm(id: string, field: keyof AcademicTerm, value: string) {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    markYearDirty();
  }
  function removeTerm(id: string) {
    setTerms((prev) => prev.filter((t) => t.id !== id));
    markYearDirty();
  }

  async function saveYear() {
    if (!schoolId || !yearDoc || !profile) return;
    setYearSaving(true);
    setYearError("");
    try {
      const result = await calendarService.saveAcademicYear(schoolId, profile.uid, yearDoc, {
        startDate,
        endDate,
        terms,
      });
      if (!result.ok) {
        setYearError(result.error);
        return;
      }
      setYearDoc(result.year);
      setYearDirty(false);
      setYearSaved(true);
      setTimeout(() => setYearSaved(false), 3000);
    } catch (e) {
      setYearError(e instanceof Error ? e.message : "Failed to save. Please try again.");
    } finally {
      setYearSaving(false);
    }
  }

  // ── Holiday / working-day override handlers ──────────────────────────
  function openAddDay(prefillDate?: string) {
    setEditingDate(null);
    setDayDate(prefillDate ?? "");
    setIsDayRange(false);
    setDayEndDate("");
    setDayType("holiday");
    setDayCategory("school");
    setDayLabel("");
    setDayNotes("");
    setDayError("");
    setDayModalOpen(true);
  }
  function openEditDay(override: CalendarDayOverride) {
    setEditingDate(override.date);
    setDayDate(override.date);
    setIsDayRange(false);
    setDayEndDate("");
    setDayType(override.type);
    setDayCategory(override.category ?? "school");
    setDayLabel(override.label);
    setDayNotes(override.notes ?? "");
    setDayError("");
    setDayModalOpen(true);
  }
  function closeDayModal() {
    setDayModalOpen(false);
  }

  async function saveDay() {
    if (!schoolId || !academicYear || !profile) return;
    setDaySaving(true);
    setDayError("");
    try {
      const result = isDayRange
        ? await calendarService.saveDayOverrideRange(schoolId, academicYear, profile.uid, {
            startDate: dayDate,
            endDate: dayEndDate,
            category: dayCategory,
            label: dayLabel,
            notes: dayNotes,
          })
        : await calendarService.saveDayOverride(schoolId, academicYear, profile.uid, {
            date: dayDate,
            type: dayType,
            category: dayType === "holiday" ? dayCategory : undefined,
            label: dayLabel,
            notes: dayNotes,
          });
      if (!result.ok) {
        setDayError(result.error);
        return;
      }
      const fresh = await calendarService.refreshWorkingDayOverrides(schoolId, academicYear);
      setOverrides(fresh);
      setDayModalOpen(false);
    } catch (e) {
      setDayError(e instanceof Error ? e.message : "Failed to save. Please try again.");
    } finally {
      setDaySaving(false);
    }
  }

  async function confirmDeleteDay() {
    if (!schoolId || !academicYear || !deletingDate) return;
    setDeletingDayBusy(true);
    try {
      await calendarService.deleteDayOverride(schoolId, academicYear, deletingDate);
      const fresh = await calendarService.refreshWorkingDayOverrides(schoolId, academicYear);
      setOverrides(fresh);
      setDeletingDate(null);
    } finally {
      setDeletingDayBusy(false);
    }
  }

  function goPrevMonth() {
    setPreviewMonth((prev) => (prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 }));
  }
  function goNextMonth() {
    setPreviewMonth((prev) => (prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 }));
  }
  function handleMonthCellClick(dateKey: string) {
    const existing = overrides[dateKey];
    if (existing) {
      openEditDay(existing);
    } else {
      openAddDay(dateKey);
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────
  function openAddEvent() {
    setEditingEventId(null);
    setEvTitle("");
    setEvDescription("");
    setEvStart("");
    setEvEnd("");
    setEvCategory("exam");
    setEvError("");
    setEventModalOpen(true);
  }
  function openEditEvent(ev: CalendarEvent) {
    setEditingEventId(ev.id);
    setEvTitle(ev.title);
    setEvDescription(ev.description ?? "");
    setEvStart(ev.startDate);
    setEvEnd(ev.endDate);
    setEvCategory(ev.category);
    setEvError("");
    setEventModalOpen(true);
  }

  async function saveEvent() {
    if (!schoolId || !academicYear || !profile) return;
    setEvSaving(true);
    setEvError("");
    try {
      const result = await calendarService.saveEvent(schoolId, academicYear, profile.uid, editingEventId, {
        title: evTitle,
        description: evDescription,
        startDate: evStart,
        endDate: evEnd || evStart,
        category: evCategory,
      });
      if (!result.ok) {
        setEvError(result.error);
        return;
      }
      loadEvents();
      setEventModalOpen(false);
    } catch (e) {
      setEvError(e instanceof Error ? e.message : "Failed to save. Please try again.");
    } finally {
      setEvSaving(false);
    }
  }

  async function confirmDeleteEvent() {
    if (!schoolId || !deletingEventId) return;
    setDeletingEventBusy(true);
    try {
      await calendarService.deleteEvent(schoolId, deletingEventId);
      loadEvents();
      setDeletingEventId(null);
    } finally {
      setDeletingEventBusy(false);
    }
  }

  const sortedOverrides = Object.values(overrides).sort((a, b) => a.date.localeCompare(b.date));
  const todayKey = (() => {
    const t = new Date();
    return toDateKey(t.getFullYear(), t.getMonth(), t.getDate());
  })();

  // ── No academic year set yet ──────────────────────────────────────────
  if (!academicYearLoading && !academicYear) {
    return (
      <>
        <div className="cfg-content-head">
          <div>
            <div className="cfg-content-title">Academic Calendar</div>
            <div className="cfg-content-sub">Academic year, terms, holidays, and events</div>
          </div>
        </div>
        <div className="cfg-content-body">
          <div className="acal-banner">
            <Info size={15} />
            <span>
              Your school doesn't have a current academic year set yet — that's what the calendar is scoped to.
              It's shown under <strong>Settings → Info</strong> once your account has one.
            </span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cfg-content-head">
        <div>
          <div className="cfg-content-title">Academic Calendar</div>
          <div className="cfg-content-sub">
            {academicYearLoading ? "Loading…" : `Academic year ${academicYear}`}
          </div>
        </div>
      </div>

      <div className="cfg-content-body">
        <div className="acal-tabs">
          <button className={`acal-tab${tab === "year" ? " active" : ""}`} onClick={() => setTab("year")}>
            <Calendar size={14} /> Year & Terms
          </button>
          <button className={`acal-tab${tab === "holidays" ? " active" : ""}`} onClick={() => setTab("holidays")}>
            <PartyPopper size={14} /> Holidays & Working Days
          </button>
          <button className={`acal-tab${tab === "events" ? " active" : ""}`} onClick={() => setTab("events")}>
            <Calendar size={14} /> Events
          </button>
        </div>

        {/* ── Year & Terms ── */}
        {tab === "year" && (
          <>
            <div className="acal-banner">
              <Info size={15} />
              <span>
                The start/end dates just bound this academic year for display and future modules — they don't
                by themselves make any date a holiday. Set holidays and working-day overrides in the next tab.
              </span>
            </div>

            {yearError && (
              <div className="acal-error">
                <AlertCircle size={14} /> {yearError}
              </div>
            )}

            {yearLoading ? (
              [1, 2].map((i) => <div key={i} className="cfg-shimmer" />)
            ) : (
              <>
                <div className="acal-year-grid">
                  <div className="acal-field">
                    <label>Year starts</label>
                    <input
                      type="date"
                      className="acal-input"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        markYearDirty();
                      }}
                    />
                  </div>
                  <div className="acal-field">
                    <label>Year ends</label>
                    <input
                      type="date"
                      className="acal-input"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        markYearDirty();
                      }}
                    />
                  </div>
                </div>

                <div className="acal-section-head">
                  <div>
                    <div className="acal-section-title">Terms</div>
                    <div className="acal-section-sub">Semesters/terms within {academicYear || "this year"}</div>
                  </div>
                </div>

                {terms.length === 0 ? (
                  <div className="acal-term-empty">No terms added yet.</div>
                ) : (
                  terms.map((term) => (
                    <div key={term.id} className="acal-term-row">
                      <input
                        className="acal-input"
                        value={term.name}
                        placeholder="Term name"
                        onChange={(e) => updateTerm(term.id, "name", e.target.value)}
                      />
                      <input
                        type="date"
                        className="acal-input"
                        value={term.startDate}
                        onChange={(e) => updateTerm(term.id, "startDate", e.target.value)}
                      />
                      <input
                        type="date"
                        className="acal-input"
                        value={term.endDate}
                        onChange={(e) => updateTerm(term.id, "endDate", e.target.value)}
                      />
                      <button className="acal-del-btn" onClick={() => removeTerm(term.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
                <button className="acal-add-btn" onClick={addTerm}>
                  <Plus size={13} /> Add Term
                </button>

                <div className="acal-save-bar">
                  <button
                    className={`acal-save-btn${yearSaved ? " saved" : ""}`}
                    disabled={yearSaving || !yearDirty}
                    onClick={saveYear}
                  >
                    {yearSaving ? "Saving…" : yearSaved ? (
                      <>
                        <Check size={14} /> Saved
                      </>
                    ) : (
                      <>
                        <Save size={14} /> Save
                      </>
                    )}
                  </button>
                  {yearDirty && !yearSaved && <span className="cfg-dirty-pill">● Unsaved changes</span>}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Holidays & Working Days ── */}
        {tab === "holidays" && (
          <>
            <div className="acal-banner">
              <Info size={15} />
              <span>
                By default, <strong>Monday–Friday are working days</strong> and Saturday/Sunday aren't — you
                only need an entry here for exceptions: a holiday on a normally-working day, or a working-day
                override on a Saturday. Marking a day a holiday blocks attendance from being taken that day.
              </span>
            </div>

            <div className="acal-month-preview">
              <div className="acal-month-nav">
                <button className="acal-month-nav-btn" onClick={goPrevMonth} aria-label="Previous month">
                  <ChevronLeft size={15} />
                </button>
                <span className="acal-month-label">
                  {new Date(previewMonth.year, previewMonth.month, 1).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <button className="acal-month-nav-btn" onClick={goNextMonth} aria-label="Next month">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="acal-month-grid">
                {WEEKDAY_HEADERS.map((wd) => (
                  <div key={wd} className="acal-month-weekday">
                    {wd}
                  </div>
                ))}
                {buildMonthCells(previewMonth.year, previewMonth.month).map((cell, i) => {
                  if (!cell) return <div key={`pad-${i}`} className="acal-month-cell empty" />;
                  const override = overrides[cell.dateKey];
                  const isToday = cell.dateKey === todayKey;
                  const stateClass = override
                    ? override.type === "working_day"
                      ? "working-day"
                      : override.category === "public"
                        ? "holiday-public"
                        : "holiday-school"
                    : cell.isWeekend
                      ? "weekend"
                      : "";
                  return (
                    <button
                      key={cell.dateKey}
                      className={`acal-month-cell ${stateClass}${isToday ? " today" : ""}`}
                      title={override?.label ?? (cell.isWeekend ? "Weekend" : "Working day")}
                      onClick={() => handleMonthCellClick(cell.dateKey)}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              <div className="acal-month-legend">
                <span><i className="acal-legend-dot holiday-public" /> Public holiday</span>
                <span><i className="acal-legend-dot holiday-school" /> School holiday</span>
                <span><i className="acal-legend-dot working-day" /> Working day override</span>
                <span><i className="acal-legend-dot weekend" /> Weekend</span>
              </div>
            </div>

            <div className="acal-list-head">
              <div className="acal-section-title">{sortedOverrides.length} exception{sortedOverrides.length !== 1 ? "s" : ""}</div>
              <button className="acal-add-btn" onClick={() => openAddDay()}>
                <Plus size={13} /> Add Holiday / Working Day
              </button>
            </div>

            {overridesLoading ? (
              [1, 2, 3].map((i) => <div key={i} className="cfg-shimmer" />)
            ) : sortedOverrides.length === 0 ? (
              <div className="acal-empty">No holidays or working-day overrides added for {academicYear} yet.</div>
            ) : (
              sortedOverrides.map((override) => {
                const rowClass =
                  override.type === "working_day"
                    ? "working-day"
                    : override.category === "public"
                      ? "holiday-public"
                      : "holiday-school";
                return (
                  <div key={override.date} className={`acal-day-row ${rowClass}`}>
                    <div className="acal-day-date">
                      <span className="acal-day-weekday">{weekdayShort(override.date)}</span>
                      {dayMonth(override.date)}
                    </div>
                    <div className="acal-day-info">
                      <span className="acal-day-label">{override.label}</span>
                      {override.notes && <div className="acal-day-notes">{override.notes}</div>}
                    </div>
                    {override.type === "working_day" ? (
                      <span className="acal-badge working">Working Day</span>
                    ) : (
                      <span className={`acal-badge ${override.category === "public" ? "public" : "school"}`}>
                        {override.category === "public" ? "Public Holiday" : "School Holiday"}
                      </span>
                    )}
                    <div className="acal-row-actions">
                      <button className="acal-icon-btn" onClick={() => openEditDay(override)}>
                        <Pencil size={13} />
                      </button>
                      <button className="acal-icon-btn danger" onClick={() => setDeletingDate(override.date)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Events ── */}
        {tab === "events" && (
          <>
            <div className="acal-banner">
              <Info size={15} />
              <span>
                Events are informational only — exams, PTMs, annual day, sports day, other functions. Adding
                one here doesn't affect whether school is in session that day.
              </span>
            </div>

            <div className="acal-list-head">
              <div className="acal-section-title">{events.length} event{events.length !== 1 ? "s" : ""}</div>
              <button className="acal-add-btn" onClick={openAddEvent}>
                <Plus size={13} /> Add Event
              </button>
            </div>

            {eventsLoading ? (
              [1, 2, 3].map((i) => <div key={i} className="cfg-shimmer" />)
            ) : events.length === 0 ? (
              <div className="acal-empty">No events added for {academicYear} yet.</div>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="acal-day-row">
                  <div className="acal-day-date">
                    <span className="acal-day-weekday">{weekdayShort(ev.startDate)}</span>
                    {dayMonth(ev.startDate)}
                    {ev.endDate !== ev.startDate && <> – {dayMonth(ev.endDate)}</>}
                  </div>
                  <div className="acal-day-info">
                    <span className="acal-day-label">{ev.title}</span>
                    {ev.description && <div className="acal-day-notes">{ev.description}</div>}
                  </div>
                  <span className={`acal-badge ${ev.category}`}>{EVENT_CATEGORIES.find((c) => c.value === ev.category)?.label}</span>
                  <div className="acal-row-actions">
                    <button className="acal-icon-btn" onClick={() => openEditEvent(ev)}>
                      <Pencil size={13} />
                    </button>
                    <button className="acal-icon-btn danger" onClick={() => setDeletingEventId(ev.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* ── Add/Edit holiday or working day ── */}
      {dayModalOpen && (
        <div className="acal-overlay" onClick={closeDayModal}>
          <div className="acal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="acal-modal-head">
              <div>
                <div className="acal-modal-title">{editingDate ? "Edit Exception" : "Add Holiday / Working Day"}</div>
                <div className="acal-modal-sub">An exception to the default Monday–Friday working week</div>
              </div>
              <button className="acal-modal-x" onClick={closeDayModal}>
                <X size={13} />
              </button>
            </div>
            <div className="acal-modal-body">
              {dayError && (
                <div className="acal-error">
                  <AlertCircle size={14} /> {dayError}
                </div>
              )}

              <div className="acal-field">
                <label>{isDayRange ? "From" : "Date"}</label>
                <input
                  type="date"
                  className="acal-input"
                  value={dayDate}
                  disabled={!!editingDate}
                  onChange={(e) => setDayDate(e.target.value)}
                />
              </div>

              {!editingDate && (
                <div className="acal-field">
                  <label>Duration</label>
                  <div className="acal-type-toggle">
                    <button
                      className={`acal-type-opt${!isDayRange ? " active" : ""}`}
                      onClick={() => setIsDayRange(false)}
                    >
                      Single day
                    </button>
                    <button
                      className={`acal-type-opt${isDayRange ? " active" : ""}`}
                      onClick={() => {
                        setIsDayRange(true);
                        setDayType("holiday"); // range-add is holidays only — see calendarService.saveDayOverrideRange
                      }}
                    >
                      Multiple days
                    </button>
                  </div>
                  {isDayRange && (
                    <p className="acal-modal-sub" style={{ marginTop: 4 }}>
                      For a consecutive festival break like Dasara or Sankranthi — every date in the
                      range gets the same holiday label.
                    </p>
                  )}
                </div>
              )}

              {isDayRange && (
                <div className="acal-field">
                  <label>To</label>
                  <input
                    type="date"
                    className="acal-input"
                    value={dayEndDate}
                    min={dayDate || undefined}
                    onChange={(e) => setDayEndDate(e.target.value)}
                  />
                </div>
              )}

              {!isDayRange && (
                <div className="acal-field">
                  <label>Type</label>
                  <div className="acal-type-toggle">
                    <button
                      className={`acal-type-opt${dayType === "holiday" ? " active" : ""}`}
                      onClick={() => setDayType("holiday")}
                    >
                      Holiday
                    </button>
                    <button
                      className={`acal-type-opt${dayType === "working_day" ? " active" : ""}`}
                      onClick={() => setDayType("working_day")}
                    >
                      Working Day
                    </button>
                  </div>
                </div>
              )}

              {dayType === "holiday" && (
                <div className="acal-field">
                  <label>Category</label>
                  <select
                    className="acal-select"
                    value={dayCategory}
                    onChange={(e) => setDayCategory(e.target.value as HolidayCategory)}
                  >
                    <option value="public">Public Holiday</option>
                    <option value="school">School Holiday</option>
                  </select>
                </div>
              )}

              <div className="acal-field">
                <label>{dayType === "holiday" ? "Label" : "Reason (optional)"}</label>
                <input
                  className="acal-input"
                  value={dayLabel}
                  placeholder={dayType === "holiday" ? "e.g. Diwali" : "e.g. Makeup day"}
                  onChange={(e) => setDayLabel(e.target.value)}
                />
              </div>

              <div className="acal-field">
                <label>Notes (optional)</label>
                <textarea className="acal-textarea" value={dayNotes} onChange={(e) => setDayNotes(e.target.value)} />
              </div>
            </div>
            <div className="acal-modal-actions">
              <button className="acal-mcancel" onClick={closeDayModal}>
                Cancel
              </button>
              <button
                className="acal-msubmit"
                disabled={!dayDate || (isDayRange && !dayEndDate) || daySaving}
                onClick={saveDay}
              >
                {daySaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete holiday/working-day confirm ── */}
      {deletingDate && (
        <div className="acal-overlay" onClick={() => setDeletingDate(null)}>
          <div className="acal-modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="acal-modal-head">
              <div>
                <div className="acal-modal-title">Remove this exception?</div>
                <div className="acal-modal-sub">
                  {displayDate(deletingDate)} goes back to the default Monday–Friday pattern.
                </div>
              </div>
            </div>
            <div className="acal-modal-actions">
              <button className="acal-mcancel" onClick={() => setDeletingDate(null)}>
                Cancel
              </button>
              <button className="acal-msubmit danger" disabled={deletingDayBusy} onClick={confirmDeleteDay}>
                {deletingDayBusy ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit event ── */}
      {eventModalOpen && (
        <div className="acal-overlay" onClick={() => setEventModalOpen(false)}>
          <div className="acal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="acal-modal-head">
              <div>
                <div className="acal-modal-title">{editingEventId ? "Edit Event" : "Add Event"}</div>
                <div className="acal-modal-sub">Informational only — doesn't affect working-day status</div>
              </div>
              <button className="acal-modal-x" onClick={() => setEventModalOpen(false)}>
                <X size={13} />
              </button>
            </div>
            <div className="acal-modal-body">
              {evError && (
                <div className="acal-error">
                  <AlertCircle size={14} /> {evError}
                </div>
              )}

              <div className="acal-field">
                <label>Title</label>
                <input className="acal-input" value={evTitle} placeholder="e.g. Annual Sports Day" onChange={(e) => setEvTitle(e.target.value)} />
              </div>

              <div className="acal-field">
                <label>Category</label>
                <select className="acal-select" value={evCategory} onChange={(e) => setEvCategory(e.target.value as CalendarEventCategory)}>
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="acal-year-grid">
                <div className="acal-field">
                  <label>Start date</label>
                  <input type="date" className="acal-input" value={evStart} onChange={(e) => setEvStart(e.target.value)} />
                </div>
                <div className="acal-field">
                  <label>End date</label>
                  <input type="date" className="acal-input" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
                </div>
              </div>

              <div className="acal-field">
                <label>Description (optional)</label>
                <textarea className="acal-textarea" value={evDescription} onChange={(e) => setEvDescription(e.target.value)} />
              </div>
            </div>
            <div className="acal-modal-actions">
              <button className="acal-mcancel" onClick={() => setEventModalOpen(false)}>
                Cancel
              </button>
              <button className="acal-msubmit" disabled={!evTitle || !evStart || evSaving} onClick={saveEvent}>
                {evSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete event confirm ── */}
      {deletingEventId && (
        <div className="acal-overlay" onClick={() => setDeletingEventId(null)}>
          <div className="acal-modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="acal-modal-head">
              <div className="acal-modal-title">Delete this event?</div>
            </div>
            <div className="acal-modal-actions">
              <button className="acal-mcancel" onClick={() => setDeletingEventId(null)}>
                Cancel
              </button>
              <button className="acal-msubmit danger" disabled={deletingEventBusy} onClick={confirmDeleteEvent}>
                {deletingEventBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}