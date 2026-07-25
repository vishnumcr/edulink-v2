/**
 * --------------------------------------------------------------------
 * File:
 * components/layout/Topbar.tsx
 *
 * Changes from the original edulink prototype:
 * - PAGE_META keys updated to match v2 routes ('/dashboard' instead
 *   of '/', added '/finance'). No Firebase/Firestore calls in this
 *   component either way, so no other rewiring was needed.
 * --------------------------------------------------------------------
 */

'use client';

import { usePathname } from 'next/navigation';
import { Bell, Menu, Plus, Search } from 'lucide-react';
import Link from 'next/link';

// ── Page title map ────────────────────────────────────────────────────────────

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/dashboard':  { title: 'Dashboard Overview',  subtitle: 'Welcome back, Administrator.'         },
  '/students':   { title: 'Students',            subtitle: 'Manage student records and profiles.' },
  '/teachers':   { title: 'Teachers',            subtitle: 'Staff directory and assignments.'     },
  '/finance':    { title: 'Finance',             subtitle: 'Fee records and collections.'         },
  '/attendance': { title: 'Attendance',          subtitle: 'Daily and monthly attendance data.'   },
  '/results':    { title: 'Exam Results',        subtitle: 'Performance records and reports.'     },
  '/notices':    { title: 'Notices',             subtitle: 'School-wide announcements.'           },
  '/settings':   { title: 'Settings',            subtitle: 'Account and system preferences.'      },
};

const DEFAULT_META = { title: 'EduLink Admin', subtitle: '' };

// ── Topbar ────────────────────────────────────────────────────────────────────

interface TopbarProps {
  onMenuClick?: () => void;
}

export default function Topbar({ onMenuClick }: TopbarProps) {
  const pathname = usePathname();

  const meta =
    PAGE_META[pathname] ??
    Object.entries(PAGE_META).find(([key]) => pathname.startsWith(key))?.[1] ??
    DEFAULT_META;

  return (
    <header className="sticky top-0 z-30 min-h-[56px] bg-white border-b border-slate-200 flex items-center px-3 py-2 gap-2 flex-shrink-0 sm:px-4 md:h-[56px] md:px-6 md:py-0 md:gap-4">

      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors md:hidden"
        aria-label="Open menu"
      >
        <Menu size={16} strokeWidth={2.4} />
      </button>

      <div className="flex-1 min-w-0">
        <h1 className="text-[15px] font-semibold text-slate-900 leading-tight truncate">
          {meta.title}
        </h1>
        {meta.subtitle && (
          <p className="text-[12px] text-slate-500 leading-tight truncate">{meta.subtitle}</p>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-2 bg-slate-100 hover:bg-slate-200 transition-colors rounded-lg px-3 py-1.5 w-44 cursor-text">
        <Search size={13} className="text-slate-400 flex-shrink-0" strokeWidth={2.25} />
        <span className="text-[12px] text-slate-400 select-none">Search...</span>
      </div>

      <Link
        href="/notices"
        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors text-[12.5px] font-medium"
      >
        <Plus size={13} strokeWidth={2.5} />
        Post Notice
      </Link>

      <Link
        href="/students"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0B1F3A] hover:bg-[#0F2A4A] transition-colors text-white text-[12.5px] font-medium shadow-sm sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5"
        aria-label="Add Student"
      >
        <Plus size={13} strokeWidth={2.5} />
        <span className="hidden sm:inline">Add Student</span>
      </Link>

      <NotificationBell />

    </header>
  );
}

// ── Notification bell ─────────────────────────────────────────────────────────

function NotificationBell() {
  // TODO: replace hardcoded count with real unread notices from RTDB
  const unreadCount = 3;

  return (
    <button
      className="relative w-8 h-8 bg-slate-100 hover:bg-slate-200 transition-colors rounded-lg flex items-center justify-center"
      aria-label="Notifications"
    >
      <Bell size={15} className="text-slate-500" strokeWidth={2} />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 w-[7px] h-[7px] bg-red-500 rounded-full border-[1.5px] border-white" />
      )}
    </button>
  );
}
