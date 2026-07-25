/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/fees/page.tsx
 *
 * Note: this file previously lived at app/(dashboard)/settings/page.tsx
 * (the settings index), which meant visiting /settings dropped you
 * straight into Fees with no nav to Academic/Transport/Payment/General.
 * Moved here to its correct route now that settings/layout.tsx provides
 * the shared section nav.
 *
 * Changes from the original:
 * - No direct Firestore calls — routes through feeStructureService,
 *   classesService, routesService.
 * - "Milestone" terminology renamed to "Term" throughout (state,
 *   labels, default names) — matches InvoiceTerm/FeeTerm in
 *   types/finance.ts, and how Indian schools actually talk about fee
 *   periods.
 * - No Generation 1–3 legacy migration — greenfield project, nothing
 *   to migrate. normalizeSchedule-equivalent logic now lives in
 *   feeStructureService and only handles the current shape.
 * - Types (TuitionEntry, BooksEntry, MiscFee, FeeTerm, FeeSchedule,
 *   FeeStructureDoc) now come from types/finance.ts instead of being
 *   declared locally.
 * - Route type comes from routesService (transport feature), read-only
 *   here, same as the original treated it.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { feeStructureService, buildTermsForCount } from '@/services/finance/feeStructureService';
import { classesService } from '@/services/academic/classesService';
import { routesService, Route } from '@/services/transport/routesService';
import { schoolService } from '@/services/school/schoolService';
import {
  BooksEntry, FeeCategory, FeeScheduleMode, FeeStructureDoc, MiscFee, TuitionEntry,
} from '@/types/finance';
import {
  Plus, X, Trash2, ChevronRight, Pencil, Check,
  AlertCircle, IndianRupee, Bus, BookOpen, Layers,
  Sparkles, Loader2, MapPin, ExternalLink,
} from 'lucide-react';
import '@/styles/config-fees.css';

// ── Constants ──────────────────────────────────────────────────────────────

const FREQ_OPTS: { value: MiscFee['frequency']; label: string }[] = [
  { value: 'once',    label: 'One-time' },
  { value: 'monthly', label: 'Monthly'  },
  { value: 'annual',  label: 'Annual'   },
];

const TABS: { id: FeeCategory; label: string; icon: React.ReactNode; accent: string }[] = [
  { id: 'tuition',   label: 'Tuition',   icon: <Layers size={13}/>,   accent: '#2563EB' },
  { id: 'transport', label: 'Transport', icon: <Bus size={13}/>,       accent: '#D97706' },
  { id: 'books',     label: 'Books',     icon: <BookOpen size={13}/>,  accent: '#059669' },
  { id: 'misc',      label: 'Misc',      icon: <Sparkles size={13}/>,  accent: '#7C3AED' },
];

const uid = () => crypto.randomUUID().slice(0, 8);

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const calculatePerItem = (amount: number, itemCount: number) => {
  if (!itemCount) return amount;
  return Math.round(amount / itemCount);
};

// ── Component ──────────────────────────────────────────────────────────────

export default function FeeStructurePage() {
  const { profile, loading: authLoading } = useAuth();

  const [data,        setData      ] = useState<FeeStructureDoc>(feeStructureService.emptyFeeStructure([]));
  const [loading,     setLoading   ] = useState(true);
  const [saving,      setSaving    ] = useState(false);
  const [saved,       setSaved     ] = useState(false);
  const [activeTab,   setActiveTab ] = useState<FeeCategory>('tuition');
  const [dirty,       setDirty     ] = useState(false);
  const [classLabels, setClassLabels] = useState<string[]>([]);
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [seededFromPriorYear, setSeededFromPriorYear] = useState(false);

  // Routes from transport config — read-only in this page
  const [routes, setRoutes] = useState<Route[]>([]);

  // misc modal
  const [miscModal,  setMiscModal ] = useState(false);
  const [miscEdit,   setMiscEdit  ] = useState<MiscFee | null>(null);
  const [miscName,   setMiscName  ] = useState('');
  const [miscAmount, setMiscAmount] = useState('');
  const [miscApply,  setMiscApply ] = useState<MiscFee['applicableTo']>('all');
  const [miscClass,  setMiscClass ] = useState('');
  const [miscFreq,   setMiscFreq  ] = useState<MiscFee['frequency']>('once');
  const [miscError,  setMiscError ] = useState('');

  const [delConfirm, setDelConfirm] = useState<{ type: 'misc'; id: string; label: string } | null>(null);

  // ── Classes (read-only, from the future Academic config) ──────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;
    const unsub = classesService.subscribeToClassLabels(profile.schoolId, setClassLabels);
    return () => unsub();
  }, [profile?.schoolId, authLoading]);

  // ── Academic year (one-time read — changes at most once a year,
  // no reason to hold a subscription open for it; same pattern as
  // timetable/page.tsx) ──────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;
    let cancelled = false;
    schoolService.getSchoolProfile(profile.schoolId).then((schoolProfile) => {
      if (!cancelled) setAcademicYear(schoolProfile.currentAcademicYear);
    });
    return () => { cancelled = true; };
  }, [profile?.schoolId, authLoading]);

  // ── Fee structure ───────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId || !academicYear || classLabels.length === 0) return;

    const unsub = feeStructureService.subscribeToFeeStructure(
      profile.schoolId,
      academicYear,
      classLabels,
      (normalized, isSeeded) => {
        setData(normalized);
        setSeededFromPriorYear(isSeeded);
        if (isSeeded) setDirty(true); // copied-forward data differs from what's saved for THIS year
        setLoading(false);
      }
    );
    return () => unsub();
  }, [profile?.schoolId, authLoading, academicYear, classLabels]);

  // ── Routes (read-only, from the future Transport config) ──────────────
  useEffect(() => {
    if (authLoading || !profile?.schoolId) return;
    const unsub = routesService.subscribeToRoutes(profile.schoolId, setRoutes);
    return () => unsub();
  }, [profile?.schoolId, authLoading]);

  // ── Save ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!profile?.schoolId || !academicYear || !dirty) return;
    setSaving(true);
    try {
      await feeStructureService.saveFeeStructure(profile.schoolId, academicYear, data);
      setDirty(false); setSaved(true); setSeededFromPriorYear(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function mutate(next: Partial<FeeStructureDoc>) {
    setData(d => ({ ...d, ...next }));
    setDirty(true);
  }

  const schedule = data.schedule;

  function updateSchedule(next: Partial<FeeStructureDoc['schedule']>) {
    setData(d => {
      const merged = { ...d.schedule, ...next };
      const terms = buildTermsForCount(
        (next.terms ?? d.schedule.terms).length,
        next.terms ?? d.schedule.terms
      );
      return { ...d, schedule: { ...merged, terms } };
    });
    setDirty(true);
  }

  /**
   * Changing the term count only affects the fee structure.
   *
   * Existing invoices are immutable snapshots and are never modified.
   *
   * Only future invoice generation uses the updated schedule.
   */
  function updateTermCount(count: number) {
    updateSchedule({ termCount: count, terms: buildTermsForCount(count, schedule.terms) });
  }

  function updateTuition(idx: number, field: keyof TuitionEntry, val: string | number) {
    mutate({ tuition: data.tuition.map((t, i) => i === idx ? { ...t, [field]: val } : t) });
  }
  function updateBooks(idx: number, field: keyof BooksEntry, val: string | number) {
    mutate({ books: data.books.map((b, i) => i === idx ? { ...b, [field]: val } : b) });
  }

  // misc
  function openMiscModal(fee?: MiscFee) {
    if (fee) {
      setMiscEdit(fee); setMiscName(fee.name); setMiscAmount(String(fee.amount));
      setMiscApply(fee.applicableTo); setMiscClass(fee.classLabel ?? ''); setMiscFreq(fee.frequency);
    } else {
      setMiscEdit(null); setMiscName(''); setMiscAmount('');
      setMiscApply('all'); setMiscClass(''); setMiscFreq('once');
    }
    setMiscError(''); setMiscModal(true);
  }
  function saveMisc() {
    if (!miscName.trim()) { setMiscError('Fee name is required.'); return; }
    const entry: MiscFee = {
      id          : miscEdit?.id ?? uid(),
      name        : miscName.trim(),
      amount      : parseFloat(miscAmount) || 0,
      applicableTo: miscApply,
      frequency   : miscFreq,
      isActive    : miscEdit?.isActive ?? true,
    };
    if (miscApply === 'class') entry.classLabel = miscClass;
    if (miscEdit) mutate({ misc: data.misc.map(m => m.id === miscEdit.id ? entry : m) });
    else          mutate({ misc: [...data.misc, entry] });
    setMiscModal(false);
  }
  function deleteMisc(id: string) {
    mutate({ misc: data.misc.filter(m => m.id !== id) });
    setDelConfirm(null);
  }
  function toggleMiscActive(id: string) {
    mutate({ misc: data.misc.map(m => m.id === id ? { ...m, isActive: !m.isActive } : m) });
  }

  // ── Derived totals ────────────────────────────────────────────────────
  const totalBooks   = data.books.reduce((s, b) => s + (b.amount || 0), 0);
  const totalMisc    = data.misc.filter(m => m.isActive).reduce((s, m) => s + (m.amount || 0), 0);

  const activeRoutes     = routes.filter(r => r.isActive);

  const allStopFees = activeRoutes.flatMap(r => r.stops.map(s => s.transportFee || 0)).filter(f => f > 0);
  const minFee      = allStopFees.length ? Math.min(...allStopFees) : 0;
  const maxFee      = allStopFees.length ? Math.max(...allStopFees) : 0;

  if (authLoading || loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '0.75rem' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#2563EB' }} />
      <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94A3B8', fontFamily: 'system-ui' }}>
        Loading fee structure…
      </p>
    </div>
  );

  return (
    <>
      <div className="fs">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="fs-header">
          <div className="fs-header-left">
            <div className="fs-header-crumb">
              <IndianRupee size={11}/>
              Finance
              <ChevronRight size={10}/>
              Fee Structure
            </div>
            <div className="fs-header-title">Fee Structure</div>
            <div className="fs-header-sub">Define tuition, transport, books &amp; misc charges for the academic year</div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {profile?.schoolId && <div className="fs-school-chip">{profile.schoolId}</div>}
              {academicYear && <div className="fs-school-chip">{academicYear}</div>}
            </div>
          </div>
        </div>

        {seededFromPriorYear && (
          <div className="fs-card" style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.6rem 0.9rem', marginBottom: '0.75rem',
            background: '#EFF6FF', border: '1px solid #BFDBFE',
          }}>
            <AlertCircle size={14} color="#2563EB" />
            <span style={{ fontSize: '0.8rem', color: '#1E40AF' }}>
              Nothing's been saved yet for {academicYear} — showing last year's structure as a starting
              point. Review the amounts below and click Save to confirm them for this year.
            </span>
          </div>
        )}

        {/* ── Summary strip ─────────────────────────────────────────────── */}
        <div className="fs-strip">
          {[
            { icon: <Bus size={11}/>,         label: 'Transport',           val: activeRoutes.length > 0 ? `${fmt(minFee)} – ${fmt(maxFee)}` : '—', sub: `${activeRoutes.length} active route${activeRoutes.length === 1 ? '' : 's'}` },
            { icon: <BookOpen size={11}/>,    label: 'Books Total',         val: fmt(totalBooks),     sub: 'all classes combined' },
            { icon: <Sparkles size={11}/>,    label: 'Misc (active)',       val: fmt(totalMisc),      sub: `${data.misc.filter(m => m.isActive).length} active items` },
          ].map(s => (
            <div className="fs-strip-item" key={s.label}>
              <span className="fs-strip-label">{s.icon} {s.label}</span>
              <span className="fs-strip-val">{s.val}</span>
              <span className="fs-strip-sub">{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Schedule bar ──────────────────────────────────────────────── */}
        <div className="fs-schedule">
          <span className="fs-schedule-label">Payment mode</span>
          <select className="fs-select" value={schedule.mode}
            onChange={e => updateSchedule({ mode: e.target.value as FeeScheduleMode })}>
            <option value="scheduled">Scheduled (installments)</option>
            <option value="flexible">Flexible (open balance)</option>
          </select>

          {schedule.mode === 'scheduled' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap' }}>Terms</span>
              {[2, 3, 4, 6, 10, 12].map(n => (
                <button
                  key={n}
                  onClick={() => updateTermCount(n)}
                  style={{
                    height: '26px', padding: '0 0.55rem', borderRadius: '6px', border: 'none',
                    fontFamily: 'Sora, sans-serif', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.12s',
                    background: schedule.termCount === n ? '#0F172A' : '#F1F5F9',
                    color     : schedule.termCount === n ? '#fff'    : '#64748B',
                  }}
                >{n}</button>
              ))}
            </div>
          )}

          {schedule.mode === 'scheduled' && schedule.terms.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="text" className="fs-select" value={t.name}
                placeholder={`Term ${i + 1}`}
                onChange={e => {
                  const copy = [...schedule.terms];
                  copy[i] = { ...copy[i], name: e.target.value };
                  updateSchedule({ terms: copy });
                }} style={{ width: '120px' }}/>
              <input type="date" className="fs-select" value={t.dueDate}
                onChange={e => {
                  const copy = [...schedule.terms];
                  copy[i] = { ...copy[i], dueDate: e.target.value };
                  updateSchedule({ terms: copy });
                }} style={{ width: '140px' }}/>
            </div>
          ))}

          {schedule.mode === 'flexible' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8' }}>Pay-by date</span>
              <input type="date" className="fs-select" value={schedule.flexibleDueDate}
                onChange={e => updateSchedule({ flexibleDueDate: e.target.value })} style={{ width: '140px' }}/>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8' }}>Last date</span>
            <input type="date" className="fs-select" value={schedule.finalDueDate}
              onChange={e => updateSchedule({ finalDueDate: e.target.value })} style={{ width: '140px' }}/>
          </div>
        </div>

        {/* ── Admission fee ─────────────────────────────────────────────── */}
        {/* Deliberately its own card, not a Misc Fee tab entry — this is a
            one-time gate collected before a student record even exists
            (see the admission-flow planning), not a line item billed to
            an already-enrolled student. Given its own visual weight (not
            styled like the muted Payment-mode config bar) because it
            represents real money charged to parents and needs to
            actually be noticed, not blend into background settings. */}
        <div className={`fs-admission-card ${data.admissionFee.isActive ? 'on' : ''}`}>
          <div className="fs-admission-main">
            <button
              className={`fs-toggle ${data.admissionFee.isActive ? 'on' : 'off'}`}
              onClick={() => mutate({ admissionFee: { ...data.admissionFee, isActive: !data.admissionFee.isActive } })}
              aria-label="Toggle admission fee"
            />
            <div>
              <div className="fs-admission-title">Admission Fee</div>
              <div className="fs-admission-desc">
                A one-time fee collected to confirm a new student's seat — separate from tuition.
              </div>
            </div>
          </div>

          {data.admissionFee.isActive && (
            <div className="fs-admission-amount">
              <span className="fs-amount-prefix">₹</span>
              <input
                type="number"
                value={data.admissionFee.amount || ''}
                placeholder="0"
                onChange={e => mutate({ admissionFee: { ...data.admissionFee, amount: Number(e.target.value) || 0 } })}
              />
            </div>
          )}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="fs-tabs">
          {TABS.map(t => (
            <button key={t.id}
              className={`fs-tab-btn${activeTab === t.id ? ' on' : ''}`}
              style={{ '--ac': t.accent } as React.CSSProperties}
              onClick={() => setActiveTab(t.id)}>
              <span className="fs-tab-pip" style={{ '--ac': t.accent } as React.CSSProperties}/>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="fs-body">

          {/* ═══════ TUITION ═══════ */}
          {activeTab === 'tuition' && (
            <>
              <div className="fs-sec-head">
                <div>
                  <div className="fs-sec-title">Tuition Fee</div>
                  <div className="fs-sec-sub">Set the annual fee amount per class</div>
                </div>
              </div>
              <div className="fs-card">
                <table className="fs-tbl">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Annual Amount</th>
                      <th>Collection Mode</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tuition.map((t, i) => (
                      <tr key={t.classLabel}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span className="fs-chip">{t.classLabel}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>Class {t.classLabel}</div>
                              <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Grade level</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="fs-amt-wrap">
                            <span className="fs-amt-prefix"><IndianRupee size={12}/></span>
                            <input type="number" className="fs-amt-input" min={0} placeholder="0"
                              value={t.amount || ''}
                              onChange={e => updateTuition(i, 'amount', parseFloat(e.target.value) || 0)}/>
                          </div>
                          {schedule.mode === 'scheduled' && t.amount > 0 && (
                            <div style={{ fontSize: '0.62rem', color: '#94A3B8', marginTop: '0.35rem', fontWeight: 600 }}>
                              ≈ {fmt(calculatePerItem(t.amount, schedule.terms.length))} / term
                            </div>
                          )}
                        </td>
                        <td>
                          <div className={`fs-pill ${schedule.mode === 'scheduled' ? 'pill-blue' : 'pill-purple'}`}>
                            {schedule.mode === 'scheduled' ? 'Scheduled' : 'Flexible'}
                          </div>
                        </td>
                        <td>
                          {t.amount > 0
                            ? <span className="fs-pill pill-green"><Check size={8}/> Set</span>
                            : <span className="fs-pill pill-gray">Not set</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ═══════ TRANSPORT (read-only) ═══════ */}
          {activeTab === 'transport' && (
            <>
              <div className="fs-sec-head">
                <div>
                  <div className="fs-sec-title">Transport Fee</div>
                  <div className="fs-sec-sub">Fees are defined per stop in the Transport config. This is a read-only view.</div>
                </div>
                <a
                  href="/settings/transport"
                  className="fs-btn fs-btn-dark"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                >
                  <ExternalLink size={13}/> Manage in Transport
                </a>
              </div>

              {activeRoutes.length === 0 ? (
                <div className="fs-card">
                  <div className="fs-empty">
                    <div className="fs-empty-icon"><Bus size={20}/></div>
                    <h3>No active routes</h3>
                    <p>Go to Transport config to add routes and set per-stop fees</p>
                    <a
                      href="/settings/transport"
                      className="fs-btn fs-btn-ghost"
                      style={{ marginTop: '0.5rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <ExternalLink size={13}/> Open Transport
                    </a>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {routes.map(r => {
                    const fees = r.stops.map(s => s.transportFee || 0).filter(f => f > 0);
                    const lo   = fees.length ? Math.min(...fees) : 0;
                    const hi   = fees.length ? Math.max(...fees) : 0;
                    return (
                      <div key={r.id} className="fs-card" style={{ padding: 0, overflow: 'hidden', opacity: r.isActive ? 1 : 0.5 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '0.75rem 1rem',
                          borderBottom: '1px solid #F1F5F9',
                          background: '#FAFAFA',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: 9,
                              background: '#FFFBEB', color: '#D97706',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <Bus size={14}/>
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0F172A' }}>
                                {r.routeName}
                                {r.routeCode && (
                                  <span style={{
                                    marginLeft: '0.5rem', fontSize: '0.68rem', fontWeight: 600,
                                    color: '#94A3B8', fontFamily: 'monospace',
                                    background: '#F1F5F9', padding: '0.1rem 0.4rem', borderRadius: 4,
                                  }}>{r.routeCode}</span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginTop: '0.1rem' }}>
                                {r.stops.length} stop{r.stops.length === 1 ? '' : 's'}
                                {fees.length > 0 && ` · ${lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {r.isActive
                              ? <span className="fs-pill pill-green"><Check size={8}/> Active</span>
                              : <span className="fs-pill pill-gray">Inactive</span>
                            }
                          </div>
                        </div>

                        <table className="fs-tbl" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 36, textAlign: 'center' }}>#</th>
                              <th>Stop Name</th>
                              <th style={{ textAlign: 'right' }}>Annual Fee</th>
                              <th style={{ textAlign: 'right', display: schedule.mode === 'scheduled' ? undefined : 'none' }}>
                                Per Term
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.stops
                              .slice()
                              .sort((a, b) => a.order - b.order)
                              .map((s, si) => (
                                <tr key={si}>
                                  <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      width: 20, height: 20, borderRadius: '50%',
                                      background: si === 0 ? '#FEF3C7' : si === r.stops.length - 1 ? '#DCFCE7' : '#F1F5F9',
                                      color:      si === 0 ? '#D97706' : si === r.stops.length - 1 ? '#16A34A' : '#64748B',
                                      fontSize: '0.62rem', fontWeight: 700,
                                    }}>{s.order}</span>
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                      <MapPin size={11} style={{
                                        color: si === 0 ? '#D97706' : si === r.stops.length - 1 ? '#16A34A' : '#CBD5E1',
                                        flexShrink: 0,
                                      }}/>
                                      <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1E293B' }}>{s.name}</span>
                                      {si === 0 && (
                                        <span style={{ fontSize: '0.62rem', color: '#D97706', fontWeight: 600,
                                          background: '#FEF3C7', padding: '0.1rem 0.35rem', borderRadius: 4 }}>
                                          Origin
                                        </span>
                                      )}
                                      {si === r.stops.length - 1 && (
                                        <span style={{ fontSize: '0.62rem', color: '#16A34A', fontWeight: 600,
                                          background: '#DCFCE7', padding: '0.1rem 0.35rem', borderRadius: 4 }}>
                                          Terminal
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {s.transportFee > 0 ? (
                                      <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                                        {fmt(s.transportFee)}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>Not set</span>
                                    )}
                                  </td>
                                  {schedule.mode === 'scheduled' && (
                                    <td style={{ textAlign: 'right' }}>
                                      {s.transportFee > 0 ? (
                                        <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600 }}>
                                          ≈ {fmt(calculatePerItem(s.transportFee, schedule.terms.length))}
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: '0.75rem', color: '#E2E8F0' }}>—</span>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}

                  <div style={{
                    fontSize: '0.68rem', color: '#94A3B8',
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.25rem 0.1rem',
                  }}>
                    <Bus size={11}/>
                    Transport fees are managed in{' '}
                    <a href="/settings/transport" style={{ color: '#2563EB', fontWeight: 600 }}>Transport Config</a>.
                    Changes made there reflect here automatically.
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══════ BOOKS ═══════ */}
          {activeTab === 'books' && (
            <>
              <div className="fs-sec-head">
                <div>
                  <div className="fs-sec-title">Books Fee</div>
                  <div className="fs-sec-sub">One-time annual book charges per class</div>
                </div>
              </div>
              <div className="fs-card">
                <table className="fs-tbl">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Amount</th>
                      <th>Note</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.books.map((b, i) => (
                      <tr key={b.classLabel}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span className="fs-chip fs-chip-green">{b.classLabel}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>Class {b.classLabel}</div>
                              <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Annual · one-time</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="fs-amt-wrap">
                            <span className="fs-amt-prefix" style={{ background: '#F0FDF4', color: '#16A34A' }}><IndianRupee size={12}/></span>
                            <input type="number" className="fs-amt-input" min={0} placeholder="0"
                              value={b.amount || ''}
                              onChange={e => updateBooks(i, 'amount', parseFloat(e.target.value) || 0)}/>
                          </div>
                        </td>
                        <td>
                          <input type="text" className="fs-note-input" placeholder="e.g. Includes workbooks"
                            value={b.note}
                            onChange={e => updateBooks(i, 'note', e.target.value)}/>
                        </td>
                        <td>
                          {b.amount > 0
                            ? <span className="fs-pill pill-green"><Check size={8}/> Set</span>
                            : <span className="fs-pill pill-gray">Not set</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ═══════ MISC ═══════ */}
          {activeTab === 'misc' && (
            <>
              <div className="fs-sec-head">
                <div>
                  <div className="fs-sec-title">Miscellaneous Fees</div>
                  <div className="fs-sec-sub">Exam, sports, lab, and any custom school-defined fees</div>
                </div>
                <button className="fs-btn fs-btn-dark" onClick={() => openMiscModal()}>
                  <Plus size={13}/> Add Fee Item
                </button>
              </div>

              {data.misc.length === 0 ? (
                <div className="fs-card">
                  <div className="fs-empty">
                    <div className="fs-empty-icon"><Sparkles size={20}/></div>
                    <h3>No miscellaneous fees defined</h3>
                    <p>Add exam fees, sports charges, lab fees, or any custom fee</p>
                    <button className="fs-btn fs-btn-ghost" style={{ marginTop: '0.5rem' }} onClick={() => openMiscModal()}>
                      <Plus size={13}/> Add First Fee
                    </button>
                  </div>
                </div>
              ) : (
                <div className="fs-misc-grid">
                  {data.misc.map((m, i) => (
                    <div key={m.id} className={`fs-misc-card${m.isActive ? '' : ' off'}`} style={{ animationDelay: `${i * 30}ms` }}>
                      <div className="fs-misc-body">
                        <div className="fs-misc-head">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="fs-misc-icon"><Sparkles size={13}/></div>
                            <div className="fs-misc-name">{m.name}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.2rem' }}>
                            <button className="fs-icon-btn" onClick={() => openMiscModal(m)}><Pencil size={12}/></button>
                            <button className="fs-icon-btn del" onClick={() => setDelConfirm({ type: 'misc', id: m.id, label: m.name })}><Trash2 size={12}/></button>
                          </div>
                        </div>
                        <div className="fs-misc-amount">{fmt(m.amount)}</div>
                        <div className="fs-misc-meta">
                          <span className={`fs-pill ${m.frequency === 'once' ? 'pill-blue' : m.frequency === 'monthly' ? 'pill-amber' : 'pill-purple'}`}>
                            {m.frequency === 'once' ? 'One-time' : m.frequency === 'monthly' ? 'Monthly' : 'Annual'}
                          </span>
                          <span className={`fs-pill ${m.applicableTo === 'all' ? 'pill-green' : m.applicableTo === 'optional' ? 'pill-gray' : 'pill-blue'}`}>
                            {m.applicableTo === 'all' ? 'All students' : m.applicableTo === 'optional' ? 'Optional' : `Class ${m.classLabel}`}
                          </span>
                        </div>
                      </div>
                      <div className="fs-misc-foot">
                        <span className={`fs-misc-status ${m.isActive ? 'on' : 'off'}`}>
                          {m.isActive ? 'Active' : 'Disabled'}
                        </span>
                        <button className={`fs-toggle ${m.isActive ? 'on' : 'off'}`}
                          onClick={() => toggleMiscActive(m.id)}/>
                      </div>
                    </div>
                  ))}
                  <button className="fs-add-card fs-misc-add-card" onClick={() => openMiscModal()}>
                    <div className="fs-add-ring"><Plus size={13}/></div>
                    Add Fee Item
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Floating save bar ───────────────────────────────────────────── */}
        {dirty && (
          <div className="fs-save-bar">
            <span className="fs-save-dot"/>
            <span>Unsaved changes</span>
            <button className="fs-btn fs-btn-ghost fs-btn-sm"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15) !important', color: 'rgba(255,255,255,0.7)' }}
              onClick={() => { setDirty(false); window.location.reload(); }}>
              Discard
            </button>
            <button className={`fs-btn fs-btn-success fs-btn-sm${saving ? ' fs-pulsing' : ''}`}
              disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : saved ? <><Check size={12}/> Saved</> : <><Check size={12}/> Save</>}
            </button>
          </div>
        )}
      </div>

      {/* ── Misc modal ───────────────────────────────────────────────────── */}
      {miscModal && (
        <div className="fs-overlay" onClick={() => setMiscModal(false)}>
          <div className="fs-modal" onClick={e => e.stopPropagation()}>
            <div className="fs-modal-head">
              <div>
                <div className="fs-modal-title">{miscEdit ? 'Edit Fee Item' : 'Add Miscellaneous Fee'}</div>
                <div className="fs-modal-sub">Exam, sports, lab, or any custom fee</div>
              </div>
              <button className="fs-modal-x" onClick={() => setMiscModal(false)}><X size={13}/></button>
            </div>
            {miscError && <div className="fs-merror"><AlertCircle size={12}/>{miscError}</div>}
            <div className="fs-field">
              <label className="fs-label">Fee Name *</label>
              <div className="fs-minput-wrap">
                <Sparkles size={13}/>
                <input className="fs-minput fs-minput-icon" autoFocus
                  placeholder="e.g. Exam Fee, Sports Fee, Lab Charges"
                  value={miscName}
                  onChange={e => { setMiscName(e.target.value); setMiscError(''); }}/>
              </div>
            </div>
            <div className="fs-field">
              <label className="fs-label">Amount (₹)</label>
              <div className="fs-minput-wrap">
                <IndianRupee size={13}/>
                <input type="number" className="fs-minput fs-minput-icon" placeholder="0" min={0}
                  value={miscAmount} onChange={e => setMiscAmount(e.target.value)}/>
              </div>
            </div>
            <div className="fs-field">
              <label className="fs-label">Applicable To</label>
              <div className="fs-radio-row">
                {[{ value: 'all', label: 'All Students' }, { value: 'class', label: 'Specific Class' }, { value: 'optional', label: 'Optional' }].map(o => (
                  <button key={o.value} className={`fs-radio${miscApply === o.value ? ' sel' : ''}`}
                    onClick={() => setMiscApply(o.value as MiscFee['applicableTo'])}>
                    <span className="fs-radio-dot"/>{o.label}
                  </button>
                ))}
              </div>
            </div>
            {miscApply === 'class' && (
              <div className="fs-field">
                <label className="fs-label">Select Class</label>
                <select className="fs-mselect" value={miscClass} onChange={e => setMiscClass(e.target.value)}>
                  <option value="">— Choose a class —</option>
                  {classLabels.map(c => <option key={c} value={c}>Class {c}</option>)}
                </select>
              </div>
            )}
            <div className="fs-field">
              <label className="fs-label">Frequency</label>
              <div className="fs-radio-row">
                {FREQ_OPTS.map(o => (
                  <button key={o.value} className={`fs-radio${miscFreq === o.value ? ' sel' : ''}`}
                    onClick={() => setMiscFreq(o.value)}>
                    <span className="fs-radio-dot"/>{o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="fs-modal-actions">
              <button className="fs-mcancel" onClick={() => setMiscModal(false)}>Cancel</button>
              <button className="fs-mconfirm"
                disabled={!miscName.trim() || (miscApply === 'class' && !miscClass)}
                onClick={saveMisc}>
                {miscEdit ? 'Save Changes' : 'Add Fee Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {delConfirm && (
        <div className="fs-overlay" onClick={() => setDelConfirm(null)}>
          <div className="fs-modal" style={{ maxWidth: '360px' }} onClick={e => e.stopPropagation()}>
            <div className="fs-modal-head">
              <div>
                <div className="fs-modal-title">Delete "{delConfirm.label}"?</div>
                <div className="fs-modal-sub">This action cannot be undone</div>
              </div>
              <button className="fs-modal-x" onClick={() => setDelConfirm(null)}><X size={13}/></button>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748B', lineHeight: 1.65, marginBottom: '0.5rem' }}>
              Existing student records referencing this fee will not be affected. Only the structure definition will be removed.
            </p>
            <div className="fs-modal-actions">
              <button className="fs-mcancel" onClick={() => setDelConfirm(null)}>Cancel</button>
              <button className="fs-mconfirm-del" onClick={() => deleteMisc(delConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}