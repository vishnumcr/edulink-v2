'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');

        /* ── Reset ─────────────────────────────────────────────────────── */
        .ntc *, .ntc *::before, .ntc *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── Shell ─────────────────────────────────────────────────────── */
        .ntc {
          display: flex;
          height: calc(100vh - 72px);
          font-family: 'Geist', system-ui, sans-serif;
          background: #F4F6FA;
          color: #0F172A;
          overflow: hidden;
        }

        /* ══════════════════ LEFT PANEL ══════════════════ */
        .ntc-left {
          width: 380px; min-width: 380px;
          background: #fff;
          border-right: 1px solid #E8EDF3;
          display: flex; flex-direction: column;
          overflow: hidden;
        }

        /* Top bar */
        .ntc-topbar {
          padding: 1rem 1rem 0;
          border-bottom: 1px solid #F1F5F9;
          flex-shrink: 0;
        }
        .ntc-topbar-row {
          display: flex; align-items: center;
          justify-content: space-between;
          margin-bottom: 0.9rem;
        }
        .ntc-heading {
          display: flex; align-items: center; gap: 0.5rem;
          font-size: 0.9rem; font-weight: 700; color: #0F172A;
        }
        .ntc-heading-icon {
          width: 30px; height: 30px; border-radius: 8px;
          background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
          display: flex; align-items: center; justify-content: center;
          color: #fff; flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(79,70,229,0.3);
        }

        /* Urgent chip */
        .ntc-urgent-chip {
          display: inline-flex; align-items: center; gap: 0.25rem;
          background: #FEF2F2; border: 1px solid #FECACA;
          color: #DC2626; border-radius: 99px;
          font-size: 0.6rem; font-weight: 700;
          padding: 0.15rem 0.5rem; letter-spacing: 0.04em;
        }

        /* Post button */
        .ntc-post-btn {
          display: flex; align-items: center; gap: 0.35rem;
          padding: 0.45rem 0.9rem; border-radius: 8px;
          background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
          border: none; color: #fff;
          font-family: 'Geist', sans-serif; font-size: 0.72rem; font-weight: 600;
          cursor: pointer; transition: opacity 0.12s, transform 0.1s;
          box-shadow: 0 2px 8px rgba(79,70,229,0.3);
        }
        .ntc-post-btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .ntc-post-btn:active { transform: translateY(0); }

        /* Search */
        .ntc-search-wrap {
          position: relative; margin-bottom: 0.75rem;
        }
        .ntc-search-icon {
          position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
          color: #94A3B8; pointer-events: none;
        }
        .ntc-search {
          width: 100%; height: 36px;
          background: #F8FAFC; border: 1px solid #E8EDF3; border-radius: 8px;
          padding: 0 0.75rem 0 2.1rem;
          font-family: 'Geist', sans-serif; font-size: 0.8rem; color: #0F172A;
          outline: none; transition: all 0.15s;
        }
        .ntc-search::placeholder { color: #CBD5E1; }
        .ntc-search:focus { border-color: #A5B4FC; background: #fff; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }

        /* Filter bar */
        .ntc-filter-bar {
          display: flex; align-items: center; gap: 0.35rem;
          padding-bottom: 0.75rem;
          overflow-x: auto;
        }
        .ntc-filter-bar::-webkit-scrollbar { display: none; }

        .ntc-pill {
          flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 0.25rem;
          padding: 0.22rem 0.6rem; border-radius: 99px;
          font-size: 0.64rem; font-weight: 600; cursor: pointer;
          border: 1px solid #E2E8F0; background: transparent; color: #94A3B8;
          font-family: 'Geist', sans-serif; transition: all 0.12s;
          white-space: nowrap;
        }
        .ntc-pill:hover { color: #475569; border-color: #CBD5E1; }
        .ntc-pill.sel {
          background: #EEF2FF; border-color: #C7D2FE; color: #4F46E5;
        }
        .ntc-pill.sel-urgent { background: #FEF2F2; border-color: #FECACA; color: #DC2626; }
        .ntc-pill-count {
          background: rgba(0,0,0,0.08); border-radius: 99px;
          padding: 0 4px; font-size: 0.58rem; font-weight: 700;
          min-width: 14px; text-align: center;
        }
        .ntc-pill-divider { width: 1px; height: 16px; background: #E8EDF3; flex-shrink: 0; }

        /* Notice list */
        .ntc-list {
          flex: 1; overflow-y: auto; padding: 0.5rem;
        }
        .ntc-list::-webkit-scrollbar { width: 3px; }
        .ntc-list::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 99px; }

        /* Notice card — signature element: left priority stripe */
        .ntc-card {
          position: relative;
          padding: 0.9rem 0.9rem 0.9rem 1.1rem;
          border-radius: 10px; margin-bottom: 0.3rem;
          border: 1px solid #F1F5F9;
          cursor: pointer; transition: all 0.12s;
          background: #FAFAFA;
          overflow: hidden;
        }
        .ntc-card::before {
          content: '';
          position: absolute; left: 0; top: 8px; bottom: 8px;
          width: 3px; border-radius: 0 3px 3px 0;
          background: var(--stripe);
          transition: top 0.12s, bottom 0.12s;
        }
        .ntc-card:hover { background: #F8FAFC; border-color: #E2E8F0; transform: translateX(1px); }
        .ntc-card:hover::before { top: 0; bottom: 0; }
        .ntc-card.active {
          background: #EEF2FF; border-color: #C7D2FE;
        }
        .ntc-card.active::before { top: 0; bottom: 0; background: #4F46E5; }

        @keyframes ntcUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .ntc-card-top {
          display: flex; align-items: flex-start;
          justify-content: space-between; gap: 0.5rem;
          margin-bottom: 0.3rem;
        }
        .ntc-card-title {
          font-size: 0.82rem; font-weight: 600; color: #0F172A;
          line-height: 1.35; flex: 1;
        }
        .ntc-card-time {
          font-size: 0.6rem; color: #94A3B8; flex-shrink: 0;
          white-space: nowrap; margin-top: 1px;
          font-variant-numeric: tabular-nums;
        }
        .ntc-card-snippet {
          font-size: 0.73rem; color: #64748B; line-height: 1.5;
          margin-bottom: 0.6rem;
          display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; overflow: hidden;
        }
        .ntc-card-footer {
          display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;
        }

        /* Tiny badges */
        .ntc-badge {
          display: inline-flex; align-items: center; gap: 0.2rem;
          padding: 0.13rem 0.42rem; border-radius: 5px;
          font-size: 0.6rem; font-weight: 700; border: 1px solid;
          white-space: nowrap; line-height: 1.4;
        }

        /* Shimmer */
        .ntc-shimmer {
          height: 88px; border-radius: 10px; margin-bottom: 0.3rem;
          background: linear-gradient(90deg, #F1F5F9 25%, #E8EDF3 50%, #F1F5F9 75%);
          background-size: 200% 100%;
          animation: ntcShimmer 1.5s ease-in-out infinite;
        }
        @keyframes ntcShimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Empty state */
        .ntc-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 3rem 1rem; gap: 0.6rem; text-align: center;
        }
        .ntc-empty-ring {
          width: 48px; height: 48px; border-radius: 12px;
          border: 1.5px dashed #E2E8F0;
          display: flex; align-items: center; justify-content: center; color: #CBD5E1;
        }
        .ntc-empty-title { font-size: 0.8rem; font-weight: 600; color: #64748B; }
        .ntc-empty-sub   { font-size: 0.72rem; color: #94A3B8; }
        .ntc-empty-cta {
          margin-top: 0.25rem;
          display: inline-flex; align-items: center; gap: 0.3rem;
          padding: 0.45rem 0.9rem; border-radius: 8px;
          background: #4F46E5; color: #fff; border: none;
          font-family: 'Geist', sans-serif; font-size: 0.72rem; font-weight: 600;
          cursor: pointer; transition: opacity 0.12s;
        }
        .ntc-empty-cta:hover { opacity: 0.88; }

        /* ══════════════════ DETAIL PANEL ══════════════════ */
        .ntc-detail {
          flex: 1; height: 100%; overflow-y: auto;
          display: flex; flex-direction: column;
          background: #F4F6FA;
        }
        .ntc-detail::-webkit-scrollbar { width: 4px; }
        .ntc-detail::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 99px; }

        /* Empty detail */
        .ntc-detail-ph {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 0.75rem;
          padding: 2rem;
        }
        .ntc-detail-ph-ring {
          width: 64px; height: 64px; border-radius: 16px;
          background: #fff; border: 1.5px solid #E8EDF3;
          display: flex; align-items: center; justify-content: center; color: #CBD5E1;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .ntc-detail-ph p { font-size: 0.82rem; color: #94A3B8; }

        /* Detail article */
        .ntc-article {
          max-width: 720px; margin: 0 auto;
          padding: 2.5rem 2rem 4rem;
          width: 100%;
        }

        /* Eyebrow */
        .ntc-article-eye {
          display: flex; align-items: center; gap: 0.5rem;
          margin-bottom: 0.85rem;
        }
        .ntc-article-cat-badge {
          display: inline-flex; align-items: center; gap: 0.3rem;
          padding: 0.25rem 0.65rem; border-radius: 6px;
          font-size: 0.65rem; font-weight: 700; border: 1px solid;
        }

        /* Title */
        .ntc-article-title {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: clamp(1.4rem, 3vw, 2rem);
          font-weight: 400; color: #0F172A;
          line-height: 1.25; margin-bottom: 1.25rem;
          letter-spacing: -0.01em;
        }

        /* Meta strip */
        .ntc-article-meta {
          display: flex; align-items: center; gap: 0.5rem;
          flex-wrap: wrap; padding-bottom: 1.5rem;
          border-bottom: 1px solid #E8EDF3; margin-bottom: 1.75rem;
        }
        .ntc-article-meta-item {
          display: flex; align-items: center; gap: 0.3rem;
          font-size: 0.72rem; color: #64748B;
        }
        .ntc-article-meta-sep {
          width: 3px; height: 3px; border-radius: 50%;
          background: #CBD5E1; flex-shrink: 0;
        }

        /* Priority banner */
        .ntc-priority-banner {
          display: flex; align-items: flex-start; gap: 0.65rem;
          padding: 0.85rem 1rem; border-radius: 9px; border: 1px solid;
          margin-bottom: 1.5rem;
        }
        .ntc-priority-banner-icon { flex-shrink: 0; margin-top: 1px; }
        .ntc-priority-banner-label { font-size: 0.72rem; font-weight: 700; margin-bottom: 0.1rem; }
        .ntc-priority-banner-sub   { font-size: 0.7rem; opacity: 0.75; }

        /* Body */
        .ntc-article-body {
          font-size: 0.92rem; color: #334155; line-height: 1.9;
          white-space: pre-wrap; word-break: break-word;
        }

        /* Info cards */
        .ntc-info-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 0.75rem; margin-top: 2rem;
        }
        .ntc-info-card {
          background: #fff; border: 1px solid #E8EDF3;
          border-radius: 10px; padding: 0.9rem 1rem;
        }
        .ntc-info-card-label {
          font-size: 0.6rem; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: #94A3B8; margin-bottom: 0.35rem;
        }
        .ntc-info-card-val {
          font-size: 0.82rem; font-weight: 600; color: #0F172A;
          display: flex; align-items: center; gap: 0.35rem;
        }

        /* ══════════════════ DRAWER ══════════════════ */
        .ntc-overlay {
          position: fixed; inset: 0; z-index: 200;
          display: flex; align-items: stretch;
        }
        .ntc-backdrop {
          flex: 1; background: rgba(15,23,42,0.45);
          backdrop-filter: blur(3px);
        }
        .ntc-drawer {
          width: 460px; background: #fff;
          border-left: 1px solid #E8EDF3;
          display: flex; flex-direction: column;
          height: 100%; overflow: hidden;
          animation: ntcSlideIn 0.22s cubic-bezier(0.16,1,0.3,1);
          box-shadow: -12px 0 40px rgba(15,23,42,0.12);
        }
        @keyframes ntcSlideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }

        .ntc-drawer-head {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid #F1F5F9;
          display: flex; align-items: flex-start;
          justify-content: space-between; flex-shrink: 0;
          background: #FAFAFA;
        }
        .ntc-drawer-head h2 {
          font-family: 'Instrument Serif', serif;
          font-size: 1.15rem; font-weight: 400; color: #0F172A;
        }
        .ntc-drawer-head p { font-size: 0.72rem; color: #94A3B8; margin-top: 3px; }
        .ntc-drawer-close {
          width: 30px; height: 30px; border-radius: 8px;
          border: 1px solid #E2E8F0; background: #fff;
          cursor: pointer; display: flex; align-items: center;
          justify-content: center; color: #64748B;
          transition: all 0.12s; flex-shrink: 0;
        }
        .ntc-drawer-close:hover { background: #F1F5F9; color: #0F172A; }

        .ntc-drawer-body {
          flex: 1; overflow-y: auto;
          padding: 1.5rem; display: flex; flex-direction: column; gap: 1.15rem;
        }
        .ntc-drawer-body::-webkit-scrollbar { width: 3px; }
        .ntc-drawer-body::-webkit-scrollbar-thumb { background: #E2E8F0; }

        /* Form */
        .ntc-field { display: flex; flex-direction: column; gap: 0.4rem; }
        .ntc-label {
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: #64748B;
          display: flex; align-items: center; justify-content: space-between;
        }
        .ntc-label-hint { font-weight: 500; letter-spacing: 0; text-transform: none; color: #94A3B8; }

        .ntc-input {
          background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 9px;
          padding: 0.75rem 0.9rem;
          font-family: 'Geist', sans-serif; font-size: 0.85rem; color: #0F172A;
          outline: none; transition: all 0.15s; width: 100%;
        }
        .ntc-input::placeholder { color: #CBD5E1; }
        .ntc-input:focus {
          border-color: #A5B4FC; background: #fff;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
        }
        .ntc-textarea {
          min-height: 140px; resize: vertical; line-height: 1.7;
        }
        .ntc-char-count {
          font-size: 0.62rem; color: #94A3B8; text-align: right; margin-top: 0.15rem;
        }
        .ntc-char-count.warn { color: #D97706; }
        .ntc-char-count.over { color: #DC2626; font-weight: 700; }

        .ntc-select {
          background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 9px;
          padding: 0.75rem 0.9rem;
          font-family: 'Geist', sans-serif; font-size: 0.85rem; color: #0F172A;
          outline: none; cursor: pointer; width: 100%; transition: all 0.15s;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 12px center;
          padding-right: 2rem;
        }
        .ntc-select:focus { border-color: #A5B4FC; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }

        /* Target toggle */
        .ntc-target-row { display: flex; gap: 0.5rem; }
        .ntc-target-opt {
          flex: 1; padding: 0.7rem; border-radius: 9px;
          border: 1.5px solid #E2E8F0; background: #F8FAFC;
          font-family: 'Geist', sans-serif; font-size: 0.78rem; font-weight: 600;
          color: #94A3B8; cursor: pointer; transition: all 0.12s;
          display: flex; align-items: center; justify-content: center; gap: 0.4rem;
        }
        .ntc-target-opt:hover { border-color: #CBD5E1; color: #475569; }
        .ntc-target-opt.active {
          background: #EEF2FF; border-color: #A5B4FC; color: #4F46E5;
        }

        /* Priority selector */
        .ntc-priority-row { display: flex; gap: 0.5rem; }
        .ntc-priority-opt {
          flex: 1; padding: 0.6rem 0.4rem; border-radius: 9px;
          border: 1.5px solid #E2E8F0; background: #F8FAFC;
          font-family: 'Geist', sans-serif; font-size: 0.72rem; font-weight: 600;
          cursor: pointer; transition: all 0.12s;
          display: flex; align-items: center; justify-content: center;
          gap: 0.3rem; color: #94A3B8;
        }
        .ntc-priority-opt:hover { border-color: #CBD5E1; color: #475569; }

        /* Section divider */
        .ntc-section-label {
          font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: #94A3B8;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .ntc-section-label::after {
          content: ''; flex: 1; height: 1px; background: #F1F5F9;
        }

        /* Error */
        .ntc-error {
          display: flex; align-items: flex-start; gap: 0.5rem;
          background: #FEF2F2; border: 1px solid #FECACA;
          border-radius: 9px; padding: 0.75rem 0.9rem;
          font-size: 0.78rem; color: #DC2626; line-height: 1.5;
        }

        /* Drawer footer */
        .ntc-drawer-foot {
          padding: 1rem 1.5rem; border-top: 1px solid #F1F5F9;
          flex-shrink: 0; background: #FAFAFA;
        }
        .ntc-send-btn {
          width: 100%; padding: 0.875rem; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
          color: #fff; font-family: 'Geist', sans-serif;
          font-size: 0.88rem; font-weight: 600;
          cursor: pointer; display: flex; align-items: center;
          justify-content: center; gap: 0.55rem;
          transition: all 0.15s;
          box-shadow: 0 2px 10px rgba(79,70,229,0.3);
        }
        .ntc-send-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(79,70,229,0.35); }
        .ntc-send-btn:active:not(:disabled) { transform: translateY(0); }
        .ntc-send-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ntc-send-btn.sent { background: linear-gradient(135deg, #059669 0%, #10B981 100%); box-shadow: 0 2px 10px rgba(5,150,105,0.3); }

        .ntc-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff; border-radius: 50%;
          animation: ntcSpin 0.7s linear infinite; flex-shrink: 0;
        }
        @keyframes ntcSpin { to { transform: rotate(360deg); } }

        .ntc-send-hint {
          text-align: center; font-size: 0.65rem; color: #94A3B8;
          margin-top: 0.55rem;
        }
      `}</style>

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