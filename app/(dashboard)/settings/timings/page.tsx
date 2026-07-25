/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/timings/page.tsx
 *
 * Ported from the old prototype's standalone Master Timings page.
 *
 * Changes from the original:
 * - schoolId now comes from useAuth()'s profile — the original
 *   hardcoded `const schoolId = 'eonschool_001'`, which meant every
 *   school would have read and written the exact same timings
 *   document. Real multi-tenancy bug, not a style nit.
 * - Routes through timingsService (subscribe + save + validation)
 *   instead of raw onSnapshot/setDoc in the component.
 * - Save errors (e.g. "add at least one class period") now show in
 *   the save bar instead of only being logged to the console.
 * - This is now the ONE editor for schools/{schoolId}/config/timings —
 *   the near-identical "Timings Settings" modal embedded in the
 *   Timetable page is being removed in favor of linking here, so
 *   there's a single source of truth for this data instead of two
 *   editors that could drift out of sync with each other.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { timingsService, TimingSlot, TimingSlotType } from '@/services/timetable/timingsService';
import { Plus, Check, Trash2, Coffee, Utensils, Save, Info, GripVertical, AlertCircle } from 'lucide-react';
import '@/styles/config-timings.css';

export default function TimingsPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [masterTimings, setMasterTimings] = useState<TimingSlot[]>([]);
  const [timingsConfigured, setTimingsConfigured] = useState(false);
  const [timingsLoading, setTimingsLoading] = useState(true);
  const [timingsDirty,   setTimingsDirty  ] = useState(false);
  const [timingsSaving,  setTimingsSaving ] = useState(false);
  const [timingsSaved,   setTimingsSaved  ] = useState(false);
  const [saveError,      setSaveError     ] = useState('');
  const [dragFromIdx,    setDragFromIdx   ] = useState<number | null>(null);

  // ── Firestore sync (via service) ─────────────────────────────────────────
  useEffect(() => {
    if (!schoolId) return;
    const unsub = timingsService.subscribeToTimings(schoolId, ({ slots, isConfigured }) => {
      setMasterTimings(slots);
      setTimingsConfigured(isConfigured);
      setTimingsLoading(false);
      setTimingsDirty(false);
    });
    return () => unsub();
  }, [schoolId]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function updateSlot(idx: number, field: keyof TimingSlot, value: string) {
    setMasterTimings(prev => { const n=[...prev]; n[idx]={...n[idx],[field]:value} as TimingSlot; return n; });
    setTimingsDirty(true); setTimingsSaved(false); setSaveError('');
  }
  function deleteSlot(idx: number) {
    setMasterTimings(prev => prev.filter((_,i)=>i!==idx));
    setTimingsDirty(true); setTimingsSaved(false); setSaveError('');
  }
  function addSlot(type: TimingSlotType) {
    const classCount = masterTimings.filter(t=>t.type==='class').length;
    setMasterTimings(prev => [...prev, {
      id: crypto.randomUUID(),
      label: type==='class' ? `Period ${classCount+1}` : type==='break' ? 'Short Break' : 'Lunch Break',
      start: '12:00 PM', end: '12:40 PM', type,
    }]);
    setTimingsDirty(true); setTimingsSaved(false); setSaveError('');
  }
  function handleDragEnd(toIdx: number) {
    if (dragFromIdx===null || dragFromIdx===toIdx) { setDragFromIdx(null); return; }
    setMasterTimings(prev => {
      const n=[...prev]; const [m]=n.splice(dragFromIdx,1); n.splice(toIdx,0,m); return n;
    });
    setDragFromIdx(null); setTimingsDirty(true); setTimingsSaved(false); setSaveError('');
  }
  async function saveTimings() {
    if (!schoolId) return;
    setTimingsSaving(true); setSaveError('');
    try {
      const result = await timingsService.saveTimings(schoolId, masterTimings);
      if (!result.ok) { setSaveError(result.error); return; }
      setTimingsDirty(false); setTimingsSaved(true);
      setTimeout(() => setTimingsSaved(false), 3000);
    } catch(e) { console.error(e); setSaveError('Failed to save. Please try again.'); }
    finally { setTimingsSaving(false); }
  }
  function resetToDefault() {
    setMasterTimings(timingsService.defaultTimings());
    setTimingsDirty(true); setTimingsSaved(false); setSaveError('');
  }

  const classPeriods = masterTimings.filter(t=>t.type==='class').length;

  return (
    <>
      {/* Header */}
      <div className="cfg-content-head">
        <div>
          <div className="cfg-content-title">Master Timings</div>
          <div className="cfg-content-sub">Global period schedule — applies to all grades and sections</div>
        </div>
        {timingsDirty && (
          <span className="cfg-dirty-pill">
            ● Unsaved changes
          </span>
        )}
      </div>

      {/* Body */}
      <div className="cfg-content-body">
        <div className="tmg-banner">
          <Info size={15}/>
          <span>
            These timings are shared across <strong>all classes and sections</strong>.
            Changes here will affect how slots appear on every timetable. Save after editing.
            {!timingsLoading && !timingsConfigured && (
              <> <strong>Nothing is saved yet</strong> — what's shown below is a suggested starting point.</>
            )}
          </span>
        </div>

        {saveError && (
          <div className="tmg-error"><AlertCircle size={14} />{saveError}</div>
        )}

        <div className="tmg-layout">
          {/* ── Left: slot editor ── */}
          <div>
            <div className="tmg-col-heads">
              <span className="tmg-col-head"></span>
              <span className="tmg-col-head">Type</span>
              <span className="tmg-col-head">Label</span>
              <span className="tmg-col-head">Start</span>
              <span className="tmg-col-head">End</span>
              <span className="tmg-col-head"></span>
            </div>

            {timingsLoading
              ? [1,2,3,4,5].map(i=><div key={i} className="cfg-shimmer"/>)
              : masterTimings.map((slot, idx) => (
                  <div key={slot.id}
                    className={`tmg-slot-row type-${slot.type}${dragFromIdx===idx?' dragging':''}`}
                    onDragOver={e=>e.preventDefault()}
                    onDrop={()=>handleDragEnd(idx)}
                    style={{ animationDelay:`${idx*30}ms` }}
                  >
                    <div className="tmg-drag" draggable
                      onDragStart={()=>setDragFromIdx(idx)}
                      onDragEnd={()=>setDragFromIdx(null)}>
                      <GripVertical size={14}/>
                    </div>
                    <select className={`tmg-type-sel tmg-type-${slot.type}`}
                      value={slot.type} onChange={e=>updateSlot(idx,'type',e.target.value)}>
                      <option value="class">📚 Class</option>
                      <option value="break">☕ Interval</option>
                      <option value="lunch">🍽 Lunch</option>
                    </select>
                    <input className="tmg-input" value={slot.label} placeholder="Label"
                      onChange={e=>updateSlot(idx,'label',e.target.value)}/>
                    <input className="tmg-input tmg-time-input" value={slot.start} placeholder="09:00 AM"
                      onChange={e=>updateSlot(idx,'start',e.target.value)}/>
                    <input className="tmg-input tmg-time-input" value={slot.end} placeholder="09:40 AM"
                      onChange={e=>updateSlot(idx,'end',e.target.value)}/>
                    <button className="tmg-del-btn" onClick={()=>deleteSlot(idx)}>
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))
            }

            <div className="tmg-add-row">
              <button className="tmg-add-btn tmg-add-class" onClick={()=>addSlot('class')}><Plus size={13}/> Add Period</button>
              <button className="tmg-add-btn tmg-add-break" onClick={()=>addSlot('break')}><Coffee size={13}/> Add Break</button>
              <button className="tmg-add-btn tmg-add-lunch" onClick={()=>addSlot('lunch')}><Utensils size={13}/> Add Lunch</button>
            </div>
          </div>

          {/* ── Right: summary + save ── */}
          <div className="tmg-sidebar">
            <div className="tmg-summary-card">
              <div className="tmg-summary-head">Summary</div>
              <div className="tmg-summary-body">
                {[
                  { label:'Class Periods', val:classPeriods,                                              color:'#2563EB' },
                  { label:'Breaks',        val:masterTimings.filter(t=>t.type==='break').length,          color:'#D97706' },
                  { label:'Lunch Slots',   val:masterTimings.filter(t=>t.type==='lunch').length,          color:'#EA580C' },
                  { label:'Total Slots',   val:masterTimings.length,                                      color:'#0F172A' },
                ].map(r=>(
                  <div className="tmg-summary-row" key={r.label}>
                    <span className="tmg-summary-label">
                      <span style={{width:6,height:6,borderRadius:'50%',background:r.color,display:'inline-block'}}/>
                      {r.label}
                    </span>
                    <span className="tmg-summary-val">{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tmg-summary-card">
              <div className="tmg-summary-head">Day Preview</div>
              <div className="tmg-summary-body tmg-timeline" style={{padding:'0.6rem 0.75rem'}}>
                {masterTimings.map(slot=>{
                  const color = slot.type==='class'?'#2563EB':slot.type==='break'?'#D97706':'#EA580C';
                  const bg    = slot.type==='class'?'#EFF6FF':slot.type==='break'?'#FFFBEB':'#FFF7ED';
                  return (
                    <div key={slot.id} className="tmg-tl-item" style={{background:bg}}>
                      <div className="tmg-tl-dot" style={{background:color}}/>
                      <span className="tmg-tl-label" style={{color}}>{slot.label}</span>
                      <span className="tmg-tl-time">{slot.start}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="tmg-save-bar">
              <button className={`tmg-save-btn${timingsSaved?' saved':''}`}
                disabled={timingsSaving||!timingsDirty} onClick={saveTimings}>
                {timingsSaving ? <>Saving…</> : timingsSaved ? <><Check size={14}/> Saved</> : <><Save size={14}/> Save Master Clock</>}
              </button>
              <button className="tmg-reset-btn" onClick={resetToDefault}>Reset to default</button>
              {timingsDirty && !timingsSaved && (
                <div className="tmg-dirty-notice">● Unsaved changes</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}