/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/students/page.tsx
 *
 * Tailwind / shadcn migration
 * ----------------------------
 * - All hand-rolled CSS (the giant <style> block, BEM-ish `.sp-*`
 *   classes, inline style objects for color) has been replaced with
 *   Tailwind utility classes and shadcn/ui primitives.
 * - Custom drawer -> shadcn `Sheet`
 * - Custom confirm modal -> shadcn `AlertDialog`
 * - Filter/select inputs -> shadcn `Select`
 * - Loading shimmer rows -> shadcn `Skeleton`
 * - Status/fee pills -> shadcn `Badge` with per-status color overrides
 * - Table -> shadcn `Table` primitives
 * - No functional changes: same state, same service calls, same
 *   validation/save/delete flow as the original.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { studentsService } from '@/services/students/studentsService';
import { GRADES, SECTIONS, BLOOD_GROUPS } from '@/constants/students';
import {
  Student, StudentFormValues, StudentStatus,
  StudentSortKey, STUDENTS_PAGE_SIZE,
} from '@/types/students';
import {
  Search, Plus, X, Loader2,
  Phone, User, BookOpen, Pencil, Trash2, Check,
  Mail, Hash, Calendar, Users, AlertCircle, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

// ── Empty form ─────────────────────────────────────────────────────────────
const EMPTY_FORM: StudentFormValues = {
  name: '', rollNo: '', gender: 'Male', dob: '', bloodGroup: '',
  apaarId: '', penId: '',
  className: '', section: '', fatherName: '', fatherPhone: '',
  email: '', phone: '', address: '', status: 'active',
};

// Tailwind classes per status, kept close to the original hex palette.

const STATUS_BADGE: Record<StudentStatus, string> = {
  active:      'bg-green-50 text-green-600 border-green-200',
  inactive:    'bg-slate-50 text-slate-400 border-slate-200',
  transferred: 'bg-blue-50 text-blue-600 border-blue-200',
};

// Font-family utilities (Tailwind arbitrary values) so we don't need a
// project-wide font config change just for this page.
const FONT_SERIF = "font-['Instrument_Serif',serif]";
const FONT_MONO = "font-['Geist_Mono',monospace]";

// ── Helpers ────────────────────────────────────────────────────────────────
function initials(name: string) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function formatAdmissionDate(createdAtMs: number): string {
  if (!createdAtMs) return '';
  return new Date(createdAtMs).toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
export default function StudentsPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  // allStudents = the full cached roster (synced from Firestore via
  // delta-sync, see studentsService.syncStudents). Filtering, sorting,
  // and search all run in-memory over this — no Firestore query is
  // fired for any of that.
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [search,      setSearch]      = useState('');
  const [gradeFilter, setGradeFilter] = useState('All');
  const [secFilter,   setSecFilter]   = useState('All');
  const [sortKey,     setSortKey]     = useState<StudentSortKey>('name');
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('asc');

  // Purely a rendering concern now — slices the already-filtered
  // in-memory array. Resets to 0 whenever the filters/search/sort
  // change, since the result set underneath it just changed.
  const [pageNum, setPageNum] = useState(0);

  // Drawer
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editTarget,  setEditTarget]  = useState<Student | null>(null);
  const [form,        setForm]        = useState<StudentFormValues>(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);
  const [formError,   setFormError]   = useState('');

  // Detail panel
  const [selected,    setSelected]    = useState<Student | null>(null);

  // Delete confirm
  const [deleteId,    setDeleteId]    = useState<string | null>(null);

  // ── Sync the local cache on open, and expose a manual refresh ──────────
  // No live listener here on purpose — student data changes rarely, so
  // a live subscription would cost a lot of reads for very little
  // benefit. syncStudents() only reads what changed since last time
  // (or everything, on a cold cache) and is cheap to call often.
  async function refreshStudents() {
    if (!schoolId) return;
    try {
      const result = await studentsService.syncStudents(schoolId);
      setAllStudents(result);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    refreshStudents().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await refreshStudents();
    setRefreshing(false);
  }

  // ── Filter + search + sort, all in-memory ───────────────────────────────
  const filtered = allStudents
    .filter(s => {
      const q = search.trim().toLowerCase();
      const matchSearch = !q
        || s.profile.name.toLowerCase().includes(q)
        || s.profile.rollNo.toLowerCase().includes(q)
        || s.parent.fatherName.toLowerCase().includes(q)
        || s.parent.fatherPhone.includes(q);
      const matchGrade = gradeFilter === 'All' || s.className === gradeFilter;
      const matchSec   = secFilter   === 'All' || s.section === secFilter;
      return matchSearch && matchGrade && matchSec;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'rollNo') {
        const an = parseInt(a.profile.rollNo, 10);
        const bn = parseInt(b.profile.rollNo, 10);
        cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : a.profile.rollNo.localeCompare(b.profile.rollNo);
      } else if (sortKey === 'className') {
        const an = parseInt(a.className, 10);
        const bn = parseInt(b.className, 10);
        cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : a.className.localeCompare(b.className);
      } else {
        cmp = a.profile.name.localeCompare(b.profile.name);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // Reset to page 1 whenever the filtered result set changes shape.
  useEffect(() => { setPageNum(0); }, [search, gradeFilter, secFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / STUDENTS_PAGE_SIZE));
  const pageStudents = filtered.slice(pageNum * STUDENTS_PAGE_SIZE, (pageNum + 1) * STUDENTS_PAGE_SIZE);

  function goNextPage() { setPageNum(p => Math.min(totalPages - 1, p + 1)); }
  function goPrevPage() { setPageNum(p => Math.max(0, p - 1)); }

  function toggleSort(key: StudentSortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  // ── Open drawer ─────────────────────────────────────────────────────────
  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setDrawerOpen(true);
  }
  function openEdit(s: Student) {
    setEditTarget(s);
    setForm({
      name: s.profile.name,
      rollNo: s.profile.rollNo,
      gender: s.profile.gender,
      dob: s.profile.dob,
      bloodGroup: s.profile.bloodGroup,
      apaarId: s.profile.apaarId ?? '',
      penId: s.profile.penId ?? '',
      className: s.className,
      section: s.section ?? '',
      fatherName: s.parent.fatherName,
      fatherPhone: s.parent.fatherPhone,
      email: s.contact.email,
      phone: s.contact.phone,
      address: s.contact.address,
      status: s.status,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!schoolId) return;
    setSaving(true); setFormError('');
    try {
      if (editTarget?.id) {
        await studentsService.updateStudent(schoolId, editTarget.id, form);
        if (selected?.id === editTarget.id) {
          setSelected({
            ...selected,
            profile: { ...selected.profile, name: form.name, rollNo: form.rollNo, gender: form.gender, dob: form.dob, bloodGroup: form.bloodGroup, apaarId: form.apaarId, penId: form.penId },
            className: form.className,
            section: form.section || null,
            parent: { ...selected.parent, fatherName: form.fatherName, fatherPhone: form.fatherPhone },
            contact: { email: form.email, phone: form.phone, address: form.address },
            status: form.status,
          });
        }
      } else {
        await studentsService.createStudent(schoolId, form);
      }
      await refreshStudents();
      setDrawerOpen(false);
      setEditTarget(null);
    } catch (e) {
      console.error(e);
      setFormError(e instanceof Error ? e.message : 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!schoolId) return;
    await studentsService.deleteStudent(schoolId, id);
    await refreshStudents();
    if (selected?.id === id) setSelected(null);
    setDeleteId(null);
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = {
    total:  allStudents.length,
    active: allStudents.filter(s => s.status === 'active').length,
  };

  const sortArrow = (key: StudentSortKey) => sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Fonts used across the page. Tailwind config doesn't define these
          families project-wide, so we pull them in here and reference them
          via arbitrary-value classes (font-['Geist',sans-serif] etc). */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
      `}</style>

      <div className="flex min-h-full flex-col bg-slate-50 text-slate-900 font-['Geist',sans-serif]">

        {/* ── Topbar ────────────────────────────────────────────────── */}
        <div className="sticky -top-6.25 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h1 className={cn(FONT_SERIF, 'text-[1.3rem] font-normal leading-none text-slate-900')}>Students</h1>
            <p className="mt-0.5 text-[0.72rem] text-slate-400">Enrolled students · {schoolId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              className="h-8.5 gap-1.5 border-slate-200 text-xs text-slate-600"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''}/> Refresh
            </Button>
            <Button onClick={openAdd} className="h-8.5 gap-1.5 bg-slate-900 text-xs font-semibold hover:bg-slate-800">
              <Plus size={14}/> Enroll Student
            </Button>
          </div>
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <div className="flex overflow-x-auto border-b border-slate-200 bg-white">
          {[
            { label: 'Total',    val: stats.total   },
            { label: 'Active',   val: stats.active  },
          ].map(s => (
            <div className="flex shrink-0 flex-col gap-0.5 border-r border-slate-100 px-7 py-3.5" key={s.label}>
              <span className="text-[0.6rem] font-bold uppercase tracking-widest text-slate-400">{s.label}</span>
              <span className={cn(FONT_MONO, 'text-[1.3rem] font-semibold leading-none text-slate-900')}>{s.val}</span>
            </div>
          ))}
        </div>

        {/* ── Toolbar ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 bg-white px-7 py-3.5">
          <div className="relative min-w-50 max-w-75 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300"/>
            <Input
              placeholder="Search name, roll no, parent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8.5 rounded-md border-slate-200 bg-slate-50 pl-8 text-[0.82rem] placeholder:text-slate-300 focus-visible:bg-white"
            />
          </div>

          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="h-8.5 w-auto rounded-md border-slate-200 bg-slate-50 text-xs text-slate-600">
              <SelectValue placeholder="All Grades"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Grades</SelectItem>
              {GRADES.map(g => <SelectItem key={g} value={g}>Grade {g}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={secFilter} onValueChange={setSecFilter}>
            <SelectTrigger className="h-8.5 w-auto rounded-md border-slate-200 bg-slate-50 text-xs text-slate-600">
              <SelectValue placeholder="All Sections"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Sections</SelectItem>
              {SECTIONS.map(s => <SelectItem key={s} value={s}>Section {s}</SelectItem>)}
            </SelectContent>
          </Select>

          <span className={cn(FONT_MONO, 'ml-auto whitespace-nowrap text-[0.72rem] text-slate-400')}>
            {filtered.length} student{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* Table */}
          <div className="flex-1 overflow-y-auto px-7 py-5">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 bg-slate-50 hover:bg-slate-50">
                    <TableHead className="w-10"></TableHead>
                    <TableHead
                      className={cn('cursor-pointer select-none text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400 hover:text-slate-600', sortKey === 'name' && 'text-slate-900')}
                      onClick={() => toggleSort('name')}
                    >
                      Name {sortArrow('name')}
                    </TableHead>
                    <TableHead
                      className={cn('cursor-pointer select-none text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400 hover:text-slate-600', sortKey === 'rollNo' && 'text-slate-900')}
                      onClick={() => toggleSort('rollNo')}
                    >
                      Roll No {sortArrow('rollNo')}
                    </TableHead>
                    <TableHead
                      className={cn('cursor-pointer select-none text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400 hover:text-slate-600', sortKey === 'className' && 'text-slate-900')}
                      onClick={() => toggleSort('className')}
                    >
                      Grade {sortArrow('className')}
                    </TableHead>
                    <TableHead className="text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400">Parent</TableHead>
                    <TableHead className="text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400">Phone</TableHead>
                    <TableHead className="text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-400">Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell colSpan={8} className="p-0">
                          <Skeleton className="h-13 w-full rounded-none" style={{ animationDelay: `${i * 80}ms` }}/>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : pageStudents.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8}>
                        <div className="flex flex-col items-center gap-3 px-8 py-16">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border-[1.5px] border-dashed border-slate-200 text-slate-300">
                            <Users size={20}/>
                          </div>
                          <h3 className="text-[0.88rem] font-semibold text-slate-600">
                            {search ? 'No students match your search' : 'No students enrolled yet'}
                          </h3>
                          <p className="text-[0.75rem] text-slate-400">
                            {search ? 'Try adjusting filters' : 'Click "Enroll Student" to get started'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : pageStudents.map(s => (
                    <TableRow
                      key={s.id}
                      className={cn('group cursor-pointer border-b border-slate-50 last:border-0', selected?.id === s.id && 'bg-blue-50 hover:bg-blue-50')}
                      onClick={() => setSelected(s)}
                    >
                      <TableCell>
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[0.65rem] font-bold tracking-wide text-white"
                          style={{ background: s.avatarColor }}
                        >
                          {initials(s.profile.name)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-[0.83rem] font-semibold text-slate-900">{s.profile.name}</div>
                        <div className={cn(FONT_MONO, 'text-[0.68rem] text-slate-400')}>{s.contact.email}</div>
                      </TableCell>
                      <TableCell className={cn(FONT_MONO, 'text-[0.78rem]')}>{s.profile.rollNo || '—'}</TableCell>
                      <TableCell>
                        <span className="font-semibold">{s.className}</span>
                        {s.section && <span className="ml-1 text-slate-400">/ {s.section}</span>}
                      </TableCell>
                      <TableCell className="text-slate-600">{s.parent.fatherName || '—'}</TableCell>
                      <TableCell className={cn(FONT_MONO, 'text-[0.75rem] text-slate-500')}>{s.parent.fatherPhone || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('rounded-full border px-2.5 py-0.5 text-[0.65rem] font-bold', STATUS_BADGE[s.status])}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            title="Edit"
                            onClick={() => openEdit(s)}
                            className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                          >
                            <Pencil size={12}/>
                          </button>
                          <button
                            title="Delete"
                            onClick={() => setDeleteId(s.id)}
                            className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────── */}
            <div className="mt-3 flex items-center justify-between px-1">
              <span className={cn(FONT_MONO, 'text-[0.72rem] text-slate-400')}>
                Page {pageNum + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNum === 0 || loading}
                  onClick={goPrevPage}
                  className="h-7.5 gap-1 border-slate-200 text-xs text-slate-600"
                >
                  <ChevronLeft size={13}/> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNum >= totalPages - 1 || loading}
                  onClick={goNextPage}
                  className="h-7.5 gap-1 border-slate-200 text-xs text-slate-600"
                >
                  Next <ChevronRight size={13}/>
                </Button>
              </div>
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="flex w-75 min-w-75 flex-col overflow-y-auto border-l border-slate-200 bg-white">
              <div className="sticky top-0 z-2 bg-white px-5 pt-5">
                <button
                  onClick={() => setSelected(null)}
                  className="ml-auto mb-4 flex h-6.5 w-6.5 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-900"
                >
                  <X size={13}/>
                </button>
                <div
                  className={cn(FONT_SERIF, 'mx-auto mb-3.5 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl text-white')}
                  style={{ background: selected.avatarColor }}
                >
                  {initials(selected.profile.name)}
                </div>
                <div className={cn(FONT_SERIF, 'text-center text-[1.1rem] font-normal leading-tight text-slate-900')}>
                  {selected.profile.name}
                </div>
                <div className={cn(FONT_MONO, 'mt-0.5 text-center text-[0.72rem] text-slate-400')}>
                  {selected.profile.rollNo ? `#${selected.profile.rollNo} · ` : ''}Grade {selected.className}{selected.section ? ` / ${selected.section}` : ''}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                  <Badge variant="outline" className={cn('rounded-full border px-2.5 py-0.5 text-[0.65rem] font-bold', STATUS_BADGE[selected.status])}>
                    {selected.status}
                  </Badge>
                  {selected.profile.bloodGroup && (
                    <Badge variant="outline" className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[0.65rem] font-bold text-green-600">
                      {selected.profile.bloodGroup}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex-1 p-5">
                {/* Personal */}
                <div className="mb-5">
                  <div className="mb-2.5 text-[0.58rem] font-bold uppercase tracking-[0.11em] text-slate-300">Personal</div>
                  {[
                    { icon: <User size={13}/>,     label: 'Gender',   val: selected.profile.gender },
                    { icon: <Calendar size={13}/>, label: 'D.O.B',    val: selected.profile.dob || '—' },
                    { icon: <Hash size={13}/>,     label: 'Blood',    val: selected.profile.bloodGroup || '—' },
                    { icon: <Hash size={13}/>,     label: 'APAAR ID', val: selected.profile.apaarId || '—' },
                    { icon: <Hash size={13}/>,     label: 'PEN',      val: selected.profile.penId || '—' },
                    { icon: <Calendar size={13}/>, label: 'Admitted', val: formatAdmissionDate(selected.createdAt) || '—' },
                  ].map(r => (
                    <div className="flex items-start gap-2.5 border-b border-slate-50 py-2 last:border-0" key={r.label}>
                      <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-400">{r.icon}</div>
                      <div>
                        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-slate-400">{r.label}</div>
                        <div className="mt-px text-[0.82rem] font-medium text-slate-900">{r.val}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Contact */}
                <div className="mb-5">
                  <div className="mb-2.5 text-[0.58rem] font-bold uppercase tracking-[0.11em] text-slate-300">Contact</div>
                  {[
                    { icon: <Mail size={13}/>,  label: 'Email', val: selected.contact.email || '—' },
                    { icon: <Phone size={13}/>, label: 'Phone', val: selected.contact.phone || '—' },
                  ].map(r => (
                    <div className="flex items-start gap-2.5 border-b border-slate-50 py-2 last:border-0" key={r.label}>
                      <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-400">{r.icon}</div>
                      <div>
                        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-slate-400">{r.label}</div>
                        <div className={cn(FONT_MONO, 'mt-px text-[0.78rem] font-medium text-slate-900')}>{r.val}</div>
                      </div>
                    </div>
                  ))}
                  {selected.contact.address && (
                    <div className="flex items-start gap-2.5 border-b border-slate-50 py-2 last:border-0">
                      <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-400"><BookOpen size={13}/></div>
                      <div>
                        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-slate-400">Address</div>
                        <div className="mt-px text-[0.82rem] font-medium text-slate-900">{selected.contact.address}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Parent/Guardian */}
                <div className="mb-5">
                  <div className="mb-2.5 text-[0.58rem] font-bold uppercase tracking-[0.11em] text-slate-300">Parent / Guardian</div>
                  {[
                    { icon: <User size={13}/>,  label: 'Name',  val: selected.parent.fatherName  || '—' },
                    { icon: <Phone size={13}/>, label: 'Phone', val: selected.parent.fatherPhone || '—' },
                  ].map(r => (
                    <div className="flex items-start gap-2.5 border-b border-slate-50 py-2 last:border-0" key={r.label}>
                      <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-400">{r.icon}</div>
                      <div>
                        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-slate-400">{r.label}</div>
                        <div className={cn(FONT_MONO, 'mt-px text-[0.78rem] font-medium text-slate-900')}>{r.val}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white p-5">
                <Button variant="outline" className="flex-1 gap-1.5 border-slate-200 text-slate-600" onClick={() => openEdit(selected)}>
                  <Pencil size={13}/> Edit
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-600"
                  onClick={() => setDeleteId(selected.id)}
                >
                  <Trash2 size={13}/> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit Drawer ──────────────────────────────────────────── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="flex w-105 max-w-full flex-col p-0 font-['Geist',sans-serif]">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className={cn(FONT_SERIF, 'text-[1.1rem] font-normal text-slate-900')}>
              {editTarget ? 'Edit Student' : 'Enroll Student'}
            </SheetTitle>
            <SheetDescription className="text-[0.72rem] text-slate-400">
              {editTarget ? `Editing ${editTarget.profile.name}` : 'Add a new student to the school'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {formError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[0.78rem] font-medium text-red-600">
                <AlertCircle size={14}/>{formError}
              </div>
            )}

            {/* Personal Info */}
            <div className="flex items-center gap-2 py-2 text-[0.6rem] font-bold uppercase tracking-widest text-slate-300 after:h-px after:flex-1 after:bg-slate-100">
              Personal Info
            </div>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Full Name *</label>
              <Input placeholder="e.g. Riya Sharma" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/>
            </div>
            <div className="mb-3.5 grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Gender</label>
                <Select value={form.gender} onValueChange={v => setForm({ ...form, gender: v as StudentFormValues['gender'] })}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Date of Birth</label>
                <Input type="date" value={form.dob} onChange={e => setForm({ ...form, dob: e.target.value })}/>
              </div>
            </div>
            <div className="mb-3.5 grid grid-cols-3 gap-2.5">
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Grade *</label>
                <Select value={form.className} onValueChange={v => setForm({ ...form, className: v })}>
                  <SelectTrigger><SelectValue placeholder="—"/></SelectTrigger>
                  <SelectContent>
                    {GRADES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Section</label>
                <Select
                  value={form.section || '__none__'}
                  onValueChange={v => setForm({ ...form, section: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="—"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No section</SelectItem>
                    {SECTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Roll No</label>
                <Input placeholder="001" value={form.rollNo} onChange={e => setForm({ ...form, rollNo: e.target.value })}/>
              </div>
            </div>
            <div className="mb-3.5 grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">APAAR ID</label>
                <Input placeholder="0000 0000 0000" maxLength={12} value={form.apaarId} onChange={e => setForm({ ...form, apaarId: e.target.value })}/>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">PEN</label>
                <Input placeholder="State enrollment no." value={form.penId} onChange={e => setForm({ ...form, penId: e.target.value })}/>
              </div>
            </div>
            <div className="mb-3.5 grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Blood Group</label>
                <Select value={form.bloodGroup} onValueChange={v => setForm({ ...form, bloodGroup: v })}>
                  <SelectTrigger><SelectValue placeholder="—"/></SelectTrigger>
                  <SelectContent>
                    {BLOOD_GROUPS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Status</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as StudentFormValues['status'] })}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="transferred">Transferred</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Contact */}
            <div className="flex items-center gap-2 py-2 text-[0.6rem] font-bold uppercase tracking-widest text-slate-300 after:h-px after:flex-1 after:bg-slate-100">
              Contact
            </div>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Address</label>
              <Input placeholder="Street, City" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/>
            </div>

            {/* Parent */}
            <div className="flex items-center gap-2 py-2 text-[0.6rem] font-bold uppercase tracking-widest text-slate-300 after:h-px after:flex-1 after:bg-slate-100">
              Parent / Guardian
            </div>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Parent Name</label>
              <Input placeholder="Parent full name" value={form.fatherName} onChange={e => setForm({ ...form, fatherName: e.target.value })}/>
            </div>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate-600">Parent Phone</label>
              <Input placeholder="+91 00000 00000" value={form.fatherPhone} onChange={e => setForm({ ...form, fatherPhone: e.target.value })}/>
            </div>
          </div>

          <SheetFooter className="flex-row gap-2.5 border-t border-slate-100 px-6 py-4 sm:justify-start">
            <Button variant="outline" className="flex-1 border-slate-200 text-slate-600" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleSave} className="flex-2 gap-1.5 bg-slate-900 hover:bg-slate-800">
              {saving
                ? <><Loader2 size={14} className="animate-spin"/> Saving…</>
                : <><Check size={14}/> {editTarget ? 'Save Changes' : 'Enroll Student'}</>}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-90 font-['Geist',sans-serif]">
          <AlertDialogHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-[10px] bg-red-50 text-red-600">
              <Trash2 size={18}/>
            </div>
            <AlertDialogTitle className="text-[0.95rem] font-bold text-slate-900">Delete student?</AlertDialogTitle>
            <AlertDialogDescription className="text-[0.78rem] leading-relaxed text-slate-600">
              This will mark the student as deleted and remove them from every list. Their record is kept for the school's records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-stretch">
            <AlertDialogCancel className="flex-1 border-slate-200 text-slate-600">Cancel</AlertDialogCancel>
            <Button
              className="flex-1 justify-center bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}