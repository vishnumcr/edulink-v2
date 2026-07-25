/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/teachers/page.tsx
 *
 * Changes from the original:
 * - No direct Firestore/Storage calls — everything routes through
 *   teachersService.
 * - Image compression moved to utils/image.ts (compressToWebP).
 * - alert() replaced with an inline error banner.
 * - confirm() replaced with a confirm modal, matching the pattern
 *   already used on the Students page.
 * - photoURL renamed to photoUrl, matching the casing convention
 *   already set by StudentProfile.photoUrl.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { teachersService } from '@/services/teachers/teachersService';
import { Teacher, TeacherFormValues } from '@/types/teachers';
import {
  UserPlus,
  Mail,
  MailWarning,
  Phone,
  Trash2,
  Loader2,
  Search,
  Camera,
  UserCircle,
  X,
  AlertCircle,
  CheckCircle2,
  Send,
} from 'lucide-react';

const EMPTY_FORM: TeacherFormValues = { name: '', email: '', phone: '', subject: '' };

export default function TeachersPage() {
  const { profile, loading: authLoading } = useAuth();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');

  // Form state
  const [showAdd, setShowAdd] = useState(false);
  const [newTeacher, setNewTeacher] = useState<TeacherFormValues>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Post-add outcome — specifically surfaces createTeacher's
  // passwordResetSent flag, which used to be silently discarded here.
  const [addOutcome, setAddOutcome] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null);

  // Per-teacher "resend setup email" action — keyed by teacher id so
  // only the row actually clicked shows a loading/sent state.
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;

    const unsubscribe = teachersService.subscribeToTeachers(profile.schoolId, (list) => {
      setTeachers(list);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.schoolId, authLoading]);

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.schoolId) return;

    setIsSaving(true);
    setFormError('');
    setAddOutcome(null);
    try {
      const outcome = await teachersService.createTeacher(profile.schoolId, newTeacher, selectedFile);
      setAddOutcome(
        outcome.passwordResetSent
          ? { kind: 'success', message: `${newTeacher.name} was added — a setup email was sent to ${newTeacher.email}.` }
          : {
              kind: 'warning',
              message: `${newTeacher.name} was added, but the setup email couldn't be sent. Use "Resend setup email" below once they're in the list.`,
            }
      );
      setNewTeacher(EMPTY_FORM);
      setSelectedFile(null);
      setShowAdd(false);
    } catch (error) {
      console.error('Error onboarding teacher:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to save teacher. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResendSetupEmail = async (teacher: Teacher) => {
    setResendingId(teacher.id);
    try {
      await teachersService.resendSetupEmail(teacher.email);
      setResentId(teacher.id);
      setTimeout(() => setResentId((current) => (current === teacher.id ? null : current)), 3000);
    } catch (error) {
      console.error('Error resending setup email:', error);
      setAddOutcome({ kind: 'warning', message: `Couldn't resend the setup email to ${teacher.email}. Please try again.` });
    } finally {
      setResendingId(null);
    }
  };

  const handleDelete = async () => {
    if (!profile?.schoolId || !deleteTarget) return;
    setDeleting(true);
    try {
      await teachersService.deleteTeacher(profile.schoolId, deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
    } finally {
      setDeleting(false);
    }
  };

  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.subject || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="p-10 flex items-center gap-3 text-slate-400 font-bold uppercase tracking-widest">
      <Loader2 className="animate-spin text-blue-600" /> Syncing Faculty...
    </div>
  );

  return (
    <div className="p-6 lg:p-10 animate-in fade-in duration-500">

      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Staff Registry</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Faculty & Department Management</p>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setFormError(''); }}
          className={`${showAdd ? 'bg-slate-100 text-slate-600' : 'bg-blue-600 text-white'} px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-blue-600/10`}
        >
          {showAdd ? <X size={16} /> : <UserPlus size={16} />}
          {showAdd ? 'Cancel' : 'Add Teacher'}
        </button>
      </div>

      {addOutcome && (
        <div
          className={`mb-6 flex items-start gap-3 rounded-2xl px-5 py-4 text-sm font-semibold ${
            addOutcome.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {addOutcome.kind === 'success' ? (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          ) : (
            <MailWarning size={18} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{addOutcome.message}</span>
          <button onClick={() => setAddOutcome(null)} className="shrink-0 opacity-60 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAddTeacher} className="mb-10 bg-white border border-slate-200 p-8 rounded-[2.5rem] shadow-sm animate-in slide-in-from-top-4">

          {formError && (
            <div className="mb-6 flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
              <AlertCircle size={16} className="shrink-0" />
              {formError}
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-10 items-start">

            {/* Image Upload Area */}
            <div className="flex flex-col items-center gap-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-28 h-28 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group overflow-hidden relative shadow-inner"
              >
                {selectedFile ? (
                  <img
                    src={URL.createObjectURL(selectedFile)}
                    className="w-full h-full object-cover"
                    alt="Preview"
                  />
                ) : (
                  <>
                    <Camera className="text-slate-300 group-hover:text-blue-500 transition-colors" size={28} />
                    <span className="text-[9px] font-black text-slate-400 uppercase mt-2">Upload Photo</span>
                  </>
                )}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                hidden
                accept="image/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-[10px] font-bold text-red-500 uppercase hover:underline"
                >
                  Remove
                </button>
              )}
            </div>

            {/* Information Grid */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Full Name</label>
                <input required className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  value={newTeacher.name} onChange={e => setNewTeacher({...newTeacher, name: e.target.value})} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Department / Subject</label>
                <input className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Mathematics" value={newTeacher.subject} onChange={e => setNewTeacher({...newTeacher, subject: e.target.value})} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Email Address</label>
                <input type="email" className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  value={newTeacher.email} onChange={e => setNewTeacher({...newTeacher, email: e.target.value})} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Phone Number</label>
                <input className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  value={newTeacher.phone} onChange={e => setNewTeacher({...newTeacher, phone: e.target.value})} />
              </div>

              <div className="lg:col-span-2 flex items-end">
                <button
                  disabled={isSaving}
                  type="submit"
                  className="w-full md:w-auto bg-slate-900 text-white px-10 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-xl shadow-slate-200"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Compressing & Saving...
                    </>
                  ) : (
                    'Add Faculty Member'
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm">
        <div className="p-8 border-b border-slate-100 flex items-center gap-4 bg-slate-50/30">
          <Search size={20} className="text-slate-300" />
          <input
            placeholder="Search registry by name, department, or email..."
            className="bg-transparent outline-none text-sm w-full font-bold text-slate-600 placeholder:text-slate-300 placeholder:font-medium"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Teacher Profile</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Specialization</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact Info</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTeachers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/40 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      {t.photoUrl ? (
                        <img
                          src={t.photoUrl}
                          className="w-12 h-12 rounded-2xl object-cover shadow-sm ring-2 ring-white"
                          alt={t.name}
                        />
                      ) : (
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-base shadow-sm ring-2 ring-white">
                          {t.name[0]}
                        </div>
                      )}
                      <span className="font-black text-slate-900 text-lg tracking-tight">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-4 py-1.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm">
                      {t.subject || 'General'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold tracking-tight">
                        <Mail size={14} className="text-blue-500/50" /> {t.email}
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold tracking-tight">
                        <Phone size={14} className="text-blue-500/50" /> {t.phone}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleResendSetupEmail(t)}
                        disabled={resendingId === t.id}
                        title="Resend setup email"
                        className="p-3 text-slate-200 hover:text-blue-500 hover:bg-blue-50 rounded-2xl transition-all disabled:opacity-50"
                      >
                        {resendingId === t.id ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : resentId === t.id ? (
                          <CheckCircle2 size={20} className="text-emerald-500" />
                        ) : (
                          <Send size={20} />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        className="p-3 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredTeachers.length === 0 && (
          <div className="p-20 text-center space-y-2">
            <UserCircle size={48} className="mx-auto text-slate-100" />
            <p className="text-slate-400 font-bold text-sm">No faculty members found in the registry.</p>
          </div>
        )}
      </div>

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <Trash2 size={18} />
            </div>
            <h3 className="text-base font-bold text-slate-900">Remove teacher?</h3>
            <p className="mt-1 text-sm text-slate-500">
              This will permanently remove {deleteTarget.name} from the registry. This action cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-2xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}