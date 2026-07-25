/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/admission/review/page.tsx
 *
 * Purpose:
 * Staff-facing queue for reviewing submitted admissions — approve,
 * reject (with a reason), and see status at a glance. This is the
 * page that gives the "pending" status on an Admission somewhere to
 * actually be read and acted on; previously nothing in the app did.
 *
 * Stage in the admission-flow plan:
 * 1. Application submitted     ✅ app/(dashboard)/admission/page.tsx
 * 2. Review (this page)        ✅ approve / reject
 * 3a. Admission fee + enroll   ✅ cash/manual modes, via
 *     collectAdmissionFee Cloud Function — reads the school's real
 *     admissionFee config (settings/fees) to decide whether a payment
 *     step is even required before enrolling.
 * 3b. Live gateway collection  🚧 NOT built yet (QR / payment link /
 *     WhatsApp share via Razorpay) — a separate, later piece that
 *     will plug into the same collectAdmissionFee transaction once a
 *     webhook confirms payment, rather than staff entering it manually.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { admissionService, AdmissionPaymentMode } from '@/services/admission/admissionService';
import { classesService } from '@/services/academic/classesService';
import { feeStructureService } from '@/services/finance/feeStructureService';
import { schoolService } from '@/services/school/schoolService';
import { Admission, AdmissionStatus } from '@/types/admission';
import {
  ClipboardList, Check, X, AlertCircle, Search,
  Loader2, IndianRupee, ChevronRight, Banknote,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

type FilterKey = 'all' | AdmissionStatus;

const PAYMENT_MODES: { value: AdmissionPaymentMode; label: string }[] = [
  { value: 'cash',          label: 'Cash' },
  { value: 'upi',           label: 'UPI' },
  { value: 'card',          label: 'Card' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'enrolled', label: 'Enrolled' },
];

const STATUS_META: Record<AdmissionStatus, { bg: string; color: string; border: string; label: string }> = {
  pending : { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A', label: 'Pending'  },
  approved: { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE', label: 'Approved' },
  rejected: { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA', label: 'Rejected' },
  enrolled: { bg: '#F0FDF4', color: '#16A34A', border: '#BBF7D0', label: 'Enrolled' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function AdmissionReviewPage() {
  const { profile } = useAuth();
  console.log("PROFILE", profile);
console.log("SCHOOL ID", profile?.schoolId);
  const schoolId = profile?.schoolId;

  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Admission | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const [rejectTarget, setRejectTarget] = useState<Admission | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Only what this page needs from Fee Structure — whether the school
  // charges an admission fee, and how much. Same subscription pattern
  // settings/fees/page.tsx uses (classLabels first, then the structure).
  const [classLabels, setClassLabels] = useState<string[]>([]);
  const [admissionFee, setAdmissionFee] = useState<{ amount: number; isActive: boolean }>({ amount: 0, isActive: false });

  const [enrollTarget, setEnrollTarget] = useState<Admission | null>(null);
  const [enrollMode, setEnrollMode] = useState<AdmissionPaymentMode>('cash');
  const [enrollReference, setEnrollReference] = useState('');
  const [enrollNote, setEnrollNote] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = admissionService.subscribeToAdmissions(schoolId, (rows) => {
      setAdmissions(rows);
      setLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = classesService.subscribeToClassLabels(schoolId, setClassLabels);
    return () => unsub();
  }, [schoolId]);

  const [academicYear, setAcademicYear] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    schoolService.getSchoolProfile(schoolId).then((p) => {
      if (!cancelled) setAcademicYear(p.currentAcademicYear);
    });
    return () => { cancelled = true; };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !academicYear || classLabels.length === 0) return;
    const unsub = feeStructureService.subscribeToFeeStructure(schoolId, academicYear, classLabels, (structure) => {
      setAdmissionFee(structure.admissionFee);
    });
    return () => unsub();
  }, [schoolId, academicYear, classLabels]);

  // Keep the open detail drawer in sync with live updates (e.g. after
  // approving, the drawer should immediately reflect the new status).
  useEffect(() => {
    if (!selected) return;
    const fresh = admissions.find(a => a.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [admissions, selected]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: admissions.length, pending: 0, approved: 0, rejected: 0, enrolled: 0 };
    for (const a of admissions) c[a.status]++;
    return c;
  }, [admissions]);

  const filtered = useMemo(() => {
    let rows = filter === 'all' ? admissions : admissions.filter(a => a.status === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(a =>
        a.student.name.toLowerCase().includes(q) ||
        a.admission.applyingForClass.toLowerCase().includes(q) ||
        a.parent.father.name.toLowerCase().includes(q) ||
        a.parent.mother.name.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [admissions, filter, search]);

  async function handleApprove(a: Admission) {
    if (!schoolId) return;
    setBusyId(a.id); setActionError('');
    try {
      await admissionService.approveAdmission(schoolId, a.id);
    } catch (e) {
      console.error(e);
      setActionError('Failed to approve. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function openReject(a: Admission) {
    setRejectTarget(a);
    setRejectReason('');
    setActionError('');
  }

  async function confirmReject() {
    if (!schoolId || !rejectTarget) return;
    setRejecting(true); setActionError('');
    try {
      const result = await admissionService.rejectAdmission(schoolId, rejectTarget.id, rejectReason);
      if (!result.ok) { setActionError(result.error); return; }
      setRejectTarget(null);
    } catch (e) {
      console.error(e);
      setActionError('Failed to reject. Please try again.');
    } finally {
      setRejecting(false);
    }
  }

  function openEnroll(a: Admission) {
    setEnrollTarget(a);
    setEnrollMode('cash');
    setEnrollReference('');
    setEnrollNote('');
    setActionError('');
  }

  async function confirmEnroll() {
    if (!schoolId || !enrollTarget) return;
    setEnrolling(true); setActionError('');
    try {
      const result = await admissionService.collectAdmissionFee(schoolId, {
        admissionId: enrollTarget.id,
        payment: admissionFee.isActive
          ? {
              amount: admissionFee.amount,
              mode: enrollMode,
              referenceNumber: enrollReference || undefined,
              note: enrollNote || undefined,
            }
          : undefined,
      });
      if (result.success) setEnrollTarget(null);
    } catch (e) {
      console.error(e);
      setActionError(e instanceof Error ? e.message : 'Failed to enroll. Please try again.');
    } finally {
      setEnrolling(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '0.75rem' }}>
      <Loader2 size={18} style={{ animation: 'ar-spin 1s linear infinite', color: '#0F172A' }} />
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Loading admissions…
      </span>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
        @keyframes ar-spin { to { transform: rotate(360deg); } }

        .ar * { box-sizing: border-box; }
        .ar { font-family: 'Geist', sans-serif; color: #0F172A; padding: 1.5rem; padding-bottom: 4rem; }

        .ar-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
        .ar-topbar h1 { font-family: 'Instrument Serif', serif; font-size: 1.4rem; font-weight: 400; }
        .ar-topbar p { font-size: 0.78rem; color: #64748B; margin-top: 0.2rem; }

        .ar-btn {
          display: inline-flex; align-items: center; gap: 0.35rem;
          border: none; border-radius: 8px; padding: 0.5rem 0.85rem;
          font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit;
          white-space: nowrap;
        }
        .ar-btn-primary { background: #0F172A; color: #fff; }
        .ar-btn-primary:hover:not(:disabled) { background: #1E293B; }
        .ar-btn-outline { background: #fff; color: #334155; border: 1px solid #E2E8F0; }
        .ar-btn-success { background: #16A34A; color: #fff; }
        .ar-btn-danger { background: #FEF2F2; color: #DC2626; }
        .ar-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .ar-tabs { display: flex; gap: 0.4rem; border-bottom: 1px solid #F1F5F9; padding-bottom: 0.6rem; margin-bottom: 1rem; flex-wrap: wrap; }
        .ar-tab {
          display: flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.8rem;
          border-radius: 999px; font-size: 0.78rem; font-weight: 600; color: #64748B;
          cursor: pointer; transition: background 0.15s, color 0.15s;
        }
        .ar-tab:hover { background: #F1F5F9; }
        .ar-tab.sel { background: #0F172A; color: #fff; }
        .ar-tab-count { font-size: 0.65rem; font-weight: 700; padding: 0.05rem 0.4rem; border-radius: 999px; background: rgba(148,163,184,0.2); }
        .ar-tab.sel .ar-tab-count { background: rgba(255,255,255,0.2); }

        .ar-search { position: relative; max-width: 320px; margin-bottom: 1rem; }
        .ar-search input {
          width: 100%; border: 1px solid #E2E8F0; border-radius: 8px;
          padding: 0.55rem 0.7rem 0.55rem 2.1rem; font-size: 0.8rem; font-family: inherit;
        }
        .ar-search input:focus { outline: none; border-color: #94A3B8; }
        .ar-search svg { position: absolute; left: 0.7rem; top: 50%; transform: translateY(-50%); color: #94A3B8; }

        .ar-error {
          display: flex; align-items: center; gap: 0.4rem; background: #FEF2F2; color: #DC2626;
          border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.75rem; font-weight: 600; margin-bottom: 1rem;
        }

        .ar-list { background: #fff; border: 1px solid #F1F5F9; border-radius: 12px; overflow: hidden; }
        .ar-row {
          display: flex; align-items: center; gap: 0.85rem; padding: 0.85rem 1.1rem;
          border-bottom: 1px solid #F8FAFC; cursor: pointer; transition: background 0.12s;
        }
        .ar-row:last-child { border-bottom: none; }
        .ar-row:hover { background: #F8FAFC; }
        .ar-avatar {
          width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 0.8rem; font-weight: 700;
        }
        .ar-row-name { font-size: 0.85rem; font-weight: 600; }
        .ar-row-sub { font-size: 0.7rem; color: #94A3B8; margin-top: 0.1rem; }
        .ar-badge {
          display: inline-flex; align-items: center; gap: 0.25rem;
          padding: 0.18rem 0.55rem; border-radius: 999px;
          font-size: 0.65rem; font-weight: 700; border: 1px solid; flex-shrink: 0;
        }
        .ar-row-actions { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }

        .ar-empty { padding: 3rem 1.5rem; text-align: center; }
        .ar-empty svg { color: #E2E8F0; margin-bottom: 0.6rem; }
        .ar-empty p { font-size: 0.8rem; font-weight: 600; color: #64748B; }
        .ar-empty span { font-size: 0.72rem; color: #94A3B8; }

        /* Drawer */
        .ar-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; justify-content: flex-end; z-index: 50; }
        .ar-drawer { background: #fff; width: 100%; max-width: 460px; height: 100%; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(15,23,42,0.15); }
        .ar-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 1.1rem; border-bottom: 1px solid #F1F5F9; }
        .ar-drawer-close { border: none; background: #F1F5F9; color: #64748B; width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .ar-drawer-body { flex: 1; overflow-y: auto; padding: 1.1rem; display: flex; flex-direction: column; gap: 1rem; }
        .ar-drawer-footer { display: flex; gap: 0.6rem; padding: 0.9rem 1.1rem; border-top: 1px solid #F1F5F9; flex-wrap: wrap; }
        .ar-drawer-footer .ar-btn { flex: 1; justify-content: center; min-width: 120px; }

        .ar-section-label { font-size: 0.68rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.04em; }
        .ar-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
        .ar-info-item .ar-il, .ar-il { font-size: 0.65rem; font-weight: 600; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.03em; }
        .ar-info-item .ar-iv { font-size: 0.82rem; font-weight: 600; color: #0F172A; margin-top: 0.15rem; }
        .ar-field { display: flex; flex-direction: column; }

        .ar-note {
          display: flex; gap: 0.5rem; background: #F8FAFC; border: 1px dashed #E2E8F0; border-radius: 8px;
          padding: 0.7rem 0.8rem; font-size: 0.72rem; color: #64748B; line-height: 1.5;
        }

        /* Reject modal */
        .ar-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 1rem; }
        .ar-modal { background: #fff; border-radius: 14px; padding: 1.1rem; width: 100%; max-width: 400px; }
        .ar-modal h3 { font-size: 0.92rem; font-weight: 700; }
        .ar-modal p { font-size: 0.75rem; color: #94A3B8; margin-top: 0.25rem; }
        .ar-modal textarea {
          width: 100%; margin-top: 0.8rem; border: 1px solid #E2E8F0; border-radius: 8px;
          padding: 0.6rem 0.7rem; font-size: 0.8rem; font-family: inherit; resize: vertical; min-height: 80px;
        }
        .ar-modal textarea:focus { outline: none; border-color: #94A3B8; }
        .ar-modal-input {
          width: 100%; border: 1px solid #E2E8F0; border-radius: 8px;
          padding: 0.55rem 0.7rem; font-size: 0.8rem; font-family: inherit;
        }
        .ar-modal-input:focus { outline: none; border-color: #94A3B8; }
        .ar-modal-actions { display: flex; gap: 0.6rem; margin-top: 1rem; }
        .ar-modal-actions .ar-btn { flex: 1; justify-content: center; }

        @media (max-width: 640px) {
          .ar-grid-2 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="ar">

        {/* Topbar */}
        <div className="ar-topbar">
          <div>
            <h1>Admissions</h1>
            <p>Review submitted applications, approve or reject, and track enrollment</p>
          </div>
          <a href="/admission">
            <button className="ar-btn ar-btn-primary"><ClipboardList size={13} /> New Admission</button>
          </a>
        </div>

        {actionError && <div className="ar-error"><AlertCircle size={13} />{actionError}</div>}

        {/* Filter tabs */}
        <div className="ar-tabs">
          {FILTERS.map(f => (
            <div key={f.key} className={`ar-tab${filter === f.key ? ' sel' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label} <span className="ar-tab-count">{counts[f.key]}</span>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="ar-search">
          <Search size={14} />
          <input placeholder="Search by student, class, or parent name…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* List */}
        <div className="ar-list">
          {filtered.length === 0 ? (
            <div className="ar-empty">
              <ClipboardList size={28} />
              <p>No applications{filter !== 'all' ? ` — ${STATUS_META[filter as AdmissionStatus]?.label.toLowerCase() || filter}` : ''}</p>
              <span>{search ? 'Try a different search term' : 'New applications will appear here'}</span>
            </div>
          ) : filtered.map(a => {
            const meta = STATUS_META[a.status];
            return (
              <div className="ar-row" key={a.id} onClick={() => setSelected(a)}>
                <div className="ar-avatar" style={{ background: a.avatarColor }}>
                  {a.student.name ? a.student.name[0].toUpperCase() : '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ar-row-name">{a.student.name || 'Unnamed applicant'}</div>
                  <div className="ar-row-sub">
                    {a.registrationNumber || '—'} · Class {a.admission.applyingForClass || '—'} · {a.parent.father.name || a.parent.mother.name || 'No parent name'}
                  </div>
                </div>
                <div className="ar-badge" style={{ background: meta.bg, color: meta.color, borderColor: meta.border }}>
                  {meta.label}
                </div>
                {a.status === 'pending' && (
                  <div className="ar-row-actions" onClick={e => e.stopPropagation()}>
                    <button className="ar-btn ar-btn-success" disabled={busyId === a.id} onClick={() => handleApprove(a)}>
                      {busyId === a.id ? <Loader2 size={12} style={{ animation: 'ar-spin 1s linear infinite' }} /> : <Check size={12} />} Approve
                    </button>
                    <button className="ar-btn ar-btn-danger" disabled={busyId === a.id} onClick={() => openReject(a)}>
                      <X size={12} /> Reject
                    </button>
                  </div>
                )}
                {a.status === 'approved' && (
                  <div className="ar-row-actions" onClick={e => e.stopPropagation()}>
                    <button className="ar-btn ar-btn-primary" onClick={() => openEnroll(a)}>
                      <IndianRupee size={12} /> {admissionFee.isActive ? 'Collect Fee & Enroll' : 'Enroll'}
                    </button>
                  </div>
                )}
                <ChevronRight size={14} style={{ color: '#CBD5E1', flexShrink: 0 }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────────────────── */}
      {selected && (
        <div className="ar-overlay" onClick={() => setSelected(null)}>
          <div className="ar-drawer" onClick={e => e.stopPropagation()}>
            <div className="ar-drawer-head">
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{selected.student.name || 'Unnamed applicant'}</div>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.15rem' }}>
                  {selected.registrationNumber} · Applying for Class {selected.admission.applyingForClass || '—'}
                  {selected.admission.sectionPreference ? ` · Section ${selected.admission.sectionPreference}` : ''}
                </div>
              </div>
              <button className="ar-drawer-close" onClick={() => setSelected(null)}><X size={13} /></button>
            </div>

            <div className="ar-drawer-body">
              <div className="ar-badge" style={{
                background: STATUS_META[selected.status].bg, color: STATUS_META[selected.status].color,
                borderColor: STATUS_META[selected.status].border, alignSelf: 'flex-start',
              }}>
                {STATUS_META[selected.status].label}
              </div>

              {selected.status === 'rejected' && selected.rejectionReason && (
                <div className="ar-note" style={{ borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <div><strong>Reason:</strong> {selected.rejectionReason}</div>
                </div>
              )}

              <div>
                <div className="ar-section-label" style={{ marginBottom: '0.5rem' }}>Student</div>
                <div className="ar-grid-2">
                  <div className="ar-info-item"><div className="ar-il">Date of Birth</div><div className="ar-iv">{selected.student.dob || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Gender</div><div className="ar-iv">{selected.student.gender || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Category</div><div className="ar-iv">{selected.student.category || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Blood Group</div><div className="ar-iv">{selected.student.bloodGroup || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">APAAR ID</div><div className="ar-iv">{selected.student.apaarId || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">PEN Number</div><div className="ar-iv">{selected.student.penId || '—'}</div></div>
                </div>
              </div>

              <div>
                <div className="ar-section-label" style={{ marginBottom: '0.5rem' }}>Parents</div>
                <div className="ar-grid-2">
                  <div className="ar-info-item"><div className="ar-il">Father</div><div className="ar-iv">{selected.parent.father.name || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Father Phone</div><div className="ar-iv">{selected.parent.father.phone || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Mother</div><div className="ar-iv">{selected.parent.mother.name || '—'}</div></div>
                  <div className="ar-info-item"><div className="ar-il">Mother Phone</div><div className="ar-iv">{selected.parent.mother.phone || '—'}</div></div>
                </div>
              </div>

              <div>
                <div className="ar-section-label" style={{ marginBottom: '0.5rem' }}>Address</div>
                <div className="ar-info-item">
                  <div className="ar-iv" style={{ fontWeight: 500 }}>
                    {[selected.address.current.line1, selected.address.current.city, selected.address.current.state, selected.address.current.pin]
                      .filter(Boolean).join(', ') || '—'}
                  </div>
                </div>
              </div>

              {selected.admission.remarks && (
                <div>
                  <div className="ar-section-label" style={{ marginBottom: '0.5rem' }}>Remarks</div>
                  <div className="ar-info-item"><div className="ar-iv" style={{ fontWeight: 500 }}>{selected.admission.remarks}</div></div>
                </div>
              )}

              {selected.status === 'approved' && (
                <div className="ar-note">
                  <IndianRupee size={14} style={{ flexShrink: 0 }} />
                  <div>
                    {admissionFee.isActive
                      ? `This school charges an admission fee of ₹${admissionFee.amount}. Collecting it will create the Student record and their first invoice, and mark this application "Enrolled."`
                      : 'This school has no admission fee configured — enrolling will create the Student record and their first invoice directly.'}
                  </div>
                </div>
              )}

              {selected.status === 'enrolled' && selected.studentId && (
                <div className="ar-note">
                  <Check size={14} style={{ flexShrink: 0, color: '#16A34A' }} />
                  <div>Enrolled — student record created. Admission No: <strong>{selected.admissionNumber}</strong></div>
                </div>
              )}
            </div>

            {selected.status === 'pending' && (
              <div className="ar-drawer-footer">
                <button className="ar-btn ar-btn-danger" onClick={() => { openReject(selected); }}>
                  <X size={13} /> Reject
                </button>
                <button className="ar-btn ar-btn-success" disabled={busyId === selected.id} onClick={() => handleApprove(selected)}>
                  {busyId === selected.id ? <Loader2 size={13} style={{ animation: 'ar-spin 1s linear infinite' }} /> : <Check size={13} />} Approve
                </button>
              </div>
            )}

            {selected.status === 'approved' && (
              <div className="ar-drawer-footer">
                <button className="ar-btn ar-btn-primary" onClick={() => openEnroll(selected)}>
                  <IndianRupee size={13} /> {admissionFee.isActive ? 'Collect Fee & Enroll' : 'Enroll Student'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reject modal ─────────────────────────────────────────────────── */}
      {rejectTarget && (
        <div className="ar-modal-overlay" onClick={() => !rejecting && setRejectTarget(null)}>
          <div className="ar-modal" onClick={e => e.stopPropagation()}>
            <h3>Reject {rejectTarget.student.name || 'this application'}?</h3>
            <p>A reason is required so the family understands why, and so staff have a record.</p>
            <textarea
              placeholder="e.g. Seats full for this class, incomplete documents…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              autoFocus
            />
            {actionError && <div className="ar-error" style={{ marginTop: '0.6rem', marginBottom: 0 }}><AlertCircle size={13} />{actionError}</div>}
            <div className="ar-modal-actions">
              <button className="ar-btn ar-btn-outline" disabled={rejecting} onClick={() => setRejectTarget(null)}>Cancel</button>
              <button className="ar-btn ar-btn-danger" disabled={rejecting || !rejectReason.trim()} onClick={confirmReject}>
                {rejecting ? <><Loader2 size={13} style={{ animation: 'ar-spin 1s linear infinite' }} /> Rejecting…</> : <><X size={13} /> Reject Application</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Enroll modal ──────────────────────────────────────────────────── */}
      {enrollTarget && (
        <div className="ar-modal-overlay" onClick={() => !enrolling && setEnrollTarget(null)}>
          <div className="ar-modal" onClick={e => e.stopPropagation()}>
            <h3>Enroll {enrollTarget.student.name || 'this applicant'}?</h3>
            <p>
              {admissionFee.isActive
                ? `This creates their student record and first invoice once the ₹${admissionFee.amount} admission fee is recorded.`
                : 'This school has no admission fee configured — this creates their student record and first invoice directly.'}
            </p>

            {admissionFee.isActive && (
              <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <div className="ar-field">
                  <div className="ar-il" style={{ marginBottom: '0.3rem' }}>Amount</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>₹{admissionFee.amount}</div>
                </div>

                <div className="ar-field">
                  <div className="ar-il" style={{ marginBottom: '0.35rem' }}>Payment Mode</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {PAYMENT_MODES.map(m => (
                      <button
                        key={m.value}
                        className={`ar-btn ${enrollMode === m.value ? 'ar-btn-primary' : 'ar-btn-outline'}`}
                        onClick={() => setEnrollMode(m.value)}
                        type="button"
                      >
                        <Banknote size={12} /> {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ar-field">
                  <div className="ar-il" style={{ marginBottom: '0.3rem' }}>Reference Number (optional)</div>
                  <input
                    className="ar-modal-input"
                    placeholder="e.g. UPI transaction ID, cheque number…"
                    value={enrollReference}
                    onChange={e => setEnrollReference(e.target.value)}
                  />
                </div>

                <div className="ar-field">
                  <div className="ar-il" style={{ marginBottom: '0.3rem' }}>Note (optional)</div>
                  <input
                    className="ar-modal-input"
                    placeholder="Any additional context…"
                    value={enrollNote}
                    onChange={e => setEnrollNote(e.target.value)}
                  />
                </div>
              </div>
            )}

            {actionError && <div className="ar-error" style={{ marginTop: '0.6rem', marginBottom: 0 }}><AlertCircle size={13} />{actionError}</div>}

            <div className="ar-modal-actions">
              <button className="ar-btn ar-btn-outline" disabled={enrolling} onClick={() => setEnrollTarget(null)}>Cancel</button>
              <button className="ar-btn ar-btn-primary" disabled={enrolling} onClick={confirmEnroll}>
                {enrolling
                  ? <><Loader2 size={13} style={{ animation: 'ar-spin 1s linear infinite' }} /> Enrolling…</>
                  : <><Check size={13} /> {admissionFee.isActive ? 'Collect Fee & Enroll' : 'Enroll Student'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}