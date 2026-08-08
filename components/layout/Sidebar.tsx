/**
 * --------------------------------------------------------------------
 * File:
 * components/layout/Sidebar.tsx
 *
 * Changes from the original edulink prototype:
 * - schoolId / admin name now come from AuthContext's `profile`
 *   instead of sessionStorage("sms_user"), which doesn't exist in v2.
 * - School branding (name/logo) is loaded via useSchoolMeta(), which
 *   goes through schoolService → schoolRepository instead of calling
 *   Firestore directly from this component.
 * - Sign-out goes through AuthContext's logout() (→ authService →
 *   authRepository → Firebase), instead of manually clearing
 *   sessionStorage/cookies. The dashboard layout's own guard effect
 *   handles the redirect to /login once the auth state updates, so
 *   this component doesn't navigate on its own.
 * --------------------------------------------------------------------
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSchoolMeta } from '@/hooks/useSchoolMeta';
import { useSetupStatus } from '@/context/SetupStatusContext';
import { MODULE_REQUIREMENTS } from '@/constants/moduleAccess';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CreditCard,
  Clock,
  CalendarClock,
  BarChart2,
  Bell,
  Settings,
  LogOut,
  ClipboardList,
  Lock,
  Sparkles,
  Receipt,
  X,
  CalendarRange
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// ── Nav config ────────────────────────────────────────────────────────────────
// Routes that don't exist in v2 yet (Admission, Results, Notices,
// Non-Teaching) are left in place per the current decision to keep the
// full nav — they'll 404 until those features are built.

const NAV: NavSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Overview',   href: '/dashboard', icon: LayoutDashboard },
      { label: 'Students',   href: '/students',  icon: Users,          badge: '1.2k' },
      { label: 'Admission',  href: '/admission',  icon: ClipboardList  },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Fee Records',     href: '/finance',          icon: CreditCard },
      { label: 'Collect Fee',     href: '/finance/collect',  icon: CreditCard },
      { label: 'Payment History', href: '/finance/payments', icon: Receipt    },
    ],
  },
  {
    title: 'Academic',
    items: [
      { label: 'Timetable',  href: '/timetable',  icon: CalendarClock },
      { label: 'Attendance', href: '/attendance', icon: Clock     },
      { label: 'Results',    href: '/results',    icon: BarChart2 },
      { label: 'Notices',    href: '/notices',    icon: Bell      },
      { label: "Calendar",   href: "/calendar",  icon: CalendarRange },

    ],
  },
  {
    title: 'STAFF',
    items: [
      { label: 'Teachers',     href: '/teachers',    icon: GraduationCap },
      { label: 'Non-Teaching', href: '/maintenance', icon: Settings      },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, logout } = useAuth();
  const { school, loading: schoolLoad } = useSchoolMeta(profile?.schoolId);
  const { status } = useSetupStatus();

  const [signingOut, setSigningOut] = useState(false);
  const [hoveredLockedHref, setHoveredLockedHref] = useState<string | null>(null);

  // Exact match — prefix matching would highlight both "Fee Records"
  // and "Collect Fee" simultaneously, since /finance/collect also
  // starts with /finance.
  const isActive = (href: string) => pathname === href;

  // A module is locked only while setup status is known and at least
  // one of its required steps (see constants/moduleAccess.ts) is
  // incomplete. Before status loads, nothing is locked — an item
  // flickering into a locked state after a brief delay reads worse
  // than a half-second where everything looks unlocked.
  function missingSteps(href: string) {
    const requiredIds = MODULE_REQUIREMENTS[href];
    if (!requiredIds || !status) return [];
    return status.steps.filter((s) => requiredIds.includes(s.id) && !s.complete);
  }

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      // No manual redirect here — (dashboard)/layout.tsx's guard effect
      // redirects to /login as soon as AuthContext reports no user.
    } catch (error) {
      console.error('Sign out failed:', error);
      setSigningOut(false);
    }
  };

  const initials = school?.name
    ? school.name
        .split(' ')
        .slice(0, 2)
        .map((w: string) => w[0])
        .join('')
        .toUpperCase()
    : 'S';

  const adminName    = profile?.name || profile?.email || 'Administrator';
  const adminInitial = adminName[0]?.toUpperCase() ?? 'A';

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/45 transition-opacity md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside className={`fixed inset-y-0 left-0 z-50 w-65 bg-[#0B1F3A] flex flex-col shrink-0 shadow-2xl shadow-slate-950/30 transition-transform duration-200 md:relative md:inset-auto md:z-40 md:w-55 md:h-screen md:translate-x-0 md:shadow-none ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}>

      {/* ── School identity ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/8">

        <div className="w-9 h-9 rounded-lg shrink-0 overflow-hidden ring-1 ring-white/15">
          {schoolLoad ? (
            <div className="w-full h-full bg-white/6 animate-pulse rounded-lg" />
          ) : school?.logoUrl ? (
            <img
              src={school.logoUrl}
              alt={school.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-white/10 flex items-center justify-center text-white text-[11px] font-semibold">
              {initials}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {schoolLoad ? (
            <div className="space-y-1.5">
              <div className="h-2.5 w-24 bg-white/6 rounded animate-pulse" />
              <div className="h-2 w-16 bg-white/4 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-white text-[13px] font-semibold leading-tight tracking-tight truncate">
                {school?.name ?? 'School'}
              </p>
              <p className="text-slate-400 text-[10px] leading-tight mt-0.5 uppercase tracking-wider">Admin Portal</p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-white md:hidden"
          aria-label="Close menu"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        {status && !status.complete && (
          <Link
            href="/setup"
            onClick={onClose}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-3 text-[13px] font-medium border transition-all duration-150 ${
              isActive('/setup')
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Sparkles size={15} className="text-emerald-400" strokeWidth={2} />
            <span className="flex-1 truncate">Setup Center</span>
          </Link>
        )}

        {NAV.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1.5">
              {section.title}
            </p>

            {section.items.map((item) => {
              const active = isActive(item.href);
              const missing = missingSteps(item.href);
              const locked = missing.length > 0;

              return (
                <div
                  key={`${item.href}-${item.label}`}
                  className="relative"
                  onMouseEnter={() => locked && setHoveredLockedHref(item.href)}
                  onMouseLeave={() => setHoveredLockedHref(null)}
                >
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 text-[13px] font-medium
                      transition-all duration-150
                      ${active
                        ? 'bg-white/10 text-white ring-1 ring-white/10'
                        : locked
                        ? 'text-slate-500 hover:bg-white/6 hover:text-slate-300'
                        : 'text-slate-400 hover:bg-white/6 hover:text-white'
                      }
                    `}
                  >
                    <item.icon
                      size={15}
                      className={active ? 'text-emerald-400' : locked ? 'text-slate-600' : 'text-slate-500'}
                      strokeWidth={2}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {locked ? (
                      <Lock size={12} className="shrink-0 text-slate-600" />
                    ) : (
                      item.badge && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium
                            ${active ? 'bg-white/15 text-white' : 'bg-white/6 text-slate-400'}
                          `}
                        >
                          {item.badge}
                        </span>
                      )
                    )}
                  </Link>

                  {locked && hoveredLockedHref === item.href && (
                    <div className="absolute left-full top-0 z-50 ml-2 w-56 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
                      <p className="mb-2 text-[11px] font-semibold text-slate-500">
                        Complete to unlock:
                      </p>
                      <ul className="space-y-1">
                        {missing.map((step) => (
                          <li key={step.id} className="flex items-center gap-1.5 text-[12px] text-slate-700">
                            <span className="text-red-400">✕</span> {step.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-white/8 p-2.5">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-400 hover:bg-white/6 hover:text-white transition-all text-[13px] font-medium mb-0.5"
        >
          <Settings size={15} strokeWidth={2} />
          Configuration
        </Link>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all text-[13px] font-medium disabled:opacity-50"
        >
          <LogOut size={15} strokeWidth={2} />
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>

        <div className="flex items-center gap-2.5 px-2.5 pt-3 mt-2 border-t border-white/8">
          <div className="w-6.5 h-6.5 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
            {adminInitial}
          </div>
          <span className="text-slate-300 text-[12px] truncate">{adminName}</span>
        </div>
      </div>
      </aside>
    </>
  );
}