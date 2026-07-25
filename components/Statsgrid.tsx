import { Users, GraduationCap, IndianRupee, Clock, LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendDirection = 'up' | 'down' | 'neutral';

interface StatCardData {
  title      : string;
  value      : string;
  icon       : LucideIcon;
  accent     : 'blue' | 'green' | 'amber' | 'red';
  trend?     : string;
  trendDir?  : TrendDirection;
}

interface StatsGridProps {
  totalStudents  : number;
  totalTeachers  : number;
  feeCollection  : string;   // e.g. "₹8.4L"
  feePercent     : number;   // 0–100
  avgAttendance  : number;   // 0–100
  attendanceDelta: number;   // signed int, e.g. -2 or +3
  /**
   * Optional on purpose — there is no teacher attendance/leave
   * tracking anywhere in this codebase (see the dashboard page's own
   * header comment on why Teacher Insights was removed rather than
   * left wired to fake data). When omitted, the Teachers card shows
   * no trend line at all rather than falsely claiming "All present."
   */
  teachersOnLeave?: number;
  newStudentsMonth: number;
}

// ── Accent config ─────────────────────────────────────────────────────────────

const ACCENT = {
  blue : { bg: 'bg-blue-50',   icon: 'text-blue-600',  bar: 'bg-blue-600'  },
  green: { bg: 'bg-green-50',  icon: 'text-green-600', bar: 'bg-green-600' },
  amber: { bg: 'bg-amber-50',  icon: 'text-amber-600', bar: 'bg-amber-500' },
  red  : { bg: 'bg-red-50',    icon: 'text-red-600',   bar: 'bg-red-500'   },
};

const TREND_CONFIG = {
  up     : { icon: TrendingUp,   color: 'text-green-600' },
  down   : { icon: TrendingDown, color: 'text-red-500'   },
  neutral: { icon: Minus,        color: 'text-slate-400' },
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ title, value, icon: Icon, accent, trend, trendDir = 'neutral' }: StatCardData) {
  const a = ACCENT[accent];
  const t = TREND_CONFIG[trendDir];
  const TrendIcon = t.icon;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 relative overflow-hidden">

      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-0.75 ${a.bar}`} />

      {/* Icon + trend */}
      <div className="flex items-start justify-between mb-3 mt-1">
        <div className={`w-9 h-9 rounded-lg ${a.bg} flex items-center justify-center`}>
          <Icon size={18} className={a.icon} strokeWidth={2} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-[11px] font-medium ${t.color}`}>
            <TrendIcon size={11} strokeWidth={2.5} />
            {trend}
          </div>
        )}
      </div>

      {/* Value + label */}
      <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">
        {title}
      </p>
      <p className="text-[22px] font-bold text-slate-900 leading-none">
        {value}
      </p>
    </div>
  );
}

// ── Stats grid ────────────────────────────────────────────────────────────────

export default function StatsGrid({
  totalStudents,
  totalTeachers,
  feeCollection,
  feePercent,
  avgAttendance,
  attendanceDelta,
  teachersOnLeave,
  newStudentsMonth,
}: StatsGridProps) {

  const attendanceTrendDir: TrendDirection =
    attendanceDelta > 0 ? 'up' : attendanceDelta < 0 ? 'down' : 'neutral';

  const stats: StatCardData[] = [
    {
      title   : 'Total Students',
      value   : totalStudents.toLocaleString('en-IN'),
      icon    : Users,
      accent  : 'blue',
      trend   : newStudentsMonth > 0 ? `+${newStudentsMonth} this month` : undefined,
      trendDir: newStudentsMonth > 0 ? 'up' : 'neutral',
    },
    {
      title   : 'Teachers',
      value   : totalTeachers.toString(),
      icon    : GraduationCap,
      accent  : 'green',
      trend   : teachersOnLeave === undefined ? undefined
        : teachersOnLeave > 0 ? `${teachersOnLeave} on leave` : 'All present',
      trendDir: teachersOnLeave !== undefined && teachersOnLeave > 0 ? 'neutral' : 'up',
    },
    {
      title   : 'Fee Collection',
      value   : feeCollection,
      icon    : IndianRupee,
      accent  : 'amber',
      trend   : `${feePercent}% of target`,
      trendDir: feePercent >= 80 ? 'up' : feePercent >= 50 ? 'neutral' : 'down',
    },
    {
      title   : 'Avg. Attendance',
      value   : `${avgAttendance}%`,
      icon    : Clock,
      accent  : 'red',
      trend   : attendanceDelta !== 0
        ? `${attendanceDelta > 0 ? '+' : ''}${attendanceDelta}% from yesterday`
        : 'No change',
      trendDir: attendanceTrendDir,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <StatCard key={s.title} {...s} />
      ))}
    </div>
  );
}