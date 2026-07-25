'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeeStatus        = 'Paid' | 'Pending' | 'Overdue';
export type AttendanceStatus = 'Present' | 'Absent';

export interface StudentRow {
  studentId  : string;
  name       : string;
  classSection: string;   // e.g. '7-B'
  rollNo     : string;
  photoUrl  ?: string;
  attendance : AttendanceStatus;
  feeStatus  : FeeStatus;
}

interface StudentsTableProps {
  students   : StudentRow[];
  onViewAll ?: () => void;
}

type SortKey = 'name' | 'classSection' | 'attendance' | 'feeStatus';
type SortDir = 'asc' | 'desc';

// ── Badge configs ─────────────────────────────────────────────────────────────

const FEE_BADGE: Record<FeeStatus, string> = {
  Paid   : 'bg-green-50 text-green-700',
  Pending: 'bg-amber-50 text-amber-700',
  Overdue: 'bg-red-50   text-red-700',
};

const ATT_BADGE: Record<AttendanceStatus, string> = {
  Present: 'bg-green-50 text-green-700',
  Absent : 'bg-red-50   text-red-700',
};

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={11} className="text-slate-300 ml-1" />;
  return sortDir === 'asc'
    ? <ChevronUp   size={11} className="text-blue-500 ml-1" />
    : <ChevronDown size={11} className="text-blue-500 ml-1" />;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('');

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

export default function StudentsTable({ students, onViewAll }: StudentsTableProps) {
  const [query,   setQuery  ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [feeFilter, setFeeFilter] = useState<FeeStatus | 'All'>('All');
  const [attFilter, setAttFilter] = useState<AttendanceStatus | 'All'>('All');

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    let list = [...students];

    // Text search
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.classSection.toLowerCase().includes(q) ||
        s.rollNo.toLowerCase().includes(q)
      );
    }

    // Fee filter
    if (feeFilter !== 'All') list = list.filter(s => s.feeStatus === feeFilter);

    // Attendance filter
    if (attFilter !== 'All') list = list.filter(s => s.attendance === attFilter);

    // Sort
    list.sort((a, b) => {
      const av = a[sortKey] as string;
      const bv = b[sortKey] as string;
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return list;
  }, [students, query, sortKey, sortDir, feeFilter, attFilter]);

  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('asc'); }
  };

  const th = 'text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-4 py-2.5 text-left select-none cursor-pointer hover:text-slate-600 transition-colors';
  const td = 'px-4 py-2.5 text-[12px] text-slate-600';

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
        <span className="text-[13px] font-semibold text-slate-900 flex-1 min-w-0">
          Students
          <span className="ml-2 text-[11px] text-slate-400 font-normal">
            {rows.length} of {students.length}
          </span>
        </span>

        {/* Search */}
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-2.5 py-1.5 w-44">
          <Search size={11} className="text-slate-400 flex-shrink-0" strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Name, class, roll…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="bg-transparent text-[11px] text-slate-700 placeholder-slate-400 outline-none w-full"
          />
        </div>

        {/* Fee filter */}
        <select
          value={feeFilter}
          onChange={e => setFeeFilter(e.target.value as FeeStatus | 'All')}
          className="text-[11px] text-slate-600 bg-slate-100 border-none rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
        >
          <option value="All">All fees</option>
          <option value="Paid">Paid</option>
          <option value="Pending">Pending</option>
          <option value="Overdue">Overdue</option>
        </select>

        {/* Attendance filter */}
        <select
          value={attFilter}
          onChange={e => setAttFilter(e.target.value as AttendanceStatus | 'All')}
          className="text-[11px] text-slate-600 bg-slate-100 border-none rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
        >
          <option value="All">All attendance</option>
          <option value="Present">Present</option>
          <option value="Absent">Absent</option>
        </select>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-[11px] text-blue-600 font-medium hover:underline"
          >
            View all
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className={th} onClick={() => toggleSort('name')}>
                <span className="flex items-center">
                  Student <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={th} onClick={() => toggleSort('classSection')}>
                <span className="flex items-center">
                  Class <SortIcon col="classSection" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={`${th} hidden sm:table-cell`}>Roll</th>
              <th className={th} onClick={() => toggleSort('attendance')}>
                <span className="flex items-center">
                  Today <SortIcon col="attendance" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={th} onClick={() => toggleSort('feeStatus')}>
                <span className="flex items-center">
                  Fee <SortIcon col="feeStatus" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={`${th} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[12px] text-slate-400 py-10">
                  No students match your filters.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.studentId} className="hover:bg-slate-50/60 transition-colors">

                  {/* Name + avatar */}
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.name} photoUrl={s.photoUrl} />
                      <span className="font-medium text-slate-800 truncate max-w-[120px]">
                        {s.name}
                      </span>
                    </div>
                  </td>

                  {/* Class */}
                  <td className={td}>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[11px] font-medium">
                      {s.classSection}
                    </span>
                  </td>

                  {/* Roll */}
                  <td className={`${td} hidden sm:table-cell text-slate-400`}>
                    #{s.rollNo}
                  </td>

                  {/* Attendance */}
                  <td className={td}>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ATT_BADGE[s.attendance]}`}>
                      {s.attendance}
                    </span>
                  </td>

                  {/* Fee status */}
                  <td className={td}>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${FEE_BADGE[s.feeStatus]}`}>
                      {s.feeStatus}
                    </span>
                  </td>

                  {/* Action */}
                  <td className={`${td} text-right`}>
                    <Link
                      href={`/students/${s.studentId}`}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                    >
                      View <ExternalLink size={10} />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {rows.length > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            Showing {rows.length} student{rows.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              <span className="text-slate-500">
                {rows.filter(s => s.attendance === 'Present').length} present
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
              <span className="text-slate-500">
                {rows.filter(s => s.feeStatus === 'Overdue').length} overdue
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}