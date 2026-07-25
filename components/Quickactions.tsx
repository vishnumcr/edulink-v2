'use client';

import { useRouter } from 'next/navigation';
import {
  UserPlus,
  FileText,
  Calendar,
  ClipboardCheck,
  Bell,
  BarChart2,
  BookOpen,
  IndianRupee,
  LucideIcon,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Action {
  label      : string;
  description: string;
  icon       : LucideIcon;
  accent     : string;       // Tailwind bg colour for icon pill
  iconColor  : string;       // Tailwind text colour for icon
  href      ?: string;       // navigate on click
  onClick   ?: () => void;   // custom handler (takes priority over href)
}

// ── Action config ─────────────────────────────────────────────────────────────

const ACTIONS: Action[] = [
  {
    label      : 'Add Student',
    description: 'Enroll a new student',
    icon       : UserPlus,
    accent     : 'bg-blue-50',
    iconColor  : 'text-blue-600',
    href       : '/students/new',
  },
  {
    label      : 'Fee Report',
    description: 'Generate collection report',
    icon       : IndianRupee,
    accent     : 'bg-amber-50',
    iconColor  : 'text-amber-600',
    href       : '/fees/report',
  },
  {
    label      : 'Timetable',
    description: 'Update class schedules',
    icon       : Calendar,
    accent     : 'bg-violet-50',
    iconColor  : 'text-violet-600',
    href       : '/timetable',
  },
  {
    label      : 'Attendance',
    description: 'Mark today\'s attendance',
    icon       : ClipboardCheck,
    accent     : 'bg-green-50',
    iconColor  : 'text-green-600',
    href       : '/attendance/mark',
  },
  {
    label      : 'Post Notice',
    description: 'Announce to all parents',
    icon       : Bell,
    accent     : 'bg-red-50',
    iconColor  : 'text-red-500',
    href       : '/notices/new',
  },
  {
    label      : 'Results',
    description: 'Upload exam results',
    icon       : BarChart2,
    accent     : 'bg-sky-50',
    iconColor  : 'text-sky-600',
    href       : '/results/upload',
  },
  {
    label      : 'Homework',
    description: 'Assign new homework',
    icon       : BookOpen,
    accent     : 'bg-orange-50',
    iconColor  : 'text-orange-500',
    href       : '/homework/new',
  },
  {
    label      : 'Fee Report',
    description: 'Export as PDF',
    icon       : FileText,
    accent     : 'bg-slate-100',
    iconColor  : 'text-slate-600',
    href       : '/fees/export',
  },
];

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({ action, onClick }: { action: Action; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-left group"
    >
      {/* Icon pill */}
      <div className={`w-8 h-8 rounded-lg ${action.accent} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105`}>
        <action.icon size={15} className={action.iconColor} strokeWidth={2} />
      </div>

      {/* Text */}
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-800 leading-tight truncate">
          {action.label}
        </p>
        <p className="text-[10px] text-slate-400 leading-tight truncate">
          {action.description}
        </p>
      </div>
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface QuickActionsProps {
  /** Override default actions entirely */
  actions?: Action[];
  /** Called when any action without a custom onClick is triggered */
  onAction?: (label: string) => void;
}

export default function QuickActions({ actions = ACTIONS, onAction }: QuickActionsProps) {
  const router = useRouter();

  const handleClick = (action: Action) => {
    if (action.onClick) {
      action.onClick();
      return;
    }
    if (action.href) {
      router.push(action.href);
      return;
    }
    onAction?.(action.label);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-full">

      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-100">
        <span className="text-[13px] font-semibold text-slate-900">Quick Actions</span>
      </div>

      {/* Action list */}
      <div className="p-2 flex flex-col">
        {actions.map((action) => (
          <ActionCard
            key={action.label + action.description}
            action={action}
            onClick={() => handleClick(action)}
          />
        ))}
      </div>
    </div>
  );
}