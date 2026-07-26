'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import '@/styles/notices.css';
import {
  collection, onSnapshot, addDoc, serverTimestamp,
  query, orderBy, Timestamp,
} from 'firebase/firestore';
import {
  Bell, Plus, X, Send, School, Users,
  Megaphone, Clock, Search, BookOpen,
  AlertTriangle, Info, ChevronRight, Flame,
  Calendar, Tag, CheckCircle2, Filter,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
type NoticeTarget   = 'school' | 'class';
type NoticePriority = 'normal' | 'important' | 'urgent';
type NoticeCategory = 'general' | 'academic' | 'event' | 'fee' | 'holiday';

interface Notice {
  id       : string;
  title    : string;
  body     : string;
  target   : { type: NoticeTarget; id: string; label: string };
  priority : NoticePriority;
  category : NoticeCategory;
  createdBy: string;
  createdAt: Timestamp | null;
}

// ── Meta ───────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<NoticePriority, {
  label: string; color: string; bg: string; border: string;
  stripe: string; icon: React.ElementType;
}> = {
  normal   : { label: 'Normal',    color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0', stripe: '#CBD5E1', icon: Info          },
  important: { label: 'Important', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', stripe: '#F59E0B', icon: Flame         },
  urgent   : { label: 'Urgent',    color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', stripe: '#EF4444', icon: AlertTriangle },
};

const CATEGORY_META: Record<NoticeCategory, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  general : { label: 'General',  emoji: '📢', color: '#475569', bg: '#F1F5F9', border: '#CBD5E1' },
  academic: { label: 'Academic', emoji: '📚', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  event   : { label: 'Event',    emoji: '🎉', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  fee     : { label: 'Fee',      emoji: '💳', color: '#059669', bg: '#F0FDF4', border: '#BBF7D0' },
  holiday : { label: 'Holiday',  emoji: '🏖️', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
};

const EMPTY_FORM = {
  title   : '',
  body    : '',
  target  : 'school' as NoticeTarget,
  classId : '',
  priority: 'normal' as NoticePriority,
  category: 'general' as NoticeCategory,
};

// ── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(ts: Timestamp | null): string {
  if (!ts) return '—';
  const secs = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
  if (secs < 60)    return 'Just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return ts.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fullDate(ts: Timestamp | null): string {
  if (!ts) return '';
  return ts.toDate().toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const MAX_BODY = 1000;

// ── Component ──────────────────────────────────────────────────────────────
export default function NoticesPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? '';

  const [notices,    setNotices   ] = useState<Notice[]>([]);
  const [classes,    setClasses   ] = useState<any[]>([]);
  const [loading,    setLoading   ] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form,       setForm      ] = useState(EMPTY_FORM);
  const [sending,    setSending   ] = useState(false);
  const [sent,       setSent      ] = useState(false);
  const [formError,  setFormError ] = useState('');
  const [search,     setSearch    ] = useState('');
  const [filterCat,  setFilterCat ] = useState<NoticeCategory | 'all'>('all');
  const [filterPri,  setFilterPri ] = useState<NoticePriority | 'all'>('all');
  const [selected,   setSelected  ] = useState<Notice | null>(null);

  // Escape key closes drawer
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && drawerOpen && !sending) setDrawerOpen(false);
  }, [drawerOpen, sending]);
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Firestore ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(
      query(collection(db, 'schools', schoolId, 'notifications'), orderBy('createdAt', 'desc')),
      snap => { setNotices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notice))); setLoading(false); }
    );
    return () => unsub();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(
      collection(db, 'schools', schoolId, 'classes'),
      snap => setClasses(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => parseInt(a.className) - parseInt(b.className))
      )
    );
    return () => unsub();
  }, [schoolId]);

  // ── Post notice ───────────────────────────────────────────────────────────
  async function handlePost() {
    if (!form.title.trim())                         { setFormError('Title is required.'); return; }
    if (!form.body.trim())                          { setFormError('Notice body is required.'); return; }
    if (form.target === 'class' && !form.classId)  { setFormError('Select a class.'); return; }
    setFormError(''); setSending(true);

    const targetClass = form.target === 'class' ? classes.find(c => c.id === form.classId) : null;
    try {
      await addDoc(collection(db, 'schools', schoolId, 'notifications'), {
        title    : form.title.trim(),
        body     : form.body.trim(),
        target   : {
          type : form.target,
          id   : form.target === 'school' ? schoolId : form.classId,
          label: form.target === 'school' ? 'All School' : `Class ${targetClass?.className ?? form.classId}`,
        },
        priority : form.priority,
        category : form.category,
        channel  : 'push',
        createdBy: 'Administrator',
        createdAt: serverTimestamp(),
        readBy   : {},
        stats    : { sent: 0, failed: 0 },
      });
      setSent(true);
      setTimeout(() => { setForm(EMPTY_FORM); setDrawerOpen(false); setSent(false); }, 1400);
    } catch (err) {
      console.error(err); setFormError('Failed to post. Please try again.');
    } finally { setSending(false); }
  }

  // ── Counts for filter pills ───────────────────────────────────────────────
  const catCounts = notices.reduce((acc, n) => {
    acc[n.category] = (acc[n.category] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const urgentCount = notices.filter(n => n.priority === 'urgent').length;

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = notices.filter(n => {
    const q = search.toLowerCase();
    return (
      (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) &&
      (filterCat === 'all' || n.category === filterCat) &&
      (filterPri === 'all' || n.priority === filterPri)
    );
  });

  const bodyChars = form.body.length;

  return (
    <>

      <div className="ntc">

        {/* ══════════ LEFT PANEL ══════════ */}
        <aside className="ntc-left">
          <div className="ntc-topbar">
            <div className="ntc-topbar-row">
              <div className="ntc-heading">
                <div className="ntc-heading-icon"><Bell size={14}/></div>
                Notices
                {urgentCount > 0 && (
                  <span className="ntc-urgent-chip">
                    <AlertTriangle size={9}/> {urgentCount} urgent
                  </span>
                )}
              </div>
              <button className="ntc-post-btn" onClick={() => setDrawerOpen(true)}>
                <Plus size={13}/> Post Notice
              </button>
            </div>

            {/* Search */}
            <div className="ntc-search-wrap">
              <Search size={13} className="ntc-search-icon"/>
              <input
                className="ntc-search"
                placeholder="Search by title or content…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Filter bar */}
            <div className="ntc-filter-bar">
              {/* Category filters */}
              <button
                className={`ntc-pill${filterCat === 'all' ? ' sel' : ''}`}
                onClick={() => setFilterCat('all')}>
                All
                <span className="ntc-pill-count">{notices.length}</span>
              </button>
              {(Object.entries(CATEGORY_META) as [NoticeCategory, any][]).map(([key, meta]) => (
                <button
                  key={key}
                  className={`ntc-pill${filterCat === key ? ' sel' : ''}`}
                  onClick={() => setFilterCat(filterCat === key ? 'all' : key)}>
                  {meta.emoji} {meta.label}
                  {catCounts[key] > 0 && (
                    <span className="ntc-pill-count">{catCounts[key]}</span>
                  )}
                </button>
              ))}

              <div className="ntc-pill-divider"/>

              {/* Urgent quick filter */}
              <button
                className={`ntc-pill${filterPri === 'urgent' ? ' sel-urgent' : ''}`}
                onClick={() => setFilterPri(filterPri === 'urgent' ? 'all' : 'urgent')}>
                <AlertTriangle size={9}/> Urgent
              </button>
            </div>
          </div>

          {/* List */}
          <div className="ntc-list">
            {loading ? (
              [1,2,3,4].map(i => (
                <div key={i} className="ntc-shimmer" style={{ animationDelay: `${i*100}ms` }}/>
              ))
            ) : filtered.length === 0 ? (
              <div className="ntc-empty">
                <div className="ntc-empty-ring"><Megaphone size={20}/></div>
                <div className="ntc-empty-title">
                  {search ? `No results for "${search}"` : 'No notices yet'}
                </div>
                <div className="ntc-empty-sub">
                  {search ? 'Try a different search term or clear filters.' : 'Post the first notice to get started.'}
                </div>
                {!search && (
                  <button className="ntc-empty-cta" onClick={() => setDrawerOpen(true)}>
                    <Plus size={12}/> Post Notice
                  </button>
                )}
              </div>
            ) : filtered.map((n, idx) => {
              const pri = PRIORITY_META[n.priority ?? 'normal'];
              const cat = CATEGORY_META[n.category ?? 'general'];
              const PriIcon = pri.icon;
              return (
                <div
                  key={n.id}
                  className={`ntc-card${selected?.id === n.id ? ' active' : ''}`}
                  style={{
                    '--stripe': pri.stripe,
                    animationDelay: `${idx * 20}ms`,
                    animation: 'ntcUp 0.2s ease both',
                  } as React.CSSProperties}
                  onClick={() => setSelected(n)}
                >
                  <div className="ntc-card-top">
                    <div className="ntc-card-title">{n.title}</div>
                    <span
                      className="ntc-card-time"
                      title={fullDate(n.createdAt)}
                    >
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <div className="ntc-card-snippet">{n.body}</div>
                  <div className="ntc-card-footer">
                    {n.priority !== 'normal' && (
                      <span className="ntc-badge" style={{ background: pri.bg, color: pri.color, borderColor: pri.border }}>
                        <PriIcon size={9}/> {pri.label}
                      </span>
                    )}
                    <span className="ntc-badge" style={{ background: cat.bg, color: cat.color, borderColor: cat.border }}>
                      {cat.emoji} {cat.label}
                    </span>
                    <span className="ntc-badge" style={{ background: '#F8FAFC', color: '#64748B', borderColor: '#E2E8F0' }}>
                      {n.target?.type === 'school' ? <School size={9}/> : <Users size={9}/>}
                      &nbsp;{n.target?.label ?? '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ══════════ DETAIL PANEL ══════════ */}
        <div className="ntc-detail">
          {!selected ? (
            <div className="ntc-detail-ph">
              <div className="ntc-detail-ph-ring"><Bell size={24}/></div>
              <p>Select a notice to read</p>
            </div>
          ) : (() => {
            const pri    = PRIORITY_META[selected.priority ?? 'normal'];
            const cat    = CATEGORY_META[selected.category ?? 'general'];
            const PriIcon = pri.icon;
            return (
              <div className="ntc-article">
                {/* Eyebrow */}
                <div className="ntc-article-eye">
                  <span
                    className="ntc-article-cat-badge"
                    style={{ background: cat.bg, color: cat.color, borderColor: cat.border }}
                  >
                    {cat.emoji} {cat.label}
                  </span>
                </div>

                {/* Title */}
                <h1 className="ntc-article-title">{selected.title}</h1>

                {/* Meta strip */}
                <div className="ntc-article-meta">
                  <div className="ntc-article-meta-item">
                    <Clock size={12}/>
                    <span title={fullDate(selected.createdAt)}>{timeAgo(selected.createdAt)}</span>
                  </div>
                  <div className="ntc-article-meta-sep"/>
                  <div className="ntc-article-meta-item">
                    <BookOpen size={12}/>
                    <span>By {selected.createdBy ?? 'Administrator'}</span>
                  </div>
                  <div className="ntc-article-meta-sep"/>
                  <div className="ntc-article-meta-item">
                    {selected.target?.type === 'school' ? <School size={12}/> : <Users size={12}/>}
                    <span>{selected.target?.label ?? '—'}</span>
                  </div>
                </div>

                {/* Priority banner — only for important / urgent */}
                {selected.priority !== 'normal' && (
                  <div
                    className="ntc-priority-banner"
                    style={{ background: pri.bg, borderColor: pri.border }}
                  >
                    <div className="ntc-priority-banner-icon" style={{ color: pri.color }}>
                      <PriIcon size={16}/>
                    </div>
                    <div>
                      <div className="ntc-priority-banner-label" style={{ color: pri.color }}>
                        {pri.label} Notice
                      </div>
                      <div className="ntc-priority-banner-sub" style={{ color: pri.color }}>
                        {selected.priority === 'urgent'
                          ? 'This notice requires immediate attention.'
                          : 'Please read and acknowledge this notice.'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Body */}
                <div className="ntc-article-body">{selected.body}</div>

                {/* Info cards */}
                <div className="ntc-info-grid">
                  <div className="ntc-info-card">
                    <div className="ntc-info-card-label">Posted</div>
                    <div className="ntc-info-card-val">
                      <Calendar size={13} style={{ color: '#94A3B8' }}/>
                      {selected.createdAt
                        ? selected.createdAt.toDate().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
                        : '—'}
                    </div>
                  </div>
                  <div className="ntc-info-card">
                    <div className="ntc-info-card-label">Audience</div>
                    <div className="ntc-info-card-val">
                      {selected.target?.type === 'school' ? <School size={13} style={{ color: '#94A3B8' }}/> : <Users size={13} style={{ color: '#94A3B8' }}/>}
                      {selected.target?.label ?? '—'}
                    </div>
                  </div>
                  <div className="ntc-info-card">
                    <div className="ntc-info-card-label">Channel</div>
                    <div className="ntc-info-card-val">
                      <Bell size={13} style={{ color: '#94A3B8' }}/> Push Notification
                    </div>
                  </div>
                  <div className="ntc-info-card">
                    <div className="ntc-info-card-label">Priority</div>
                    <div className="ntc-info-card-val" style={{ color: pri.color }}>
                      <PriIcon size={13}/> {pri.label}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ══════════ DRAWER ══════════ */}
      {drawerOpen && (
        <div className="ntc-overlay">
          <div className="ntc-backdrop" onClick={() => !sending && setDrawerOpen(false)}/>
          <div className="ntc-drawer" role="dialog" aria-modal="true" aria-label="Post Notice">
            <div className="ntc-drawer-head">
              <div>
                <h2>Post Notice</h2>
                <p>Notify students, parents &amp; teachers instantly</p>
              </div>
              <button
                className="ntc-drawer-close"
                onClick={() => !sending && setDrawerOpen(false)}
                aria-label="Close"
              >
                <X size={14}/>
              </button>
            </div>

            <div className="ntc-drawer-body">
              {formError && (
                <div className="ntc-error">
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }}/>
                  {formError}
                </div>
              )}

              {/* Content */}
              <div className="ntc-section-label">Content</div>

              <div className="ntc-field">
                <label className="ntc-label">Title <span style={{ color: '#EF4444' }}>*</span></label>
                <input
                  className="ntc-input"
                  placeholder="e.g. School closed on Friday"
                  value={form.title}
                  maxLength={120}
                  onChange={e => { setForm({...form, title: e.target.value}); setFormError(''); }}
                />
              </div>

              <div className="ntc-field">
                <label className="ntc-label">
                  Message <span style={{ color: '#EF4444' }}>*</span>
                  <span className={`ntc-label-hint${bodyChars > MAX_BODY * 0.9 ? ' ntc-char-count warn' : ''}`}>
                    {bodyChars}/{MAX_BODY}
                  </span>
                </label>
                <textarea
                  className="ntc-input ntc-textarea"
                  placeholder="Write the full notice here…"
                  value={form.body}
                  maxLength={MAX_BODY}
                  onChange={e => { setForm({...form, body: e.target.value}); setFormError(''); }}
                />
              </div>

              {/* Delivery */}
              <div className="ntc-section-label">Delivery</div>

              <div className="ntc-field">
                <label className="ntc-label">Send To</label>
                <div className="ntc-target-row">
                  <button
                    className={`ntc-target-opt${form.target === 'school' ? ' active' : ''}`}
                    onClick={() => setForm({...form, target:'school', classId:''})}>
                    <School size={14}/> All School
                  </button>
                  <button
                    className={`ntc-target-opt${form.target === 'class' ? ' active' : ''}`}
                    onClick={() => setForm({...form, target:'class'})}>
                    <Users size={14}/> Specific Class
                  </button>
                </div>
                {form.target === 'class' && (
                  <select
                    className="ntc-select"
                    value={form.classId}
                    onChange={e => setForm({...form, classId: e.target.value})}>
                    <option value="">Select class…</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>Class {c.className}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Classification */}
              <div className="ntc-section-label">Classification</div>

              <div className="ntc-field">
                <label className="ntc-label">Category</label>
                <select
                  className="ntc-select"
                  value={form.category}
                  onChange={e => setForm({...form, category: e.target.value as NoticeCategory})}>
                  {(Object.entries(CATEGORY_META) as [NoticeCategory, any][]).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.emoji} {meta.label}</option>
                  ))}
                </select>
              </div>

              <div className="ntc-field">
                <label className="ntc-label">Priority</label>
                <div className="ntc-priority-row">
                  {(Object.entries(PRIORITY_META) as [NoticePriority, any][]).map(([key, meta]) => {
                    const active = form.priority === key;
                    const Icon   = meta.icon;
                    return (
                      <button
                        key={key}
                        className="ntc-priority-opt"
                        style={{
                          background  : active ? meta.bg    : '#F8FAFC',
                          borderColor : active ? meta.stripe : '#E2E8F0',
                          color       : active ? meta.color  : '#94A3B8',
                        }}
                        onClick={() => setForm({...form, priority: key as NoticePriority})}>
                        <Icon size={12}/> {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="ntc-drawer-foot">
              <button
                className={`ntc-send-btn${sent ? ' sent' : ''}`}
                disabled={sending || bodyChars > MAX_BODY}
                onClick={handlePost}
              >
                {sending ? (
                  <><div className="ntc-spinner"/> Posting…</>
                ) : sent ? (
                  <><CheckCircle2 size={15}/> Posted Successfully</>
                ) : (
                  <><Send size={14}/> Post Notice</>
                )}
              </button>
              <div className="ntc-send-hint">Press <kbd style={{ background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:4, padding:'0 4px', fontSize:'0.6rem' }}>Esc</kbd> to discard</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}