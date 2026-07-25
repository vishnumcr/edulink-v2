'use client';

import { useEffect, useState } from 'react';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { useAuth } from '@/context/AuthContext';

interface TodaySummary {
  attendance: {
    presentStudents: number;
    totalStudents: number;
  };

  teachers: {
    absent: number;
  };

  fees: {
    collectedToday: number;
    transactions: number;
  };

  lastUpdated: number;
}

const EMPTY: TodaySummary = {
  attendance: {
    presentStudents: 0,
    totalStudents: 0,
  },

  teachers: {
    absent: 0,
  },

  fees: {
    collectedToday: 0,
    transactions: 0,
  },

  lastUpdated: 0,
};

function formatINR(amount: number) {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

export default function DailyActivityBanner() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? '';

  const [activity, setActivity] = useState<TodaySummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;

    const db = getDatabase();

    const dbRef = ref(db, `dashboard/${schoolId}/today`);

    const unsubscribe = onValue(dbRef, (snap) => {
      if (snap.exists()) {
        const d = snap.val();

        setActivity({
          attendance: {
            presentStudents:
              d.attendance?.presentStudents ?? 0,

            totalStudents:
              d.attendance?.totalStudents ?? 0,
          },

          teachers: {
            absent:
              d.teachers?.absent ?? 0,
          },

          fees: {
            collectedToday:
              d.fees?.collectedToday ?? 0,

            transactions:
              d.fees?.transactions ?? 0,
          },

          lastUpdated:
            d.lastUpdated ?? 0,
        });
      } else {
        setActivity(EMPTY);
      }

      setLoading(false);
    });

    return () => off(dbRef, 'value', unsubscribe);
  }, [schoolId]);

  const absentStudents =
    activity.attendance.totalStudents -
    activity.attendance.presentStudents;

  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-2xl p-5 shadow-md animate-pulse h-[110px]" />
    );
  }

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-2xl p-5 text-white shadow-md">

      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200 mb-3">
        Today's Summary — {todayLabel}
      </p>

      <div className="flex flex-wrap gap-x-8 gap-y-3">

        <Stat
          value={activity.attendance.presentStudents.toLocaleString('en-IN')}
          label="Students Present"
          valueClass="text-white"
          show={activity.attendance.totalStudents > 0}
          fallback="—"
        />

        <Stat
          value={absentStudents.toLocaleString('en-IN')}
          label="Students Absent"
          valueClass="text-red-300"
          show={activity.attendance.totalStudents > 0}
          fallback="—"
        />

        <Stat
          value={String(activity.teachers.absent)}
          label="Teachers Absent"
          valueClass="text-amber-300"
          show
          fallback="0"
        />

        <Stat
          value={formatINR(activity.fees.collectedToday)}
          label="Fees Collected Today"
          valueClass="text-emerald-300"
          show
          fallback="₹0"
        />

      </div>

      {activity.attendance.totalStudents === 0 && (
        <p className="text-[11px] text-indigo-300 mt-3">
          Attendance not yet marked for today.
        </p>
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  valueClass,
  show,
  fallback,
}: {
  value: string;
  label: string;
  valueClass: string;
  show: boolean;
  fallback: string;
}) {
  return (
    <div>
      <p className={`text-2xl font-bold ${valueClass}`}>
        {show ? value : fallback}
      </p>

      <p className="text-xs text-indigo-200">
        {label}
      </p>
    </div>
  );
}