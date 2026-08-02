/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/timetable/page.tsx
 *
 * Purpose:
 * Per-class/section weekly schedule builder — assign a subject +
 * teacher to each class-type slot in the master clock, per class,
 * per section, per day.
 *
 * Rebuilt against the one-document-per-class-section model documented
 * in types/timetable.ts (WeeklyTimetable). The previous version of
 * this page held one live collectionGroup-backed subscription across
 * every timetable entry in the school; this one does NOT — timetables
 * are read constantly and written rarely, so the selected class-
 * section's schedule is loaded with a delta-synced one-time read (see
 * timetableService.getTimetableIfChanged) instead of a listener, and
 * the teacher-conflict map is a one-time read refreshed explicitly
 * after any save/delete/copy on this page (see refreshConflictMap).
 *
 * Two things from the older prototype this predates are still
 * deliberately NOT carried forward:
 * - The embedded "Master Timings" editor. That's settings/timings now
 *   — one editor for schools/{schoolId}/config/timings instead of two
 *   that could drift out of sync (see that page's own header comment).
 *   This page only links there.
 * - Drag-to-reorder periods. Period order was always meant to come
 *   from a slot's position in the master clock, not an independently
 *   chosen order.
 *
 * Subject is a real reference into the school's Subjects catalog
 * (schools/{schoolId}/subjects) rather than free text.
 * --------------------------------------------------------------------
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { classesRepository } from "@/repositories/academic/classesRepository";
import { subjectsRepository } from "@/repositories/academic/subjectsRepository";
import { teachersRepository } from "@/repositories/teachers/teachersRepository";
import { timingsService } from "@/services/timetable/timingsService";
import { schoolService } from "@/services/school/schoolService";
import { timetableService, NO_SECTION_ID, DAYS } from "@/services/timetable/timetableService";
import { TeacherConflictMap, TimetableDay, TimingSlot, WeeklyTimetable } from "@/types/timetable";
import { Subject } from "@/types/academic";
import { Teacher } from "@/types/teachers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Check,
  Clock,
  Coffee,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Settings2,
  Trash2,
  User,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Color-codes periods by subject for at-a-glance scanning — restored
 * from the old prototype's SUBJECT_COLORS map, but hashed from the
 * subject's ID rather than a hardcoded lookup of ~9 English subject
 * names. The old map silently fell back to gray for anything that
 * didn't match one of those exact strings (different capitalization,
 * "Social Studies" vs any of the 9 it knew about, anything added
 * later) — every subject gets a real, stable, distinct color here,
 * with no maintenance as the catalog grows. Hashing the ID (not the
 * name) also means renaming a subject never changes its color.
 */
const SUBJECT_PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#84cc16", // lime
  "#f59e0b", // amber
  "#ef4444", // red
  "#14b8a6", // teal
  "#8b5cf6", // violet
  "#f97316", // orange
  "#ec4899", // pink
];

function subjectColor(subjectId: string): string {
  let hash = 0;
  for (let i = 0; i < subjectId.length; i++) {
    hash = (hash * 31 + subjectId.charCodeAt(i)) >>> 0;
  }
  return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
}

const BREAK_COLOR = "#f59e0b"; // amber
const LUNCH_COLOR = "#f97316"; // orange

interface SectionMeta {
  id: string;
  name: string;
  /** Renamed from the old classTeacher (a raw name string) — see
   * settings/academic/page.tsx for why: no id meant same-named
   * teachers were indistinguishable and renames silently orphaned
   * every assignment. Not currently rendered anywhere on this page,
   * kept in sync anyway so it doesn't go stale if that changes. */
  classTeacherId?: string | null;
  classTeacherName?: string;
}
interface ClassGroup {
  id: string;
  className: string;
  sections: SectionMeta[];
  orderIndex?: number;
}

const EMPTY_DAY: TimetableDay = {};

export default function TimetablePage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [masterTimings, setMasterTimings] = useState<TimingSlot[]>([]);
  const [timingsConfigured, setTimingsConfigured] = useState(false);
  const [academicYear, setAcademicYear] = useState("");

  const [timetable, setTimetable] = useState<WeeklyTimetable | null>(null);
  const [conflictMap, setConflictMap] = useState<TeacherConflictMap>({});

  const [classesLoading, setClassesLoading] = useState(true);
  const [timingsLoading, setTimingsLoading] = useState(true);
  const [timetableLoading, setTimetableLoading] = useState(true);

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState("Monday");

  const [editingSlot, setEditingSlot] = useState<TimingSlot | null>(null);
  const [editSubjectId, setEditSubjectId] = useState("");
  const [editTeacherId, setEditTeacherId] = useState("");
  const [saving, setSaving] = useState(false);

  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const [copyTargetDays, setCopyTargetDays] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);

  // ── Firestore sync — classes/teachers/subjects/master clock stay live; ────
  // ── see file header for why the timetable document itself does not. ──────
  useEffect(() => {
    if (!schoolId) return;

    const unsubClasses = classesRepository.subscribeToClasses(schoolId, (docs) => {
      const data: ClassGroup[] = docs.map((d) => ({
        id: d.id,
        className: (d.data.className as string) || "",
        sections: ((d.data.sections as SectionMeta[]) || []).map((s) => ({
          id: s.id,
          name: s.name,
          classTeacherId: s.classTeacherId ?? null,
          classTeacherName: s.classTeacherName,
        })),
        orderIndex: d.data.orderIndex as number | undefined,
      }));
      setClasses(data);
      setClassesLoading(false);
      setSelectedClassId((prev) => {
        if (prev && data.some((c) => c.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    });

    const unsubTeachers = teachersRepository.subscribeToTeachers(schoolId, (docs) => {
      setTeachers(
        docs.map((d) => ({
          id: d.id,
          name: (d.data.name as string) || "Unknown",
          email: (d.data.email as string) || "",
          phone: (d.data.phone as string) || "",
          subject: (d.data.subject as string) || "",
        }))
      );
    });

    const unsubSubjects = subjectsRepository.subscribeToSubjects(schoolId, (docs) => {
      setSubjects(
        docs
          .map((d) => ({
            id: d.id,
            name: (d.data.name as string) || "",
            category: (d.data.category as Subject["category"]) || "Core",
            orderIndex: (d.data.orderIndex as number) ?? 0,
            isActive: (d.data.isActive as boolean) ?? true,
            createdAt: d.data.createdAt,
          }))
          .filter((s) => s.isActive)
      );
    });

    const unsubTimings = timingsService.subscribeToTimings(schoolId, ({ slots, isConfigured }) => {
      setMasterTimings(slots);
      setTimingsConfigured(isConfigured);
      setTimingsLoading(false);
    });

    return () => {
      unsubClasses();
      unsubTeachers();
      unsubSubjects();
      unsubTimings();
    };
  }, [schoolId]);

  // One-time read — not a listener. The school's academic year changes at
  // most once a year, so there's no reason to hold a subscription open for it.
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    schoolService.getSchoolProfile(schoolId).then((schoolProfile) => {
      if (!cancelled) setAcademicYear(schoolProfile.currentAcademicYear);
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const refreshConflictMap = useCallback(async () => {
    if (!schoolId) return;
    const map = await timetableService.buildConflictMap(schoolId);
    setConflictMap(map);
  }, [schoolId]);

  useEffect(() => {
    refreshConflictMap();
  }, [refreshConflictMap]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentClass = classes.find((c) => c.id === selectedClassId);
  const hasNoSections = !currentClass?.sections || currentClass.sections.length === 0;
  const currentSectionId = hasNoSections ? NO_SECTION_ID : selectedSectionId;
  const currentSectionName = hasNoSections
    ? ""
    : currentClass?.sections.find((s) => s.id === currentSectionId)?.name ?? "";

  // subjectId -> name, for stamping human-readable subject names onto
  // each affected teacher's schedule (see diffTeacherSchedulePatches) —
  // built once here since the service layer deliberately never
  // fetches subjects itself.
  const subjectNameById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s.name])),
    [subjects]
  );

  useEffect(() => {
    if (!currentClass) return;
    if (hasNoSections) return;
    if (selectedSectionId && currentClass.sections.some((s) => s.id === selectedSectionId)) return;
    setSelectedSectionId(currentClass.sections[0]?.id ?? null);
  }, [currentClass, hasNoSections, selectedSectionId]);

  // Delta-synced load of the selected class-section's timetable — see
  // timetableService.getTimetableIfChanged for the cache-vs-Firestore workflow.
  useEffect(() => {
    if (!schoolId || !selectedClassId || !currentSectionId) return;
    let cancelled = false;
    setTimetableLoading(true);
    timetableService
      .getTimetableIfChanged(schoolId, selectedClassId, currentSectionId, academicYear)
      .then((data) => {
        if (!cancelled) setTimetable(data);
      })
      .finally(() => {
        if (!cancelled) setTimetableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, selectedClassId, currentSectionId, academicYear]);

  const dayPeriods = timetable?.days[activeDay] ?? EMPTY_DAY;
  const scheduledCount = Object.keys(dayPeriods).length;

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? "Unknown subject";
  const teacherName = (id: string) => teachers.find((t) => t.id === id)?.name ?? "Unknown teacher";

  const loading = classesLoading || timingsLoading || timetableLoading;
  const noClassesConfigured = !classesLoading && classes.length === 0;
  const noSelection = !selectedClassId || (!hasNoSections && !selectedSectionId);

  /**
   * After a version conflict, the server is the only source of truth
   * left for this class-section — force a fresh read (bypassing the
   * "unchanged" short-circuit) so the next save attempt has the
   * correct version instead of failing again immediately.
   */
  async function reloadAfterConflict() {
    if (!schoolId || !selectedClassId || !currentSectionId) return;
    const fresh = await timetableService.getTimetable(schoolId, selectedClassId, currentSectionId, academicYear);
    setTimetable(fresh);
  }

  // ── Add / edit dialog ────────────────────────────────────────────────────
  function openSlot(slot: TimingSlot) {
    if (slot.type !== "class") return;
    const existing = dayPeriods[slot.id];
    setEditingSlot(slot);
    setEditSubjectId(existing?.subjectId ?? "");
    setEditTeacherId(existing?.teacherId ?? "");
  }

  function closeSlotDialog() {
    setEditingSlot(null);
    setEditSubjectId("");
    setEditTeacherId("");
  }

  const editConflict =
    editingSlot && editTeacherId
      ? timetableService.isTeacherConflicted(
          conflictMap,
          editTeacherId,
          activeDay,
          editingSlot.id,
          selectedClassId!,
          currentSectionId!
        )
      : false;

  async function handleSaveSlot() {
    if (!schoolId || !selectedClassId || !currentSectionId || !editingSlot || !timetable || !profile) return;
    setSaving(true);
    try {
      const result = await timetableService.saveDay(
        schoolId,
        selectedClassId,
        currentSectionId,
        academicYear,
        profile.uid,
        timetable,
        activeDay,
        editingSlot,
        { subjectId: editSubjectId, teacherId: editTeacherId },
        currentClass?.className ?? "",
        currentSectionName,
        subjectNameById
      );
      if (!result.ok) {
        toast.error(result.error);
        await reloadAfterConflict();
        return;
      }
      setTimetable(result.timetable);
      refreshConflictMap();
      toast.success(`${editingSlot.label} updated`);
      closeSlotDialog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save this period.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSlot() {
    if (!schoolId || !selectedClassId || !currentSectionId || !deletingSlotId || !timetable || !profile) return;
    setDeleting(true);
    try {
      const result = await timetableService.deleteDay(
        schoolId,
        selectedClassId,
        currentSectionId,
        academicYear,
        profile.uid,
        timetable,
        activeDay,
        deletingSlotId,
        currentClass?.className ?? "",
        currentSectionName,
        subjectNameById
      );
      if (!result.ok) {
        toast.error(result.error);
        await reloadAfterConflict();
        return;
      }
      setTimetable(result.timetable);
      refreshConflictMap();
      toast.success("Period cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear this period.");
    } finally {
      setDeleting(false);
      setDeletingSlotId(null);
    }
  }

  // ── Copy day ─────────────────────────────────────────────────────────────
  async function handleCopyDay() {
    if (!schoolId || !selectedClassId || !currentSectionId || !copyTargetDays.length || !timetable || !profile) return;
    setCopying(true);
    try {
      const result = await timetableService.copyDay(
        schoolId,
        selectedClassId,
        currentSectionId,
        academicYear,
        profile.uid,
        timetable,
        activeDay,
        copyTargetDays,
        currentClass?.className ?? "",
        currentSectionName,
        subjectNameById
      );
      if (!result.ok) {
        toast.error(result.error);
        await reloadAfterConflict();
        return;
      }
      setTimetable(result.timetable);
      refreshConflictMap();
      toast.success(`Copied ${activeDay} to ${copyTargetDays.length} day${copyTargetDays.length !== 1 ? "s" : ""}`);
      setIsCopyOpen(false);
      setCopyTargetDays([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to copy the day.");
    } finally {
      setCopying(false);
    }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Timetable</h1>
              <p className="mt-1 text-sm text-zinc-500">
                {currentClass ? `Class ${currentClass.className}` : "Select a class"}
                {!hasNoSections && selectedSectionId
                  ? ` · Section ${currentClass?.sections.find((s) => s.id === selectedSectionId)?.name ?? ""}`
                  : ""}
                {" · "}
                {activeDay}
              </p>
            </div>
            <div className="flex gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" /> Print
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!scheduledCount}
                onClick={() => setIsCopyOpen(true)}
              >
                <Copy className="mr-1.5 h-4 w-4" /> Copy Day
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/timings">
                  <Settings2 className="mr-1.5 h-4 w-4" /> Master Timings
                </Link>
              </Button>
            </div>
          </div>

          {/* Class pills */}
          <div className="mt-5 space-y-3 print:hidden">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Class</div>
              <div className="flex flex-wrap gap-2">
                {noClassesConfigured ? (
                  <span className="text-sm text-zinc-400">
                    No classes yet — add them in Config → Academic
                  </span>
                ) : (
                  classes.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedClassId(c.id)}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                        selectedClassId === c.id
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                      }`}
                    >
                      {c.className}
                    </button>
                  ))
                )}
              </div>
            </div>

            {currentClass && !hasNoSections && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Section
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentClass.sections.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => setSelectedSectionId(sec.id)}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                        selectedSectionId === sec.id
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                      }`}
                    >
                      {sec.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Day tabs */}
          <div className="mt-5 flex gap-1 border-b border-zinc-100 print:hidden">
            {DAYS.map((day) => (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                  activeDay === day
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-400 hover:text-zinc-600"
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule card */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-2xl" />
              ))}
            </div>
          ) : noSelection ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              Select a class{!hasNoSections ? " and section" : ""} above to manage its timetable.
            </p>
          ) : !timingsConfigured ? (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                No master clock configured yet — what you'd see below is just a suggested preview,
                not saved anywhere.{" "}
                <Link href="/settings/timings" className="font-semibold underline">
                  Set up periods, breaks, and lunch
                </Link>{" "}
                first. Building a timetable against unsaved defaults would assign subjects and
                teachers to slot IDs that might not exist once the school's real clock is saved —
                every class's timetable is built from that shared, saved schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {masterTimings.map((slot) => {
                if (slot.type !== "class") {
                  const Icon = slot.type === "lunch" ? Utensils : Coffee;
                  return (
                    <div
                      key={slot.id}
                      className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-400"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="font-semibold">{slot.label}</span>
                      <span className="ml-auto flex items-center gap-1 font-mono text-xs">
                        <Clock className="h-3 w-3" /> {slot.start} – {slot.end}
                      </span>
                    </div>
                  );
                }

                const period = dayPeriods[slot.id];
                const conflicted = period
                  ? timetableService.isTeacherConflicted(
                      conflictMap,
                      period.teacherId,
                      activeDay,
                      slot.id,
                      selectedClassId!,
                      currentSectionId!
                    )
                  : false;

                return (
                  <div
                    key={slot.id}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                      period ? "border-zinc-100 bg-white" : "border-dashed border-zinc-200 bg-zinc-50/50"
                    }`}
                  >
                    <div className="w-24 shrink-0">
                      <div className="text-sm font-semibold text-zinc-900">{slot.label}</div>
                      <div className="flex items-center gap-1 font-mono text-xs text-zinc-400">
                        <Clock className="h-3 w-3" /> {slot.start}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      {period ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-900">{subjectName(period.subjectId)}</span>
                          <span className="flex items-center gap-1 text-sm text-zinc-500">
                            <User className="h-3.5 w-3.5" /> {teacherName(period.teacherId)}
                          </span>
                          {conflicted && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Double-booked
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-400">Not scheduled</span>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openSlot(slot)}>
                        {period ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </Button>
                      {period && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingSlotId(slot.id)}
                        >
                          <Trash2 className="h-4 w-4 text-zinc-400" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Add/Edit period dialog ── */}
      <Dialog open={!!editingSlot} onOpenChange={(open) => !open && closeSlotDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSlot?.label}</DialogTitle>
            <DialogDescription>
              {editingSlot?.start} – {editingSlot?.end} · {activeDay}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700">Subject</label>
              <Select value={editSubjectId} onValueChange={setEditSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subject…" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-zinc-400">
                      No subjects yet — add them in Config → Subjects
                    </div>
                  ) : (
                    subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700">Teacher</label>
              <Select value={editTeacherId} onValueChange={setEditTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher…" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.subject ? ` (${t.subject})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editConflict && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This teacher is already scheduled in another class at this exact time.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              disabled={!editSubjectId || !editTeacherId || saving}
              onClick={handleSaveSlot}
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deletingSlotId} onOpenChange={(open) => !open && setDeletingSlotId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this period?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the subject and teacher assignment for this slot on {activeDay}. The slot itself
              stays in the master clock.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={handleDeleteSlot}>
              {deleting ? "Clearing…" : "Clear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Copy day dialog ── */}
      <Dialog open={isCopyOpen} onOpenChange={setIsCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy {activeDay}</DialogTitle>
            <DialogDescription>
              Copy {scheduledCount} scheduled period{scheduledCount !== 1 ? "s" : ""} to other days.
              Existing schedules on those days will be replaced.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            {DAYS.filter((d) => d !== activeDay).map((day) => {
              const checked = copyTargetDays.includes(day);
              return (
                <button
                  key={day}
                  onClick={() =>
                    setCopyTargetDays((prev) =>
                      checked ? prev.filter((d) => d !== day) : [...prev, day]
                    )
                  }
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    checked ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-zinc-100 text-zinc-600"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      checked ? "border-indigo-600 bg-indigo-600" : "border-zinc-300"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                  {day}
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button disabled={!copyTargetDays.length || copying} onClick={handleCopyDay}>
              {copying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Copy to {copyTargetDays.length || 0} day{copyTargetDays.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}