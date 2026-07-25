'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { studentsService } from '@/services/students/studentsService';
import { Student } from '@/types/students';
import { NO_SECTION_ID } from '@/lib/utils';
import {
  collection, onSnapshot, query, orderBy,
  doc, updateDoc, addDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import {
  Users, Plus, ArrowRight, Loader2, UserCheck, X, Hash,
  ChevronRight, GraduationCap, BarChart3, Search,
  SlidersHorizontal, Check, AlertCircle, Trash2, Layers,
  LayoutGrid, TableProperties,
} from 'lucide-react';
import '@/styles/config-academic.css';


// ── Types ──────────────────────────────────────────────────────────────────
interface Section {
  id: string;
  name: string;
  /** Real teacher document id — the source of truth. classTeacherName
   * is a denormalized display copy, kept in sync by handleAssignTeacher
   * below; never edited independently of classTeacherId. */
  classTeacherId?: string | null;
  classTeacherName?: string;
  roomNo?: string;
}

interface ClassGroup {
  id: string;
  className: string;
  sections: Section[];
  orderIndex?: number;
  /**
   * Class-level class-teacher assignment — only meaningful (and only
   * ever shown/editable) when sections.length === 0. A class either
   * has a teacher per section, or one teacher for the whole class
   * directly — never both. See handleAssignClassLevelTeacher.
   */
  classTeacherId?: string | null;
  classTeacherName?: string;
}

interface Teacher {
  id: string;
  name: string;
  classTeacherOf?: { classId: string; className: string; sectionId?: string; sectionName?: string } | null;
}

/**
 * "6-A" for a section-level assignment, "6" for a class-level one
 * (no sectionName) — classTeacherOf.sectionName is optional now that
 * a teacher can be class teacher of a whole class with no sections,
 * so every place that renders this needs to handle its absence
 * instead of interpolating `undefined` into the string.
 */
function formatClassTeacherOf(assignment: NonNullable<Teacher['classTeacherOf']>): string {
  return assignment.sectionName
    ? `${assignment.className}-${assignment.sectionName}`
    : assignment.className;
}

// ── Accent palette ─────────────────────────────────────────────────────────
const ACCENTS = [
  '#2563EB','#7C3AED','#059669','#D97706',
  '#DC2626','#0891B2','#9333EA','#16A34A',
  '#EA580C','#4F46E5','#BE185D','#0D9488',
];
const accent = (name: string) => {
  if (!name) return '#2563EB';
  const n = parseInt(name, 10);
  if (!isNaN(n)) return ACCENTS[(n - 1) % ACCENTS.length];
  const hash = name.split('').reduce((a, c) => c.charCodeAt(0) + a, 0);
  return ACCENTS[hash % ACCENTS.length];
};
const accentBg = (name: string) => `${accent(name)}12`;

type Tab = 'setup' | 'registry';

// ══════════════════════════════════════════════════════════════════════════════
export default function AcademicManagementPage() {
  const { profile, loading: authLoading } = useAuth();

  // ── Shared state ───────────────────────────────────────────────────────────
  const [tab,           setTab]          = useState<Tab>('setup');
  const [classes,       setClasses]      = useState<ClassGroup[]>([]);
  const [teachers,      setTeachers]     = useState<Teacher[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [isProcessing,  setIsProcessing] = useState(false);

  // ── Registry (tab 2) state ────────────────────────────────────────────────
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [search,        setSearch]        = useState('');

  // ── Setup (tab 1) state ───────────────────────────────────────────────────
  const [expandedId,    setExpandedId]   = useState<string | null>(null);

  // ── Modals ─────────────────────────────────────────────────────────────────
  // Add class
  const [classModal,    setClassModal]   = useState(false);
  const [newClassName,  setNewClassName] = useState('');
  const [classError,    setClassError]   = useState('');

  // Add section (shared)
  const [secModal,      setSecModal]     = useState(false);
  const [secTargetId,   setSecTargetId]  = useState('');
  const [newSecName,    setNewSecName]   = useState('');
  const [newSecRoom,    setNewSecRoom]   = useState('');
  const [newSecTeacher, setNewSecTeacher]= useState('');
  const [secError,      setSecError]     = useState('');

  // Delete confirms
  const [deleteClassId, setDeleteClassId]= useState<string | null>(null);
  const [deleteSec,     setDeleteSec]    = useState<{ classId: string; secId: string; secName: string } | null>(null);

  // ── Student counts (from the shared IndexedDB cache — same one the
  // Students admin page uses via studentsService.syncStudents, so this
  // is a cheap delta-sync against Firestore, not a fresh full read
  // every time this page loads) ────────────────────────────────────────
  const [students, setStudents] = useState<Student[]>([]);
  useEffect(() => {
    if (!profile?.schoolId) return;
    studentsService.syncStudents(profile.schoolId).then(setStudents).catch(console.error);
  }, [profile?.schoolId]);

  // classId_sectionId -> count, falling back to className_section
  // labels for any student written before the classId/sectionId
  // backfill — see collectAdmissionFee.ts's resolution fix. Prefers
  // the real IDs when present since they're immune to a class/section
  // rename that a label match would silently miss.
  const countsByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of students) {
      const key = s.classId && s.sectionId
        ? `${s.classId}_${s.sectionId}`
        : `label:${s.className}_${s.section ?? NO_SECTION_ID}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [students]);

  function countForSection(cls: ClassGroup, sec: Section): number {
    return countsByKey.get(`${cls.id}_${sec.id}`)
      ?? countsByKey.get(`label:${cls.className}_${sec.name}`)
      ?? 0;
  }

  /** For a class with NO sections — every student in that class counts, regardless of a stray section value. */
  function countForClass(cls: ClassGroup): number {
    return students.filter(s => (s.classId ? s.classId === cls.id : s.className === cls.className)).length;
  }

  // ── Firestore ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;

    const unsub1 = onSnapshot(
      query(collection(db, 'schools', profile.schoolId, 'classes'), orderBy('orderIndex', 'asc')),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as ClassGroup[];
        setClasses(data);
        setSelectedClass(prev => {
          if (prev && data.some(c => c.className === prev)) return prev;
          return data[0]?.className ?? null;
        });
        setLoading(false);
      }
    );

    const unsub2 = onSnapshot(
      collection(db, 'schools', profile.schoolId, 'teachers'),
      snap => setTeachers(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name || 'Unknown',
        classTeacherOf: d.data().classTeacherOf ?? null,
      })))
    );

    return () => { unsub1(); unsub2(); };
  }, [profile?.schoolId, authLoading]);

  // ── Handlers: Classes ──────────────────────────────────────────────────────
  async function handleAddClass() {
    const trimmed = newClassName.trim();
    if (!trimmed) { setClassError('Class name is required.'); return; }
    if (classes.some(c => c.className.toLowerCase() === trimmed.toLowerCase())) {
      setClassError('A class with this name already exists.'); return;
    }
    if (!profile?.schoolId) { setClassError('School is not selected.'); return; }
    setIsProcessing(true); setClassError('');
    try {
      await addDoc(collection(db, 'schools', profile.schoolId, 'classes'), {
        className: trimmed, sections: [], orderIndex: classes.length, updatedAt: serverTimestamp(),
      });
      setClassModal(false); setNewClassName('');
    } catch (e) { console.error(e); setClassError('Failed to add class.'); }
    finally { setIsProcessing(false); }
  }

  async function handleDeleteClass(classId: string) {
    const schoolId = profile?.schoolId;
    if (!schoolId) {
      console.error('School is not selected.');
      return;
    }
    const target = classes.find(c => c.id === classId);
    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'schools', schoolId, 'classes', classId));
      // Deleting a class must release every teacher reference it holds
      // — its own class-level assignment AND every section's — or
      // those teachers' classTeacherOf silently keeps pointing at a
      // class that no longer exists.
      if (target?.classTeacherId) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', target.classTeacherId), { classTeacherOf: null });
      }
      for (const sec of target?.sections ?? []) {
        if (sec.classTeacherId) {
          batch.update(doc(db, 'schools', schoolId, 'teachers', sec.classTeacherId), { classTeacherOf: null });
        }
      }
      await batch.commit();
      if (expandedId === classId) setExpandedId(null);
      if (selectedClass === target?.className) setSelectedClass(null);
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); setDeleteClassId(null); }
  }

  // ── Handlers: Sections ─────────────────────────────────────────────────────
  function openAddSection(classDocId: string) {
    setSecTargetId(classDocId);
    setNewSecName(''); setNewSecRoom(''); setNewSecTeacher(''); setSecError('');
    setSecModal(true);
  }

  /**
   * A teacher can be class-teacher of at most ONE thing at a time —
   * either one section, or (for a class with no sections at all) one
   * whole class directly, never both, never two. This is the single
   * place that invariant is enforced: given who's about to be newly
   * assigned and where, it finds every OTHER place (any class's
   * class-level slot, any class's any section) that currently lists
   * them and clears it.
   *
   * Returns per-class field patches rather than writing directly, so
   * callers can merge in their OWN target update for the same class
   * before writing — Firestore batches don't merge multiple writes to
   * the same document field, so if the class being newly assigned is
   * ALSO a class this function needs to clear something from (e.g.
   * reassigning a teacher from Class 2's whole-class slot to a section
   * within Class 2 itself), both changes have to land in one combined
   * write, not two competing ones.
   */
  function clearTeacherElsewhere(
    teacherId: string,
    exceptClassId: string,
    exceptSectionId: string | null, // null = the exception is the class-level slot, not a section
  ): Map<string, { sections?: Section[]; classTeacherId?: null; classTeacherName?: string }> {
    const patches = new Map<string, { sections?: Section[]; classTeacherId?: null; classTeacherName?: string }>();
    for (const cls of classes) {
      const patch: { sections?: Section[]; classTeacherId?: null; classTeacherName?: string } = {};
      let touched = false;

      if (cls.classTeacherId === teacherId && !(cls.id === exceptClassId && exceptSectionId === null)) {
        patch.classTeacherId = null;
        patch.classTeacherName = 'Not Assigned';
        touched = true;
      }

      const updatedSections = cls.sections.map(s =>
        s.classTeacherId === teacherId && !(cls.id === exceptClassId && s.id === exceptSectionId)
          ? { ...s, classTeacherId: null, classTeacherName: 'Not Assigned' }
          : s
      );
      if (updatedSections.some((s, i) => s !== cls.sections[i])) {
        patch.sections = updatedSections;
        touched = true;
      }

      if (touched) patches.set(cls.id, patch);
    }
    return patches;
  }

  async function handleAddSection() {
    const trimmed = newSecName.trim().toUpperCase();
    if (!trimmed || !profile?.schoolId) { setSecError('Section name is required.'); return; }
    const target = classes.find(c => c.id === secTargetId);
    if (!target) return;
    if (target.sections?.some(s => s.name === trimmed)) {
      setSecError('Section already exists in this class.'); return;
    }
    const schoolId = profile.schoolId;
    setIsProcessing(true); setSecError('');
    try {
      const preselectedTeacher = newSecTeacher ? teachers.find(t => t.id === newSecTeacher) ?? null : null;
      const newSecId = crypto.randomUUID();
      const newSec: Section = {
        id: newSecId, name: trimmed,
        classTeacherId: preselectedTeacher?.id ?? null,
        classTeacherName: preselectedTeacher?.name ?? 'Not Assigned',
        roomNo: newSecRoom.trim() || 'TBD',
      };

      // A brand-new section doesn't exist in `classes` yet, so there's
      // no "exceptSectionId" to protect — clear the preselected teacher
      // from anywhere else entirely, then separately append the new
      // section to whatever this class's patch (if any) ends up being.
      const patches = preselectedTeacher
        ? clearTeacherElsewhere(preselectedTeacher.id, '__new-section__', null)
        : new Map<string, { sections?: Section[] }>();

      const batch = writeBatch(db);
      for (const [classId, patch] of patches) {
        if (classId === target.id) continue; // merged into the target write below
        batch.update(doc(db, 'schools', schoolId, 'classes', classId), { ...patch, updatedAt: serverTimestamp() });
      }
      const targetPatch = patches.get(target.id);
      batch.set(doc(db, 'schools', schoolId, 'classes', target.id), {
        ...targetPatch,
        sections: [...(targetPatch?.sections ?? target.sections), newSec],
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (preselectedTeacher) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', preselectedTeacher.id), {
          classTeacherOf: {
            schoolId, classId: target.id, className: target.className,
            sectionId: newSecId, sectionName: trimmed,
          },
        });
      }

      await batch.commit();
      setSecModal(false); setNewSecName(''); setNewSecRoom(''); setNewSecTeacher('');
    } catch (e) { console.error(e); setSecError('Failed to add section.'); }
    finally { setIsProcessing(false); }
  }

  async function handleDeleteSection(classId: string, secId: string) {
    const target = classes.find(c => c.id === classId);
    if (!target || !profile?.schoolId) return;
    const schoolId = profile.schoolId;
    const removedSection = target.sections.find(s => s.id === secId);
    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'schools', schoolId, 'classes', classId), {
        sections: target.sections.filter(s => s.id !== secId), updatedAt: serverTimestamp(),
      });
      // Deleting a section also has to release its class-teacher's
      // reverse reference — otherwise their profile keeps pointing at
      // a section that no longer exists.
      if (removedSection?.classTeacherId) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', removedSection.classTeacherId), {
          classTeacherOf: null,
        });
      }
      await batch.commit();
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); setDeleteSec(null); }
  }

  /**
   * The core fix: classTeacher used to be stored as a raw teacher NAME
   * string on the section (Section.classTeacher), with no id and no
   * reverse reference on the teacher's own document at all — meaning
   * two same-named teachers were indistinguishable, renaming a teacher
   * silently orphaned every assignment, and a teacher's own profile had
   * no way to know which section they're the class teacher of.
   *
   * Now: classTeacherId is the real teacher doc id (source of truth),
   * classTeacherName is a denormalized display copy kept in sync here,
   * and teachers/{teacherId}.classTeacherOf is the reverse reference —
   * see types/teachers.ts's ClassTeacherAssignment.
   *
   * Uses the shared clearTeacherElsewhere so this stays consistent with
   * handleAssignClassLevelTeacher below — a section assignment here now
   * also clears a class-level (no-section) assignment elsewhere, and
   * vice versa, not just other sections.
   */
  async function handleAssignTeacher(classDocId: string, sectionId: string, teacherId: string) {
    if (!profile?.schoolId) return;
    const schoolId = profile.schoolId;
    const target = classes.find(c => c.id === classDocId);
    if (!target) return;
    const section = target.sections.find(s => s.id === sectionId);
    if (!section) return;

    const isUnassigning = !teacherId || teacherId === 'Not Assigned';
    const newTeacher = isUnassigning ? null : teachers.find(t => t.id === teacherId) ?? null;
    const previousTeacherId = section.classTeacherId ?? null;

    setIsProcessing(true);
    try {
      const patches = newTeacher
        ? clearTeacherElsewhere(newTeacher.id, classDocId, sectionId)
        : new Map<string, { sections?: Section[]; classTeacherId?: null; classTeacherName?: string }>();

      const targetPatch = patches.get(classDocId) ?? {};
      const targetSections = (targetPatch.sections ?? target.sections).map(s =>
        s.id === sectionId
          ? { ...s, classTeacherId: newTeacher?.id ?? null, classTeacherName: newTeacher?.name ?? 'Not Assigned' }
          : s
      );
      patches.set(classDocId, { ...targetPatch, sections: targetSections });

      const batch = writeBatch(db);
      for (const [classId, patch] of patches) {
        batch.update(doc(db, 'schools', schoolId, 'classes', classId), { ...patch, updatedAt: serverTimestamp() });
      }
      if (previousTeacherId && previousTeacherId !== (newTeacher?.id ?? null)) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', previousTeacherId), { classTeacherOf: null });
      }
      if (newTeacher) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', newTeacher.id), {
          classTeacherOf: {
            schoolId, classId: target.id, className: target.className,
            sectionId, sectionName: section.name,
          },
        });
      }
      await batch.commit();
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  }

  /**
   * Same idea as handleAssignTeacher, but for a class with ZERO
   * sections — classTeacherId/classTeacherName live directly on the
   * class document instead of inside a section. See ClassGroup and
   * the Option B note in ClassTeacherAssignment (types/teachers.ts):
   * a class is assigned a teacher either per-section or directly,
   * never both, so this only ever applies while sections.length === 0.
   */
  async function handleAssignClassLevelTeacher(classDocId: string, teacherId: string) {
    if (!profile?.schoolId) return;
    const schoolId = profile.schoolId;
    const target = classes.find(c => c.id === classDocId);
    if (!target) return;

    const isUnassigning = !teacherId || teacherId === 'Not Assigned';
    const newTeacher = isUnassigning ? null : teachers.find(t => t.id === teacherId) ?? null;
    const previousTeacherId = target.classTeacherId ?? null;

    setIsProcessing(true);
    try {
      const patches = newTeacher
        ? clearTeacherElsewhere(newTeacher.id, classDocId, null)
        : new Map<string, { sections?: Section[]; classTeacherId?: null; classTeacherName?: string }>();

      const targetPatch = patches.get(classDocId) ?? {};
      patches.set(classDocId, {
        ...targetPatch,
        classTeacherId: newTeacher?.id ?? null,
        classTeacherName: newTeacher?.name ?? 'Not Assigned',
      } as { sections?: Section[]; classTeacherId?: null; classTeacherName?: string });

      const batch = writeBatch(db);
      for (const [classId, patch] of patches) {
        batch.update(doc(db, 'schools', schoolId, 'classes', classId), { ...patch, updatedAt: serverTimestamp() });
      }
      if (previousTeacherId && previousTeacherId !== (newTeacher?.id ?? null)) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', previousTeacherId), { classTeacherOf: null });
      }
      if (newTeacher) {
        batch.update(doc(db, 'schools', schoolId, 'teachers', newTeacher.id), {
          classTeacherOf: { schoolId, classId: target.id, className: target.className },
        });
      }
      await batch.commit();
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const sorted       = [...classes].sort((a, b) => {
    const an = parseInt(a.className, 10), bn = parseInt(b.className, 10);
    return (!isNaN(an) && !isNaN(bn)) ? an - bn : a.className.localeCompare(b.className);
  });
  const allStudents  = students.length;
  const allSections  = classes.reduce((t, c) => t + c.sections.length, 0);
  const configured   = classes.filter(c => c.sections?.length > 0).length;
  const activeGroup  = classes.find(c => c.className === selectedClass);
  const filteredSecs = (activeGroup?.sections || []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.classTeacherName || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.roomNo || '').toLowerCase().includes(search.toLowerCase())
  );

  const ac    = accent(selectedClass || '1');
  const acBg  = accentBg(selectedClass || '1');

  // ── Loading ────────────────────────────────────────────────────────────────
  if (authLoading || loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'70vh', gap:'0.75rem' }}>
      <Loader2 size={22} style={{ animation:'spin 1s linear infinite', color:'#2563EB' }}/>
      <p style={{ fontFamily:'system-ui', fontSize:'0.7rem', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#94a3b8' }}>
        Loading academic registry…
      </p>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <>
      
      {/* ──────────────────────────────────────────────────────────────────────
          ROOT CONTAINER
      ────────────────────────────────────────────────────────────────────── */}
      <div className="am" style={{ '--ac': ac, '--ac-bg': acBg } as React.CSSProperties}>

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="am-topbar">
          <div className="am-breadcrumb">
            <GraduationCap size={14}/>
            <span>Academics</span>
            <ChevronRight size={12}/>
            <strong>Classes &amp; Sections</strong>
            {tab === 'registry' && selectedClass && (
              <><ChevronRight size={12}/><strong>{isNaN(Number(selectedClass)) ? selectedClass : `Class ${selectedClass}`}</strong></>
            )}
          </div>
          <span className="am-school-badge">{profile?.schoolId}</span>
        </div>

        {/* ── Metrics strip ────────────────────────────────────────────────── */}
        <div className="am-metrics">
          {[
            { label: 'Total Classes',    val: classes.length,  sub: 'active' },
            { label: 'Total Sections',   val: allSections,     sub: 'all levels' },
            { label: 'Total Students',   val: allStudents,     sub: 'enrolled' },
            { label: 'Avg / Section',    val: allSections ? Math.round(allStudents / allSections) : 0, sub: 'avg strength' },
            { label: 'Configured',       val: configured,      sub: 'with sections' },
          ].map(m => (
            <div className="am-metric" key={m.label}>
              <span className="am-metric-label">{m.label}</span>
              <span className="am-metric-val">{m.val}</span>
              <span className="am-metric-sub">{m.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="am-tabs">
          <button className={`am-tab${tab === 'setup' ? ' active' : ''}`} onClick={() => setTab('setup')}>
            <LayoutGrid size={13}/>
            Setup
            <span className="am-tab-count">{classes.length}</span>
          </button>
          <button className={`am-tab${tab === 'registry' ? ' active' : ''}`} onClick={() => setTab('registry')}>
            <TableProperties size={13}/>
            Section Registry
            <span className="am-tab-count">{allSections}</span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — SETUP (card grid)
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'setup' && (
          <div className="am-setup">
            <div className="am-setup-header">
              <div>
                <div className="am-setup-title">Academic Structure</div>
                <div className="am-setup-sub">Create and organise classes and their sections</div>
              </div>
              <button className="am-btn am-btn-primary"
                onClick={() => { setNewClassName(''); setClassError(''); setClassModal(true); }}>
                <Plus size={13}/> Add Class
              </button>
            </div>

            <div className="am-section-label">
              <Layers size={11}/> Class Registry
            </div>

            {loading ? (
              <div className="am-grid">
                {[1,2,3,4,5,6].map(i => <div key={i} className="am-shimmer" style={{ animationDelay:`${i*70}ms` }}/>)}
              </div>
            ) : (
              <div className="am-grid">
                {sorted.map((cls, i) => {
                  const color  = accent(cls.className);
                  const hasSec = (cls.sections?.length ?? 0) > 0;
                  const isOpen = expandedId === cls.id;
                  return (
                    <div key={cls.id}
                      className={`am-card${isOpen ? ' expanded' : ''}`}
                      style={{ animationDelay:`${i*30}ms` }}>

                      <div className="am-card-top" onClick={() => setExpandedId(isOpen ? null : cls.id)}>
                        <div className="am-card-top-left">
                          <div className="am-class-badge" style={{ background:`${color}14`, color }}>
                            {cls.className}
                          </div>
                          <div>
                            <div className="am-card-name">Class {cls.className}</div>
                            <div className="am-card-sub">
                              {cls.sections?.length || 0} section{cls.sections?.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                        <div className="am-card-top-right" onClick={e => e.stopPropagation()}>
                          <button className="am-del-btn" title="Delete class"
                            onClick={() => setDeleteClassId(cls.id)}>
                            <Trash2 size={13}/>
                          </button>
                          <button className={`am-expand-btn${isOpen ? ' open' : ''}`}
                            title={isOpen ? 'Collapse' : 'Expand'}
                            onClick={() => setExpandedId(isOpen ? null : cls.id)}>
                            <ChevronRight size={13}/>
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="am-sections-area">
                          <div className="am-sections-inner">
                            <div className="am-sec-list">
                              {hasSec ? cls.sections.map(sec => (
                                <div key={sec.id} className="am-sec-row">
                                  <div className="am-sec-row-left">
                                    <div className="am-sec-dot" style={{ background: color }}/>
                                    <span className="am-sec-name">Section {sec.name}</span>
                                    <span className="am-sec-count">{countForSection(cls, sec)} students</span>
                                  </div>
                                  <button className="am-sec-del" title="Delete section"
                                    onClick={() => setDeleteSec({ classId: cls.id, secId: sec.id, secName: sec.name })}>
                                    <Trash2 size={11}/>
                                  </button>
                                </div>
                              )) : (
                                <div className="am-no-sections-row">
                                  <div className="am-no-sections">No sections yet</div>
                                  <select
                                    className={`am-teacher-sel am-teacher-sel-compact${!cls.classTeacherId ? ' am-teacher-unset' : ''}`}
                                    value={cls.classTeacherId || 'Not Assigned'}
                                    disabled={isProcessing}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => handleAssignClassLevelTeacher(cls.id, e.target.value)}>
                                    <option value="Not Assigned">— Assign class teacher</option>
                                    {teachers.map(t => (
                                      <option key={t.id} value={t.id}>
                                        {t.name}
                                        {t.classTeacherOf && t.classTeacherOf.classId !== cls.id
                                          ? ` (currently ${formatClassTeacherOf(t.classTeacherOf)})`
                                          : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                            <button className="am-btn am-btn-outline am-btn-sm"
                              style={{ width:'100%', justifyContent:'center' }}
                              onClick={() => openAddSection(cls.id)}>
                              <Plus size={12}/> Add Section
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="am-card-footer">
                        {hasSec
                          ? <span className="am-status-ok"><Check size={10}/> Configured</span>
                          : <span className="am-status-warn"><AlertCircle size={10}/> Needs sections</span>
                        }
                        {!isOpen && hasSec && (
                          <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap' }}>
                            {cls.sections.slice(0, 4).map(s => (
                              <span key={s.id} style={{
                                display:'inline-flex', padding:'0.1rem 0.42rem',
                                borderRadius:'4px', fontSize:'0.58rem', fontWeight:700,
                                background:`${color}12`, color,
                              }}>{s.name}</span>
                            ))}
                            {cls.sections.length > 4 && (
                              <span style={{ fontSize:'0.58rem', color:'#94A3B8', alignSelf:'center' }}>
                                +{cls.sections.length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button className="am-add-card"
                  onClick={() => { setNewClassName(''); setClassError(''); setClassModal(true); }}>
                  <div className="am-add-ring"><Plus size={14}/></div>
                  Add Class
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — REGISTRY (sidebar + table)
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'registry' && (
          <div className="am-registry">

            {/* Sidebar rail */}
            <aside className="am-rail">
              <div className="am-rail-heading">Academic Levels</div>
              {sorted.map(c => (
                <button key={c.id}
                  className={`am-grade-item${selectedClass === c.className ? ' active' : ''}`}
                  style={{ '--ac': accent(c.className), '--ac-bg': accentBg(c.className) } as React.CSSProperties}
                  onClick={() => setSelectedClass(c.className)}>
                  <span className="am-grade-item-inner">
                    <span className="am-grade-pip" style={{ background: accent(c.className) }}/>
                    <span className="am-grade-name">
                      {isNaN(Number(c.className)) ? c.className : `Class ${c.className}`}
                    </span>
                  </span>
                  <span className="am-grade-badge">{c.sections?.length || 0}</span>
                </button>
              ))}
            </aside>

            {/* Main content */}
            <main className="am-main">

              {/* Local stats */}
              <div className="am-summary">
                {[
                  { icon:<BarChart3 size={13}/>, label:'Sections',  val: activeGroup?.sections.length ?? 0,           sub:`in Class ${selectedClass}` },
                  { icon:<Users size={13}/>,     label:'Students',  val: activeGroup ? (activeGroup.sections.length > 0 ? activeGroup.sections.reduce((t,s)=>t+countForSection(activeGroup,s),0) : countForClass(activeGroup)) : 0, sub:'current total' },
                  { icon:<UserCheck size={13}/>, label:'Assigned',  val: activeGroup?.sections.filter(s=>!!s.classTeacherId).length ?? 0, sub:'teachers set' },
                ].map(s => (
                  <div className="am-summary-card" key={s.label}>
                    <span className="am-summary-label">{s.icon}{s.label}</span>
                    <span className="am-summary-val">{s.val}</span>
                    <span className="am-summary-sub">{s.sub}</span>
                  </div>
                ))}
              </div>

              {/* Section header */}
              <div className="am-section-head">
                <div className="am-section-title">
                  <h2>Sections Registry</h2>
                  <span>{filteredSecs.length} listing{filteredSecs.length !== 1 ? 's' : ''}</span>
                </div>
                {activeGroup && (
                  <button className="am-btn am-btn-accent"
                    disabled={isProcessing}
                    onClick={() => openAddSection(activeGroup.id)}>
                    <Plus size={13} strokeWidth={2.5}/> Add Section
                  </button>
                )}
              </div>

              <div className="am-controls">
                <div className="am-search">
                  <Search size={13} className="am-search-icon"/>
                  <input placeholder="Search sections, teachers, rooms…"
                    value={search} onChange={e => setSearch(e.target.value)}/>
                </div>
                <button className="am-btn am-btn-outline">
                  <SlidersHorizontal size={13}/> Filter
                </button>
              </div>

              {/* Table */}
              <div className="am-table-wrap">
                <table className="am-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Class Teacher</th>
                      <th>Students</th>
                      <th>Room</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSecs.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          {!search && activeGroup && activeGroup.sections.length === 0 ? (
                            <div className="am-empty">
                              <div className="am-empty-icon"><UserCheck size={20}/></div>
                              <h3>No sections — assign a class teacher directly</h3>
                              <p>This class has no sections, so one teacher covers the whole class instead of one per section.</p>
                              <select
                                className={`am-teacher-sel${!activeGroup.classTeacherId ? ' am-teacher-unset' : ''}`}
                                style={{ marginTop: '0.75rem', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.4rem 0.75rem' }}
                                value={activeGroup.classTeacherId || 'Not Assigned'}
                                disabled={isProcessing}
                                onChange={e => handleAssignClassLevelTeacher(activeGroup.id, e.target.value)}>
                                <option value="Not Assigned">— Assign class teacher</option>
                                {teachers.map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                    {t.classTeacherOf && t.classTeacherOf.classId !== activeGroup.id
                                      ? ` (currently ${formatClassTeacherOf(t.classTeacherOf)})`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="am-empty">
                              <div className="am-empty-icon"><Plus size={20}/></div>
                              <h3>{search ? 'No matching sections' : 'No sections defined'}</h3>
                              <p>{search ? 'Adjust your search terms' : 'Add sections to start managing this class'}</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : filteredSecs.map(sec => (
                      <tr key={sec.id}>
                        <td>
                          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                            <span className="am-sec-avatar">{sec.name}</span>
                            <div>
                              <div style={{ fontWeight:600, color:'#0F172A', fontSize:'0.83rem' }}>
                                Section {sec.name}
                              </div>
                              <div style={{ fontSize:'0.67rem', color:'#94A3B8', fontFamily:'Geist Mono,monospace' }}>
                                Class {selectedClass}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          <select
                            className={`am-teacher-sel${!sec.classTeacherId ? ' am-teacher-unset' : ''}`}
                            value={sec.classTeacherId || 'Not Assigned'}
                            disabled={isProcessing}
                            onChange={e => handleAssignTeacher(activeGroup!.id, sec.id, e.target.value)}>
                            <option value="Not Assigned">— Assign teacher</option>
                            {teachers.map(t => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                                {t.classTeacherOf && t.classTeacherOf.sectionId !== sec.id
                                  ? ` (currently ${formatClassTeacherOf(t.classTeacherOf)})`
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td><span className="am-count">{countForSection(activeGroup!, sec)}</span></td>
                        <td><span className="am-room">{sec.roomNo || 'TBD'}</span></td>

                        <td>
                          <span className={`am-status ${!sec.classTeacherId ? 'am-status-pending' : 'am-status-active'}`}>
                            {!sec.classTeacherId ? 'Pending' : 'Active'}
                          </span>
                        </td>

                        <td>
                          <div className="am-row-actions">
                            <button className="am-act-btn am-act-ghost">History</button>
                            <button className="am-act-btn am-act-primary">
                              Manage <ArrowRight size={11}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </main>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Add Class */}
      {classModal && (
        <div className="am-overlay" onClick={() => setClassModal(false)}>
          <div className="am-modal am-modal-narrow" onClick={e => e.stopPropagation()}>
            <div className="am-modal-head">
              <div>
                <h2>Add New Class</h2>
                <p>Creates a new class in the registry</p>
              </div>
              <button className="am-modal-close" onClick={() => setClassModal(false)}><X size={14}/></button>
            </div>
            {classError && <div className="am-error"><AlertCircle size={13}/>{classError}</div>}
            <div className="am-field">
              <label className="am-label">Class Name *</label>
              <input className="am-input" placeholder="e.g.  1,  2,  10,  11-A"
                autoFocus value={newClassName}
                onChange={e => { setNewClassName(e.target.value); setClassError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAddClass()}/>
              <p className="am-hint">Can be a number (1–12) or a custom label</p>
            </div>
            <div className="am-modal-actions">
              <button className="am-modal-cancel" onClick={() => setClassModal(false)}>Cancel</button>
              <button className="am-modal-confirm-dark"
                disabled={isProcessing || !newClassName.trim()} onClick={handleAddClass}>
                {isProcessing ? 'Adding…' : 'Add Class'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Section */}
      {secModal && (
        <div className="am-overlay" onClick={() => setSecModal(false)}>
          <div className="am-modal" onClick={e => e.stopPropagation()}>
            <div className="am-modal-head">
              <div>
                <h2>New Section</h2>
                <p>Adding to Class {classes.find(c => c.id === secTargetId)?.className}</p>
              </div>
              <button className="am-modal-close" onClick={() => setSecModal(false)}><X size={14}/></button>
            </div>
            {secError && <div className="am-error"><AlertCircle size={13}/>{secError}</div>}

            <div className="am-field">
              <label className="am-label">Section Name *</label>
              <div className="am-input-wrap">
                <GraduationCap size={14} className="am-input-icon"/>
                <input className="am-input with-icon" placeholder="e.g.  A,  B,  Rose,  Jasmine"
                  autoFocus value={newSecName}
                  onChange={e => { setNewSecName(e.target.value); setSecError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleAddSection()}/>
              </div>
              <p className="am-hint">Will be uppercased automatically</p>
            </div>

            <div className="am-field">
              <label className="am-label">Room Identifier</label>
              <div className="am-input-wrap">
                <Hash size={14} className="am-input-icon"/>
                <input className="am-input with-icon" placeholder="e.g.  Block-A-201"
                  value={newSecRoom}
                  onChange={e => setNewSecRoom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSection()}/>
              </div>
            </div>

            <div className="am-field">
              <label className="am-label">Class Teacher</label>
              <div className="am-input-wrap">
                <UserCheck size={14} className="am-input-icon"/>
                <select className="am-select with-icon" value={newSecTeacher}
                  onChange={e => setNewSecTeacher(e.target.value)}>
                  <option value="">— Assign later</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.classTeacherOf ? ` (currently ${formatClassTeacherOf(t.classTeacherOf)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="am-divider"/>
            <div className="am-modal-actions">
              <button className="am-modal-cancel" onClick={() => setSecModal(false)}>Cancel</button>
              <button className="am-modal-confirm"
                disabled={isProcessing || !newSecName.trim()} onClick={handleAddSection}>
                {isProcessing ? 'Provisioning…' : 'Create Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Class */}
      {deleteClassId && (
        <div className="am-overlay" onClick={() => setDeleteClassId(null)}>
          <div className="am-modal am-modal-narrow" onClick={e => e.stopPropagation()}>
            <div className="am-modal-head">
              <div>
                <h2>Delete Class?</h2>
                <p>Class {classes.find(c => c.id === deleteClassId)?.className} and all its sections will be removed</p>
              </div>
              <button className="am-modal-close" onClick={() => setDeleteClassId(null)}><X size={14}/></button>
            </div>
            <p className="am-danger-body">
              This is permanent and cannot be undone. Students assigned to this class will not be deleted.
            </p>
            <div className="am-modal-actions">
              <button className="am-modal-cancel" onClick={() => setDeleteClassId(null)}>Cancel</button>
              <button className="am-modal-confirm-danger"
                disabled={isProcessing} onClick={() => handleDeleteClass(deleteClassId)}>
                {isProcessing ? 'Deleting…' : 'Delete Class'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Section */}
      {deleteSec && (
        <div className="am-overlay" onClick={() => setDeleteSec(null)}>
          <div className="am-modal am-modal-narrow" onClick={e => e.stopPropagation()}>
            <div className="am-modal-head">
              <div>
                <h2>Delete Section {deleteSec.secName}?</h2>
                <p>This section will be removed from the class</p>
              </div>
              <button className="am-modal-close" onClick={() => setDeleteSec(null)}><X size={14}/></button>
            </div>
            <p className="am-danger-body">
              Students in this section will not be deleted. This action cannot be undone.
            </p>
            <div className="am-modal-actions">
              <button className="am-modal-cancel" onClick={() => setDeleteSec(null)}>Cancel</button>
              <button className="am-modal-confirm-danger"
                disabled={isProcessing}
                onClick={() => handleDeleteSection(deleteSec.classId, deleteSec.secId)}>
                {isProcessing ? 'Deleting…' : 'Delete Section'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}