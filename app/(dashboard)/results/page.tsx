/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/results/page.tsx
 *
 * Purpose:
 * Exam results — school-configurable exam model, marks entry, class
 * performance, and per-student lookup.
 *
 * Why the exam model is configurable instead of hardcoded:
 * There's no single "exam system" across schools — Andhra Pradesh
 * schools run FA1/FA2/SA1/SA2/Final, CBSE schools run Unit Tests +
 * Half-Yearly + Final, and plenty of schools run something else
 * entirely. So "Exam Terms" is the first tab here: each school
 * defines its own terms and, per term, its own subject list with
 * that term's max/pass marks. Every other tab (Enter Marks, Class
 * Performance, Student Lookup) is just a consumer of whatever the
 * school has configured — nothing else in this page hardcodes a term
 * name or a subject list.
 *
 * Layering (per README's CRUD-vs-Cloud-Function rule):
 * Exam term config and marks entry are both plain CRUD on records the
 * signed-in staff member already has permission to touch — straight
 * through examTermsService/resultsService → their repositories →
 * the Firebase client SDK, gated by Firestore rules. Nothing here
 * touches money, secrets, or a third-party API, so none of it needs
 * to go behind a Cloud Function. Rank and class averages are
 * computed at read-time in resultsService from documents already
 * being fetched for display — never written back, so there's no
 * coordinated multi-document write to worry about either.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { studentsService } from "@/services/students/studentsService";
import { examTermsService } from "@/services/results/examTermsService";
import { subjectsService } from "@/services/academic/subjectsService";
import { classesService } from "@/services/academic/classesService";
import {
  resultsService,
  computeTotals,
  gradeFor,
} from "@/services/results/resultsService";
import { Student } from "@/types/students";
import {
  ExamSubject,
  ExamTerm,
  ExamTermFormValues,
  MarksEntryRow,
  StudentResult,
} from "@/types/results";
import { Subject, ClassSummary } from "@/types/academic";
import { SECTIONS } from "@/constants/students";
import {
  BarChart2,
  BookOpen,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Tab = "marks" | "performance" | "lookup" | "terms";

const ALL = "All";

function pctColor(pct: number): string {
  if (pct >= 60) return "text-emerald-600";
  if (pct >= 33) return "text-amber-600";
  return "text-red-600";
}

/* ==================================================================
   EXAM TERMS TAB — the school's own exam model
   ================================================================== */

function ExamTermsTab({
  schoolId,
  examTerms,
  loading,
  subjectCatalog,
}: {
  schoolId: string;
  examTerms: ExamTerm[];
  loading: boolean;
  subjectCatalog: Subject[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ExamTerm | null>(null);
  const [form, setForm] = useState<ExamTermFormValues>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<ExamTerm | null>(null);
  const [pickerValue, setPickerValue] = useState("");

  const activeCatalog = useMemo(
    () => subjectCatalog.filter((s) => s.isActive),
    [subjectCatalog]
  );

  // Catalog subjects not yet added to the term being built — this is
  // what populates the "Add subject" picker, so the same subject can
  // never be added to one term twice.
  const availableSubjects = useMemo(
    () => activeCatalog.filter((s) => !form.subjects.some((fs) => fs.id === s.id)),
    [activeCatalog, form.subjects]
  );

  function emptyForm(): ExamTermFormValues {
    return {
      name: "",
      academicYear: "",
      order: examTerms.length + 1,
      subjects: [],
      isActive: true,
    };
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setPickerValue("");
    setModalOpen(true);
  }

  function openEdit(term: ExamTerm) {
    setEditing(term);
    setForm({
      name: term.name,
      academicYear: term.academicYear,
      order: term.order,
      subjects: term.subjects.map((s) => ({ ...s })),
      isActive: term.isActive,
    });
    setError("");
    setPickerValue("");
    setModalOpen(true);
  }

  function updateSubject(idx: number, patch: Partial<Pick<ExamSubject, "maxMarks" | "passMarks">>) {
    setForm((f) => ({
      ...f,
      subjects: f.subjects.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  }

  // Adds a real catalog subject to the term (relational — id/name come
  // straight from the Subjects catalog, never typed by hand).
  function addSubject(subjectId: string) {
    const subject = activeCatalog.find((s) => s.id === subjectId);
    if (!subject) return;
    setForm((f) => ({ ...f, subjects: [...f.subjects, examTermsService.addSubjectFromCatalog(subject)] }));
    setPickerValue("");
  }

  function removeSubject(idx: number) {
    setForm((f) => ({ ...f, subjects: f.subjects.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await examTermsService.updateExamTerm(schoolId, editing.id, form);
      } else {
        await examTermsService.createExamTerm(schoolId, form);
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save exam term.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    await examTermsService.deleteExamTerm(schoolId, deleting.id);
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Exam terms</h2>
          <p className="text-sm text-zinc-500">
            Define your own exam model — FA1/FA2/SA1/SA2, Unit Tests, Finals, or
            whatever your school runs. Every other tab uses whatever's set up here.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add exam term
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : examTerms.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <BookOpen className="h-8 w-8 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-600">No exam terms yet</p>
            <p className="max-w-sm text-sm text-zinc-400">
              Add your first exam term (e.g. "FA1") with its subjects and max marks
              to start entering results.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {examTerms.map((term) => {
            const totalMax = term.subjects.reduce((s, sub) => s + sub.maxMarks, 0);
            return (
              <Card key={term.id} className="shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-zinc-900">{term.name}</h3>
                        {!term.isActive && (
                          <Badge variant="secondary" className="text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {term.academicYear || "No academic year set"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(term)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(term)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {term.subjects.map((s) => (
                      <span
                        key={s.id}
                        className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                      >
                        {s.name} · {s.maxMarks}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-zinc-400">
                    {term.subjects.length} subject{term.subjects.length === 1 ? "" : "s"} ·{" "}
                    {totalMax} total marks
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / edit modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit exam term" : "Add exam term"}</DialogTitle>
            <DialogDescription>
              Name it whatever your school calls it — "FA1", "SA2", "Unit Test 1", etc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="termName">Term name</Label>
                <Input
                  id="termName"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. FA1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="termYear">Academic year</Label>
                <Input
                  id="termYear"
                  value={form.academicYear}
                  onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))}
                  placeholder="e.g. 2026-27"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Subjects</Label>
                {availableSubjects.length > 0 ? (
                  <Select value={pickerValue} onValueChange={addSubject}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Add subject…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSubjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-zinc-400">
                    {activeCatalog.length === 0
                      ? "No subjects in your catalog yet"
                      : "All catalog subjects added"}
                  </span>
                )}
              </div>

              {activeCatalog.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
                  Add subjects to your school's catalog first, in Settings → Subjects, then
                  come back here to attach them to this exam term.
                </p>
              ) : form.subjects.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
                  No subjects added yet — pick one from your catalog above.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.subjects.map((subject, idx) => (
                    <div key={subject.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700">
                        {subject.name}
                      </span>
                      <Input
                        type="number"
                        value={subject.maxMarks}
                        onChange={(e) =>
                          updateSubject(idx, { maxMarks: Number(e.target.value) })
                        }
                        placeholder="Max"
                        className="w-20"
                      />
                      <Input
                        type="number"
                        value={subject.passMarks}
                        onChange={(e) =>
                          updateSubject(idx, { passMarks: Number(e.target.value) })
                        }
                        placeholder="Pass"
                        className="w-20"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeSubject(idx)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-xs text-zinc-400">
                Subjects come from your catalog — Max / Pass marks are set per exam term.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create term"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleting?.name}"?</DialogTitle>
            <DialogDescription>
              This only removes the exam term definition — results already saved
              against it are kept, but you won't be able to enter new marks for it
              from here anymore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ==================================================================
   ENTER MARKS TAB
   ================================================================== */

function buildRow(
  student: Student,
  classSubjects: ExamSubject[],
  existing: StudentResult | undefined
): MarksEntryRow {
  return {
    studentId: student.id,
    studentName: student.profile.name,
    rollNo: student.profile.rollNo,
    marks: classSubjects.map((subject) => {
      const existingMark = existing?.marks.find((m) => m.subjectId === subject.id);
      return existingMark
        ? { ...existingMark }
        : { subjectId: subject.id, marksObtained: null, isAbsent: false };
    }),
    remarks: existing?.remarks ?? "",
    existingResultId: existing?.id ?? null,
    dirty: false,
    saving: false,
    error: null,
  };
}

function EnterMarksTab({
  schoolId,
  examTerms,
  students,
  classes,
  enteredBy,
}: {
  schoolId: string;
  examTerms: ExamTerm[];
  students: Student[];
  classes: ClassSummary[];
  enteredBy?: string;
}) {
  const [termId, setTermId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  // "__all__" means "don't filter by section" — the right default for
  // a class that has no sections at all, and still useful for a
  // sectioned class if staff want to see everyone in the class at
  // once. A specific section narrows the roster down further.
  const [section, setSection] = useState<string>("__all__");
  const [rows, setRows] = useState<MarksEntryRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const term = examTerms.find((t) => t.id === termId) ?? null;
  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  // The whole point of the relation: only show/enter marks for subjects
  // this exam term includes AND this specific class actually offers
  // (per its Class Assignments in Settings → Subjects) — not every
  // subject in the exam term regardless of what the class teaches.
  const classSubjects = useMemo(() => {
    if (!term || !selectedClass) return [];
    return term.subjects.filter((s) => selectedClass.subjectIds.includes(s.id));
  }, [term, selectedClass]);

  // Seed rows from students + whatever's already saved for this term.
  // Only takes the FIRST snapshot then detaches — this is a working
  // grid the staff member is actively typing into, so it should not
  // be silently overwritten by a live update mid-edit. Re-selecting
  // the term/class/section (or reopening the page) picks up fresh data.
  useEffect(() => {
    setRows([]);
    if (!schoolId || !term || !selectedClass) return;

    setRowsLoading(true);
    let seeded = false;
    const unsub = resultsService.subscribeToResultsByTerm(schoolId, term.id, (results) => {
      if (seeded) return;
      seeded = true;
      const classStudents = students.filter(
        (s) =>
          s.className === selectedClass.className &&
          (section === "__all__" || s.section === section)
      );
      const nextRows = classStudents.map((s) =>
        buildRow(s, classSubjects, results.find((r) => r.studentId === s.id))
      );
      setRows(nextRows);
      setRowsLoading(false);
      unsub();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, term?.id, selectedClass?.id, section]);

  function updateCell(rowIdx: number, subjectId: string, raw: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        const value = raw.trim() === "" ? null : Number(raw);
        return {
          ...row,
          dirty: true,
          error: null,
          marks: row.marks.map((m) =>
            m.subjectId === subjectId ? { ...m, marksObtained: value, isAbsent: false } : m
          ),
        };
      })
    );
  }

  function toggleAbsent(rowIdx: number, subjectId: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        return {
          ...row,
          dirty: true,
          error: null,
          marks: row.marks.map((m) =>
            m.subjectId === subjectId ? { ...m, isAbsent: !m.isAbsent, marksObtained: null } : m
          ),
        };
      })
    );
  }

  function updateRemarks(rowIdx: number, value: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === rowIdx ? { ...row, remarks: value, dirty: true } : row))
    );
  }

  async function saveRow(rowIdx: number) {
    const row = rows[rowIdx];
    if (!term) return;
    const student = students.find((s) => s.id === row.studentId);
    if (!student) return;

    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, saving: true, error: null } : r)));
    try {
      await resultsService.saveMarks(
        schoolId,
        term,
        classSubjects,
        student,
        row.marks,
        row.remarks,
        enteredBy
      );
      setRows((prev) =>
        prev.map((r, i) => (i === rowIdx ? { ...r, saving: false, dirty: false } : r))
      );
    } catch (err) {
      setRows((prev) =>
        prev.map((r, i) =>
          i === rowIdx
            ? {
                ...r,
                saving: false,
                error: err instanceof Error ? err.message : "Failed to save.",
              }
            : r
        )
      );
    }
  }

  async function saveAllDirty() {
    const dirtyIdxs = rows.map((r, i) => i).filter((i) => rows[i].dirty && !rows[i].saving);
    for (const idx of dirtyIdxs) {
      // Sequential, not parallel — keeps error attribution per-row simple
      // and avoids hammering Firestore with a burst of writes when a
      // whole class's marks are entered at once.
      // eslint-disable-next-line no-await-in-loop
      await saveRow(idx);
    }
  }

  const dirtyCount = rows.filter((r) => r.dirty).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Enter marks</h2>
        <p className="text-sm text-zinc-500">
          Pick an exam term and a class to load its roster, then enter marks per subject.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Exam term" />
          </SelectTrigger>
          <SelectContent>
            {examTerms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.className}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={section} onValueChange={setSection}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Sections</SelectItem>
            {SECTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                Section {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {dirtyCount > 0 && (
          <Button onClick={saveAllDirty} className="ml-auto gap-1.5">
            <Save className="h-4 w-4" />
            Save all ({dirtyCount})
          </Button>
        )}
      </div>

      {!term || !selectedClass ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <ClipboardList className="h-8 w-8 text-zinc-300" />
            <p className="text-sm text-zinc-400">
              Pick an exam term and class to load the roster.
            </p>
          </CardContent>
        </Card>
      ) : classSubjects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-sm text-zinc-400">
            {selectedClass.className} doesn't offer any of {term.name}'s subjects yet — assign
            subjects to this class in Settings → Subjects → Class Assignments first.
          </CardContent>
        </Card>
      ) : rowsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-sm text-zinc-400">
            No students found in {selectedClass.className}
            {section !== "__all__" ? ` - ${section}` : ""}.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll</TableHead>
                <TableHead>Student</TableHead>
                {classSubjects.map((s) => (
                  <TableHead key={s.id} className="text-center">
                    {s.name}
                    <div className="text-[10px] font-normal text-zinc-400">/{s.maxMarks}</div>
                  </TableHead>
                ))}
                <TableHead className="text-center">Total</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead className="text-center">Grade</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => {
                const { totalObtained, totalMax, percentage } = computeTotals(
                  row.marks,
                  classSubjects
                );
                return (
                  <TableRow key={row.studentId}>
                    <TableCell className="text-zinc-500">{row.rollNo}</TableCell>
                    <TableCell className="font-medium">{row.studentName}</TableCell>
                    {classSubjects.map((subject) => {
                      const mark = row.marks.find((m) => m.subjectId === subject.id);
                      return (
                        <TableCell key={subject.id} className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              disabled={mark?.isAbsent}
                              value={mark?.isAbsent ? "" : mark?.marksObtained ?? ""}
                              onChange={(e) => updateCell(idx, subject.id, e.target.value)}
                              className="h-8 w-16 text-center"
                              placeholder="—"
                            />
                            <button
                              type="button"
                              title="Toggle absent"
                              onClick={() => toggleAbsent(idx, subject.id)}
                              className={`rounded px-1 text-[10px] font-semibold ${
                                mark?.isAbsent
                                  ? "bg-red-100 text-red-600"
                                  : "text-zinc-300 hover:text-zinc-500"
                              }`}
                            >
                              AB
                            </button>
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-medium">
                      {totalObtained}/{totalMax}
                    </TableCell>
                    <TableCell className={`text-center font-medium ${pctColor(percentage)}`}>
                      {percentage}%
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{gradeFor(percentage)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.remarks}
                        onChange={(e) => updateRemarks(idx, e.target.value)}
                        placeholder="Optional"
                        className="h-8 w-32"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={row.dirty ? "default" : "outline"}
                        disabled={!row.dirty || row.saving}
                        onClick={() => saveRow(idx)}
                        className="gap-1"
                      >
                        {row.saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                      {row.error && (
                        <p className="mt-1 text-[11px] text-red-600">{row.error}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/* ==================================================================
   CLASS PERFORMANCE TAB
   ================================================================== */

function ClassPerformanceTab({
  schoolId,
  examTerms,
  students,
  classes,
}: {
  schoolId: string;
  examTerms: ExamTerm[];
  students: Student[];
  classes: ClassSummary[];
}) {
  const [termId, setTermId] = useState("");
  const [className, setClassName] = useState(ALL);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(false);

  const term = examTerms.find((t) => t.id === termId) ?? null;

  useEffect(() => {
    setResults([]);
    if (!schoolId || !term) return;
    setLoading(true);
    const unsub = resultsService.subscribeToResultsByTerm(schoolId, term.id, (r) => {
      setResults(r);
      setLoading(false);
    });
    return () => unsub();
  }, [schoolId, term?.id]);

  const filtered = useMemo(
    () => (className === ALL ? results : results.filter((r) => r.className === className)),
    [results, className]
  );
  const rows = useMemo(
    () => resultsService.buildClassPerformance(filtered, students),
    [filtered, students]
  );
  const summary = useMemo(() => resultsService.summarize(rows), [rows]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Class performance</h2>
        <p className="text-sm text-zinc-500">
          Ranked results for an exam term — across the whole school or one class.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Exam term" />
          </SelectTrigger>
          <SelectContent>
            {examTerms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={className} onValueChange={setClassName}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.className}>
                {c.className}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!term ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <BarChart2 className="h-8 w-8 text-zinc-300" />
            <p className="text-sm text-zinc-400">Pick an exam term to see performance.</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-sm text-zinc-400">
            No results recorded yet for {term.name}
            {className !== ALL ? ` in ${className}` : ""}.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Appeared", value: summary.studentsAppeared, icon: Users },
              { label: "Class average", value: `${summary.classAverage}%`, icon: BarChart2 },
              { label: "Highest", value: `${summary.highestPercentage}%`, icon: Trophy },
              { label: "Pass %", value: `${summary.passPercentage}%`, icon: ClipboardList },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <stat.icon className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{stat.label}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-zinc-900">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">%</TableHead>
                  <TableHead className="text-center">Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold text-zinc-500">#{row.rank}</TableCell>
                    <TableCell>{row.rollNo}</TableCell>
                    <TableCell className="font-medium">{row.studentName}</TableCell>
                    <TableCell className="text-zinc-500">
                      {row.className}{row.section ? `-${row.section}` : ''}
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {row.totalObtained}/{row.totalMax}
                    </TableCell>
                    <TableCell className={`text-center font-medium ${pctColor(row.percentage)}`}>
                      {row.percentage}%
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{row.grade}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

/* ==================================================================
   STUDENT LOOKUP TAB
   ================================================================== */

function StudentLookupTab({
  schoolId,
  examTerms,
  students,
}: {
  schoolId: string;
  examTerms: ExamTerm[];
  students: Student[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || selected) return [];
    return students
      .filter(
        (s) =>
          s.profile.name.toLowerCase().includes(q) ||
          s.profile.rollNo.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, students, selected]);

  useEffect(() => {
    setResults([]);
    if (!schoolId || !selected) return;
    setLoading(true);
    const unsub = resultsService.subscribeToResultsByStudent(schoolId, selected.id, (r) => {
      setResults(r);
      setLoading(false);
    });
    return () => unsub();
  }, [schoolId, selected?.id]);

  const rows = useMemo(() => {
    return results
      .map((r) => {
        const term = examTerms.find((t) => t.id === r.termId);
        return { ...r, termName: term?.name ?? "Unknown term", termOrder: term?.order ?? 0 };
      })
      .sort((a, b) => a.termOrder - b.termOrder);
  }, [results, examTerms]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Student lookup</h2>
        <p className="text-sm text-zinc-500">
          Search by name, roll number, or ID to see a student's results across every exam term.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input
          value={selected ? `${selected.profile.name} (Roll ${selected.profile.rollNo})` : query}
          onChange={(e) => {
            setSelected(null);
            setQuery(e.target.value);
          }}
          placeholder="Search students…"
          className="pl-9"
        />
        {selected && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {matches.length > 0 && (
        <Card className="max-w-md overflow-hidden">
          <CardContent className="divide-y divide-zinc-100 p-0">
            {matches.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelected(s);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-900">{s.profile.name}</span>
                <span className="text-xs text-zinc-400">
                  Roll {s.profile.rollNo} · Grade {s.className}{s.section ? `-${s.section}` : ''}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {selected && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : rows.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-14 text-center text-sm text-zinc-400">
                No results recorded yet for {selected.profile.name}.
              </CardContent>
            </Card>
          ) : (
            <>
              {rows.length > 1 && (
                <Card>
                  <CardContent className="p-4">
                    <p className="mb-2 text-xs font-medium text-zinc-500">
                      Percentage trend across terms
                    </p>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rows}>
                          <XAxis dataKey="termName" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={30} />
                          <ChartTooltip />
                          <Line
                            type="monotone"
                            dataKey="percentage"
                            stroke="#0B1F3A"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exam term</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">%</TableHead>
                      <TableHead className="text-center">Grade</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.termName}</TableCell>
                        <TableCell className="text-center">
                          {row.totalObtained}/{row.totalMax}
                        </TableCell>
                        <TableCell className={`text-center font-medium ${pctColor(row.percentage)}`}>
                          {row.percentage}%
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{row.grade}</Badge>
                        </TableCell>
                        <TableCell className="text-zinc-500">{row.remarks || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================================================================
   PAGE SHELL
   ================================================================== */

export default function ResultsPage() {
  const { profile, loading: authLoading } = useAuth();
  const schoolId = profile?.schoolId ?? "";

  const [tab, setTab] = useState<Tab>("marks");
  const [examTerms, setExamTerms] = useState<ExamTerm[]>([]);
  const [termsLoading, setTermsLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [subjectCatalog, setSubjectCatalog] = useState<Subject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = examTermsService.subscribeToExamTerms(schoolId, (terms) => {
      setExamTerms(terms);
      setTermsLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = studentsService.subscribeToStudents(schoolId, (list) => {
      setStudents(list);
      setStudentsLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  // Subjects catalog + classes — what makes exam-term subjects and
  // the class picker relational instead of free-typed/hardcoded.
  useEffect(() => {
    if (!schoolId) return;
    const unsub = subjectsService.subscribeToSubjects(schoolId, (list) => {
      setSubjectCatalog(list);
      setSubjectsLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = classesService.subscribeToClasses(schoolId, (list) => {
      setClasses(list);
      setClassesLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  const loading =
    authLoading || termsLoading || studentsLoading || subjectsLoading || classesLoading;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "marks", label: "Enter Marks", icon: ClipboardList },
    { id: "performance", label: "Class Performance", icon: BarChart2 },
    { id: "lookup", label: "Student Lookup", icon: Search },
    { id: "terms", label: "Exam Terms", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Exam Results</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Performance records and reports — using your school's own exam model.
          </p>

          <div className="mt-5 flex flex-wrap gap-2 border-b border-zinc-100">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                  tab === id
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-400 hover:text-zinc-600"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : examTerms.length === 0 && tab !== "terms" ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <BookOpen className="h-8 w-8 text-zinc-300" />
              <p className="text-sm font-semibold text-zinc-600">Set up an exam term first</p>
              <p className="max-w-sm text-sm text-zinc-400">
                Before entering marks or viewing performance, define at least one exam
                term (e.g. "FA1") and its subjects.
              </p>
              <Button onClick={() => setTab("terms")} className="mt-1 gap-1.5">
                <Plus className="h-4 w-4" />
                Go to Exam Terms
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            {tab === "marks" && (
              <EnterMarksTab
                schoolId={schoolId}
                examTerms={examTerms}
                students={students}
                classes={classes}
                enteredBy={profile?.uid}
              />
            )}
            {tab === "performance" && (
              <ClassPerformanceTab
                schoolId={schoolId}
                examTerms={examTerms}
                students={students}
                classes={classes}
              />
            )}
            {tab === "lookup" && (
              <StudentLookupTab schoolId={schoolId} examTerms={examTerms} students={students} />
            )}
            {tab === "terms" && (
              <ExamTermsTab
                schoolId={schoolId}
                examTerms={examTerms}
                loading={termsLoading}
                subjectCatalog={subjectCatalog}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}