/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/subjects/page.tsx
 *
 * Purpose:
 * Two separate concerns, on two tabs — deliberately not combined:
 *
 * 1. Catalog — the school's global list of subjects (name + category
 *    only). Backed by subjectsService.
 * 2. Class Assignments — which catalog subjects each class offers,
 *    stored as `subjectIds` on the class document. Backed by
 *    classesService.updateClassSubjects.
 *
 * Changes from the previous version of this page:
 * - No more per-class, per-subject maxMarks/passingMarks. Marks are
 *   an exam-term concern (types/results.ts ExamSubject), not a
 *   subject-catalog concern — a subject's marks can differ between
 *   FA1 and SA1, so they were never a property of the subject itself.
 * - No more `AVAILABLE_SUBJECTS_POOL` / hardcoded CLASSES list — both
 *   are now live Firestore data (subjectsService, classesService).
 * - "Import Board Template" now imports subject NAMES only into the
 *   catalog (skipping ones that already exist); it no longer
 *   generates a full duplicated per-class curriculum with marks.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Plus,
  Search,
  MoreVertical,
  Edit,
  Ban,
  Trash2,
  Download,
  BookOpen,
  Layers,
  Sparkles,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { subjectsService } from "@/services/academic/subjectsService";
import { classesService } from "@/services/academic/classesService";
import { Subject, SubjectFormValues, ClassSummary } from "@/types/academic";
import { BOARDS, BOARD_TEMPLATES, BoardType } from "@/constants/academic";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Form schema ──────────────────────────────────────────────────────────
const subjectFormSchema = z.object({
  name: z.string().min(2, "Subject name must be at least 2 characters"),
  category: z.enum(["Core", "Elective", "Language"]),
  isActive: z.boolean(),
});

const EMPTY_FORM: SubjectFormValues = { name: "", category: "Core", isActive: true };

// ── Style helpers ────────────────────────────────────────────────────────
function categoryBadgeClass(category: Subject["category"]): string {
  if (category === "Language") return "bg-sky-50 text-sky-700 border-sky-200/60";
  if (category === "Elective") return "bg-amber-50 text-amber-700 border-amber-200/60";
  return "bg-indigo-50 text-indigo-700 border-indigo-200/60";
}

type Tab = "catalog" | "assignments";

export default function AcademicSubjectsPage() {
  const { profile, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<Tab>("catalog");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Catalog tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [removingSubject, setRemovingSubject] = useState<Subject | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Import Board Template dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importBoard, setImportBoard] = useState<BoardType>("CBSE");
  const [isImporting, setIsImporting] = useState(false);

  // Class Assignments tab state
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [pendingSubjectIds, setPendingSubjectIds] = useState<string[]>([]);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  const form = useForm<SubjectFormValues>({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: EMPTY_FORM,
  });

  // ── Subscriptions ────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;

    let subjectsLoaded = false;
    let classesLoaded = false;
    const markLoaded = () => {
      if (subjectsLoaded && classesLoaded) setLoading(false);
    };

    const unsubSubjects = subjectsService.subscribeToSubjects(profile.schoolId, (list) => {
      setSubjects(list);
      subjectsLoaded = true;
      markLoaded();
    });

    const unsubClasses = classesService.subscribeToClasses(profile.schoolId, (list) => {
      setClasses(list);
      classesLoaded = true;
      markLoaded();
    });

    return () => {
      unsubSubjects();
      unsubClasses();
    };
  }, [profile?.schoolId, authLoading]);

  // Default the class picker to the first class once classes arrive.
  useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  // Reset the pending checkbox state whenever the selected class changes
  // (or its stored subjectIds change from elsewhere).
  useEffect(() => {
    const current = classes.find((c) => c.id === selectedClassId);
    setPendingSubjectIds(current?.subjectIds ?? []);
  }, [selectedClassId, classes]);

  // ── Derived data ─────────────────────────────────────────────────────
  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => a.orderIndex - b.orderIndex),
    [subjects]
  );

  const filteredSubjects = useMemo(() => {
    if (!searchQuery.trim()) return sortedSubjects;
    const q = searchQuery.toLowerCase();
    return sortedSubjects.filter((s) => s.name.toLowerCase().includes(q));
  }, [sortedSubjects, searchQuery]);

  const activeSubjects = useMemo(() => subjects.filter((s) => s.isActive), [subjects]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );

  const isAssignmentsDirty = useMemo(() => {
    if (!selectedClass) return false;
    const a = [...selectedClass.subjectIds].sort();
    const b = [...pendingSubjectIds].sort();
    return a.length !== b.length || a.some((id, i) => id !== b[i]);
  }, [selectedClass, pendingSubjectIds]);

  // ── Catalog handlers ─────────────────────────────────────────────────
  const openCreateSheet = () => {
    setIsCreating(true);
    setEditingSubject(null);
    form.reset(EMPTY_FORM);
    setSheetOpen(true);
  };

  const openEditSheet = (subject: Subject) => {
    setIsCreating(false);
    setEditingSubject(subject);
    form.reset({ name: subject.name, category: subject.category, isActive: subject.isActive });
    setSheetOpen(true);
  };

  const handleSaveSubject = async (values: SubjectFormValues) => {
    if (!profile?.schoolId) return;
    setIsSaving(true);
    try {
      if (isCreating) {
        await subjectsService.createSubject(profile.schoolId, values, subjects);
        toast.success(`${values.name} added to the catalog`);
      } else if (editingSubject) {
        await subjectsService.updateSubject(profile.schoolId, editingSubject.id, values, subjects);
        toast.success(`${values.name} updated`);
      }
      setSheetOpen(false);
      setEditingSubject(null);
      setIsCreating(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save subject.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (subject: Subject) => {
    if (!profile?.schoolId) return;
    try {
      await subjectsService.toggleActive(profile.schoolId, subject.id, !subject.isActive);
      toast.success(subject.isActive ? `${subject.name} disabled` : `${subject.name} enabled`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update subject.");
    }
  };

  const handleDeleteSubject = async () => {
    if (!profile?.schoolId || !removingSubject) return;
    try {
      await subjectsService.deleteSubject(profile.schoolId, removingSubject.id);
      toast.success(`${removingSubject.name} removed from the catalog`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove subject.");
    } finally {
      setRemovingSubject(null);
    }
  };

  const handleImportTemplate = async () => {
    if (!profile?.schoolId) return;
    const template = BOARD_TEMPLATES[importBoard];
    if (!template) {
      toast.error("This board has no recommended template — add subjects manually.");
      return;
    }

    setIsImporting(true);
    try {
      const { added, skipped } = await subjectsService.importTemplate(
        profile.schoolId,
        template,
        subjects
      );
      if (added === 0) {
        toast.info("All recommended subjects already exist in your catalog.");
      } else {
        toast.success(
          `${added} subject${added === 1 ? "" : "s"} added` +
            (skipped > 0 ? `, ${skipped} already existed` : "")
        );
      }
      setImportDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import template.");
    } finally {
      setIsImporting(false);
    }
  };

  // ── Class Assignments handlers ───────────────────────────────────────
  const toggleAssignedSubject = (subjectId: string) => {
    setPendingSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    );
  };

  const handleSaveAssignments = async () => {
    if (!profile?.schoolId || !selectedClassId) return;
    setIsSavingAssignments(true);
    try {
      await classesService.updateClassSubjects(profile.schoolId, selectedClassId, pendingSubjectIds);
      toast.success(`Subjects updated for ${selectedClass?.className ?? "class"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save assignments.");
    } finally {
      setIsSavingAssignments(false);
    }
  };

  const handleDiscardAssignments = () => {
    setPendingSubjectIds(selectedClass?.subjectIds ?? []);
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-96" />
        <Skeleton className="mt-8 h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-serif font-semibold tracking-tight text-slate-900">
            Subjects
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage your school&apos;s subject catalog and which classes offer each subject.
          </p>
        </div>
        {tab === "catalog" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              className="h-9 border-slate-200/80 text-xs font-medium"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Import Board Template
            </Button>
            <Button
              size="sm"
              onClick={openCreateSheet}
              className="h-9 bg-slate-900 text-white hover:bg-slate-800 text-xs font-medium"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Subject
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-1 border-b border-slate-200/80">
        <button
          type="button"
          onClick={() => setTab("catalog")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "catalog"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >
          <BookOpen className="h-4 w-4" />
          Catalog
        </button>
        <button
          type="button"
          onClick={() => setTab("assignments")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "assignments"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >
          <Layers className="h-4 w-4" />
          Class Assignments
        </button>
      </div>

      {/* ── Catalog tab ──────────────────────────────────────────────── */}
      {tab === "catalog" && (
        <div className="mt-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search subjects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 text-xs bg-slate-50/50 border-slate-200/80"
            />
          </div>

          {filteredSubjects.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50">
                <BookOpen className="h-8 w-8 text-slate-300" />
              </div>
              <h4 className="mt-5 text-base font-semibold text-slate-900">
                {subjects.length === 0 ? "No subjects yet" : "No subjects match your search"}
              </h4>
              {subjects.length === 0 && (
                <>
                  <p className="mt-2 max-w-sm text-sm text-slate-500">
                    Import a board template to get started quickly, or add your first subject
                    manually.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setImportDialogOpen(true)}
                      className="text-xs"
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Import board template
                    </Button>
                    <Button
                      size="sm"
                      onClick={openCreateSheet}
                      className="bg-slate-900 text-white hover:bg-slate-800 text-xs"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add your first subject
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSubjects.map((subject) => (
                <Card key={subject.id} className="border-slate-200/80">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {subject.name}
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "mt-1.5 border font-medium text-[11px]",
                            categoryBadgeClass(subject.category)
                          )}
                        >
                          {subject.category}
                        </Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-slate-400 hover:text-slate-600"
                          >
                            <span className="sr-only">Actions</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={() => openEditSheet(subject)}
                            className="cursor-pointer text-xs"
                          >
                            <Edit className="mr-2 h-3.5 w-3.5 text-slate-500" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleToggleActive(subject)}
                            className="cursor-pointer text-xs"
                          >
                            <Ban className="mr-2 h-3.5 w-3.5 text-slate-500" />
                            {subject.isActive ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setRemovingSubject(subject)}
                            className="cursor-pointer text-xs text-rose-600 focus:text-rose-600"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5 text-rose-500" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "border font-medium text-[11px]",
                          subject.isActive
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                            : "bg-slate-100 text-slate-500 border-slate-200/60"
                        )}
                      >
                        {subject.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Class Assignments tab ────────────────────────────────────── */}
      {tab === "assignments" && (
        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-56 lg:self-start">
            <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Classes
                </p>
              </div>
              <nav className="max-h-[calc(100vh-280px)] overflow-y-auto p-1.5">
                {classes.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">
                    No classes yet. Add classes in Academic settings first.
                  </p>
                ) : (
                  classes.map((cls) => {
                    const isActive = selectedClassId === cls.id;
                    return (
                      <button
                        key={cls.id}
                        type="button"
                        onClick={() => setSelectedClassId(cls.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          isActive
                            ? "bg-slate-900 text-white font-medium shadow-sm"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        )}
                      >
                        <span className="truncate">{cls.className}</span>
                        {cls.subjectIds.length > 0 && (
                          <span
                            className={cn(
                              "ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                              isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                            )}
                          >
                            {cls.subjectIds.length}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </nav>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {!selectedClass ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
                Select a class to configure its subjects.
              </p>
            ) : (
              <>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {selectedClass.className} Subjects
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Choose which catalog subjects {selectedClass.className} offers.
                    </p>
                  </div>
                  {isAssignmentsDirty && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleDiscardAssignments}
                        disabled={isSavingAssignments}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 bg-slate-900 text-xs text-white hover:bg-slate-800"
                        onClick={handleSaveAssignments}
                        disabled={isSavingAssignments}
                      >
                        {isSavingAssignments ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save Changes
                      </Button>
                    </div>
                  )}
                </div>

                {activeSubjects.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
                    No active subjects in your catalog yet — add some on the Catalog tab first.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {activeSubjects.map((subject) => {
                      const checked = pendingSubjectIds.includes(subject.id);
                      return (
                        <button
                          key={subject.id}
                          type="button"
                          onClick={() => toggleAssignedSubject(subject.id)}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors",
                            checked
                              ? "border-slate-900 bg-slate-900/3"
                              : "border-slate-200/80 bg-white hover:border-slate-300"
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {subject.name}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-1.5 border font-medium text-[11px]",
                                categoryBadgeClass(subject.category)
                              )}
                            >
                              {subject.category}
                            </Badge>
                          </div>
                          <div
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                              checked
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white"
                            )}
                          >
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {/* ── Add/Edit subject sheet ───────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="border-b border-slate-100 pb-4">
            <SheetTitle className="font-serif text-lg text-slate-900">
              {isCreating ? "Add Subject" : "Edit Subject"}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              {isCreating
                ? "Add a new subject to your school's catalog."
                : "Update this subject's details."}
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSaveSubject)}
              className="flex flex-col gap-5 px-1 py-6"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">
                      Subject Name
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Physics" className="h-9 text-xs" {...field} />
                    </FormControl>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">
                      Category
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Core" className="text-xs">
                          Core
                        </SelectItem>
                        <SelectItem value="Elective" className="text-xs">
                          Elective
                        </SelectItem>
                        <SelectItem value="Language" className="text-xs">
                          Language
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-slate-200/80 px-3 py-2.5">
                    <FormLabel className="text-xs font-medium text-slate-700">
                      Active
                    </FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <SheetFooter className="mt-2 flex-row gap-2 border-t border-slate-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setSheetOpen(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="flex-1 bg-slate-900 text-white hover:bg-slate-800 text-xs"
                  disabled={isSaving}
                >
                  {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save Changes
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      {/* ── Import Board Template dialog ─────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg text-slate-900 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Import Board Template
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Adds a board&apos;s recommended subjects to your catalog. Subjects that already
              exist are skipped — nothing is overwritten, and you can edit or remove anything
              afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Board
              </label>
              <Select value={importBoard} onValueChange={(v) => setImportBoard(v as BoardType)}>
                <SelectTrigger className="h-9 text-xs bg-slate-50/50 border-slate-200/80">
                  <SelectValue placeholder="Select board" />
                </SelectTrigger>
                <SelectContent>
                  {BOARDS.map((board) => (
                    <SelectItem key={board} value={board} className="text-xs">
                      {board}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {BOARD_TEMPLATES[importBoard] ? (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
                <p className="mb-2 text-xs font-semibold text-slate-700">Will add</p>
                <div className="flex flex-wrap gap-1.5">
                  {BOARD_TEMPLATES[importBoard]!.map((s) => (
                    <Badge
                      key={s.name}
                      variant="outline"
                      className="text-[10px] font-medium bg-white"
                    >
                      {s.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
                Custom has no recommended template — add subjects manually on the Catalog tab.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(false)}
              className="text-xs"
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleImportTemplate}
              className="bg-slate-900 text-white hover:bg-slate-800 text-xs"
              disabled={isImporting || !BOARD_TEMPLATES[importBoard]}
            >
              {isImporting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Import Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────────── */}
      <AlertDialog
        open={!!removingSubject}
        onOpenChange={(open) => !open && setRemovingSubject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg">Remove Subject?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-500">
              This will remove{" "}
              <span className="font-semibold text-slate-900">{removingSubject?.name}</span> from
              the catalog entirely. Classes that currently offer it will keep referencing it until
              you update their assignments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSubject}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs h-8"
            >
              Remove Subject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}