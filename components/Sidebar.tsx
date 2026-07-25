'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CreditCard,
  BookOpen,
  Clock,
  BarChart2,
  Bell,
  Settings,
  LogOut,
  ClipboardList,
  X,
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

interface SchoolMeta {
  name: string;
  logoUrl: string;
}

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV: NavSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Overview',   href: '/',           icon: LayoutDashboard },
      { label: 'Students',   href: '/students',   icon: Users,          badge: '1.2k' },
      { label: 'Admission',  href: '/admission',  icon: ClipboardList   },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Fee Records', href: '/fees', icon: CreditCard },
      { label: 'Collect Fee', href: '/feecollection', icon: CreditCard },

    ],
  },
  {
    title: 'Academic',
    items: [
      { label: 'Attendance',       href: '/attendance', icon: Clock        },
      { label: 'Results',          href: '/results',    icon: BarChart2    },
      { label: 'Notices',          href: '/notices',    icon: Bell         },
    ],
  },
  {
    title: 'STAFF',
    items: [
      { label: 'Teachers',       href: '/teachers', icon: GraduationCap },
      { label: 'Non-Teaching',    href: '/maintenance', icon: Settings     },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reads schoolId from sessionStorage (set during login).
 * Falls back to the cookie/token approach if you switch to server auth later.
 */
function getSchoolId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('sms_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.schoolId ?? null;
  } catch {
    return null;
  }
}

function getAdminName(): string {
  if (typeof window === 'undefined') return 'Administrator';
  try {
    const raw = sessionStorage.getItem('sms_user');
    if (!raw) return 'Administrator';
    const user = JSON.parse(raw);
    return user?.name ?? user?.email ?? 'Administrator';
  } catch {
    return 'Administrator';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();

  const [mounted,    setMounted   ] = useState(false);
  const [school,     setSchool    ] = useState<SchoolMeta | null>(null);
  const [schoolLoad, setSchoolLoad] = useState(true);

  // ── Hydration fix ──────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Fetch school meta (1 read, session-cached) ─────────────────────────────
  // We cache in sessionStorage so navigating between pages costs 0 reads.
  // Only the very first sidebar mount after login hits Firestore.
  useEffect(() => {
    if (!mounted) return;

    // Check session cache first
    const cached = sessionStorage.getItem('sms_school_meta');
    if (cached) {
      try {
        setSchool(JSON.parse(cached));
        setSchoolLoad(false);
        return;
      } catch {
        // corrupted cache — fall through to fetch
      }
    }

    const schoolId = getSchoolId();
    if (!schoolId) {
      setSchoolLoad(false);
      return;
    }

    // 1 Firestore read — only name + logoUrl needed, no sub-collections
    getDoc(doc(db, 'schools', schoolId))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const meta: SchoolMeta = {
          name   : data.name    ?? 'School',
          logoUrl: data.logoUrl ?? '',
        };
        setSchool(meta);
        // Cache for the rest of the session
        sessionStorage.setItem('sms_school_meta', JSON.stringify(meta));
      })
      .catch(console.error)
      .finally(() => setSchoolLoad(false));
  }, [mounted]);

  // ── Active route ───────────────────────────────────────────────────────────
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const currentPath = mounted ? pathname : '';

  // ── Sign out ───────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    sessionStorage.removeItem('sms_user');
    sessionStorage.removeItem('sms_school_meta'); // clear school cache too
    document.cookie = '__session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    router.replace('/login');
  };

  // ── Initials fallback ──────────────────────────────────────────────────────
  const initials = school?.name
    ? school.name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : 'S';

  const adminName    = mounted ? getAdminName() : 'Administrator';
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

      <aside className={`fixed inset-y-0 left-0 z-50 w-[260px] bg-[#0B1F3A] flex flex-col flex-shrink-0 shadow-2xl shadow-slate-950/30 transition-transform duration-200 md:relative md:inset-auto md:z-40 md:w-[220px] md:h-screen md:translate-x-0 md:shadow-none ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}>

      {/* ── School identity ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/[0.08]">

        {/* Logo or initials avatar */}
        <div className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden ring-1 ring-white/15">
          {schoolLoad ? (
            // Skeleton while loading
            <div className="w-full h-full bg-white/[0.06] animate-pulse rounded-lg" />
          ) : school?.logoUrl ? (
            <img
              src={school.logoUrl}
              alt={school.name}
              className="w-full h-full object-cover"
            />
          ) : (
            // Initials fallback — brand navy/gold tint
            <div className="w-full h-full bg-white/10 flex items-center justify-center text-white text-[11px] font-semibold">
              {initials}
            </div>
          )}
        </div>

        {/* School name + role label */}
        <div className="min-w-0 flex-1">
          {schoolLoad ? (
            <div className="space-y-1.5">
              <div className="h-2.5 w-24 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-2 w-16 bg-white/[0.04] rounded animate-pulse" />
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
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.08] hover:text-white md:hidden"
          aria-label="Close menu"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        {NAV.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1.5">
              {section.title}
            </p>

            {section.items.map((item) => {
              const active = mounted && isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`
                    flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 text-[13px] font-medium
                    transition-all duration-150
                    ${active
                      ? 'bg-white/10 text-white ring-1 ring-white/10'
                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                    }
                  `}
                >
                  <item.icon
                    size={15}
                    className={active ? 'text-emerald-400' : 'text-slate-500'}
                    strokeWidth={2}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium
                        ${active ? 'bg-white/15 text-white' : 'bg-white/[0.06] text-slate-400'}
                      `}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.08] p-2.5">
        <Link
          href="/config/general"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white transition-all text-[13px] font-medium mb-0.5"
        >
          <Settings size={15} strokeWidth={2} />
          Configuration
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all text-[13px] font-medium"
        >
          <LogOut size={15} strokeWidth={2} />
          Sign out
        </button>

        {/* Admin identity */}
        <div className="flex items-center gap-2.5 px-2.5 pt-3 mt-2 border-t border-white/[0.08]">
          <div className="w-6.5 h-6.5 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
            {adminInitial}
          </div>
          <span className="text-slate-300 text-[12px] truncate">{adminName}</span>
        </div>
      </div>
      </aside>
    </>
  );
}