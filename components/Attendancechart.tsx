'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DayAttendance {
  day    : string;   // 'Mon', 'Tue' …
  present: number;   // 0–100 percentage
  absent : number;   // 0–100 percentage
}

interface AttendanceChartProps {
  data       : DayAttendance[];
  weekAverage: number;          // 0–100
  prevWeekAvg: number;          // 0–100, for delta calculation
  classes    : string[];        // ['All', '6-A', '6-B', …]
  onClassChange?: (cls: string) => void;
}

// ── Bar ───────────────────────────────────────────────────────────────────────

function Bar({
  day, present, absent, isToday, maxHeight = 110,
}: DayAttendance & { isToday: boolean; maxHeight?: number }) {
  const [hovered, setHovered] = useState(false);
  const presentH = (present / 100) * maxHeight;
  const absentH  = (absent  / 100) * maxHeight;

  return (
    <div className="flex-1 flex flex-col items-center gap-1.5">

      {/* Tooltip */}
      {hovered && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] rounded-lg px-2.5 py-1.5 whitespace-nowrap z-10 pointer-events-none shadow-lg">
          <span className="text-green-400 font-semibold">{present}%</span>
          <span className="text-slate-400 mx-1">·</span>
          <span className="text-red-400">{absent}% absent</span>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
        </div>
      )}

      {/* Value label */}
      <span className={`text-[10px] font-semibold ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>
        {present}%
      </span>

      {/* Bar stack */}
      <div
        className="w-full relative flex flex-col justify-end rounded-t-md overflow-hidden cursor-pointer"
        style={{ height: maxHeight }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-slate-100 rounded-md" />

        {/* Absent (stacked on top, small sliver) */}
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-500"
          style={{
            height: presentH + absentH,
            background: isToday ? '#fca5a5' : '#e2e8f0',
            borderRadius: '6px 6px 0 0',
          }}
        />

        {/* Present */}
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-500"
          style={{
            height: presentH,
            background: isToday
              ? 'linear-gradient(to top, #1d4ed8, #3b82f6)'
              : 'linear-gradient(to top, #93c5fd, #bfdbfe)',
            borderRadius: '6px 6px 0 0',
          }}
        />
      </div>

      {/* Day label */}
      <span
        className={`text-[11px] font-medium ${
          isToday ? 'text-blue-600 font-semibold' : 'text-slate-400'
        }`}
      >
        {day}
      </span>
      {isToday && (
        <div className="w-1 h-1 rounded-full bg-blue-600" />
      )}
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

export default function AttendanceChart({
  data,
  weekAverage,
  prevWeekAvg,
  classes,
  onClassChange,
}: AttendanceChartProps) {
  const [selectedClass, setSelectedClass] = useState(classes[0] ?? 'All');

  const delta    = weekAverage - prevWeekAvg;
  const deltaAbs = Math.abs(delta);
  const isUp     = delta >= 0;

  const handleClassChange = (cls: string) => {
    setSelectedClass(cls);
    onClassChange?.(cls);
  };

  // Today = last entry in data (index = data.length - 1)
  const todayIndex = data.length - 1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-slate-900">Attendance</span>
          <div className={`flex items-center gap-1 text-[11px] font-medium ${isUp ? 'text-green-600' : 'text-red-500'}`}>
            {isUp
              ? <TrendingUp size={12} strokeWidth={2.5} />
              : <TrendingDown size={12} strokeWidth={2.5} />
            }
            {isUp ? '+' : '-'}{deltaAbs}% vs last week
          </div>
        </div>

        {/* Class filter pills */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          {classes.map((cls) => (
            <button
              key={cls}
              onClick={() => handleClassChange(cls)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                selectedClass === cls
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      <div className="px-5 pt-8 pb-4">

        {/* Week average pill */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[11px] text-slate-400 font-medium">Week average</p>
            <p className="text-[26px] font-bold text-slate-900 leading-tight">{weekAverage}%</p>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              Present
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-200" />
              Absent
            </div>
          </div>
        </div>

        {/* Bars */}
        <div className="relative flex items-end gap-2">
          {data.map((d, i) => (
            <Bar
              key={d.day}
              {...d}
              isToday={i === todayIndex}
              maxHeight={110}
            />
          ))}
        </div>
      </div>
    </div>
  );
}