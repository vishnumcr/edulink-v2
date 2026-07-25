'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeeDonutProps {
  collected : number;   // amount in rupees
  partial   : number;   // partial payments
  pending   : number;   // fully unpaid
  target    : number;   // total expected
  dueDate  ?: string;   // e.g. "30 Apr 2025"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format rupee amounts: ₹8,40,000 → ₹8.4L, ₹1,20,00,000 → ₹1.2Cr */
function formatRupee(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000)    return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000)      return `₹${(amount / 1_000).toFixed(1)}k`;
  return `₹${amount}`;
}

/** Convert a value to SVG arc stroke-dasharray/dashoffset on a circle of given circumference */
function arcProps(value: number, total: number, circumference: number, offset: number) {
  const fraction = total > 0 ? value / total : 0;
  const dash     = fraction * circumference;
  const gap      = circumference - dash;
  return {
    strokeDasharray : `${dash.toFixed(2)} ${gap.toFixed(2)}`,
    strokeDashoffset: (-offset).toFixed(2),
  };
}

// ── Donut segments ────────────────────────────────────────────────────────────

const SEGMENTS = [
  { key: 'collected', color: '#2563eb', label: 'Collected' },
  { key: 'partial',   color: '#16a34a', label: 'Partial'   },
  { key: 'pending',   color: '#e2e8f0', label: 'Pending'   },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function FeeDonut({
  collected,
  partial,
  pending,
  target,
  dueDate,
}: FeeDonutProps) {
  const R             = 34;
  const circumference = 2 * Math.PI * R;   // ≈ 213.6
  const collectedPct  = target > 0 ? Math.round((collected / target) * 100) : 0;
  const progressPct   = target > 0 ? Math.round(((collected + partial) / target) * 100) : 0;

  const trendDir = collectedPct >= 80 ? 'up' : collectedPct >= 50 ? 'neutral' : 'down';
  const TrendIcon = trendDir === 'up' ? TrendingUp : trendDir === 'down' ? TrendingDown : Minus;
  const trendColor = trendDir === 'up' ? 'text-green-600' : trendDir === 'down' ? 'text-red-500' : 'text-slate-400';

  // Pre-compute arcs. Each starts where the previous ended.
  const arcs = useMemo(() => {
    const values = { collected, partial, pending };
    let offset = 0;
    return SEGMENTS.map(({ key, color, label }) => {
      const props = arcProps(values[key], target, circumference, offset);
      offset += (values[key] / target) * circumference;
      return { key, color, label, value: values[key], ...props };
    });
  }, [collected, partial, pending, target, circumference]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <span className="text-[13px] font-semibold text-slate-900">Fee Collection</span>
        <span className="text-[11px] text-slate-400">
          {dueDate ? `Due ${dueDate}` : 'Current term'}
        </span>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">

        {/* Donut + legend row */}
        <div className="flex items-center gap-5">

          {/* SVG Donut */}
          <div className="relative flex-shrink-0">
            <svg width="90" height="90" viewBox="0 0 90 90">
              {/* Track */}
              <circle
                cx="45" cy="45" r={R}
                fill="none"
                stroke="#f1f5f9"
                strokeWidth="10"
              />
              {/* Segments */}
              {arcs.map((arc) => (
                <circle
                  key={arc.key}
                  cx="45" cy="45" r={R}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="10"
                  strokeDasharray={arc.strokeDasharray}
                  strokeDashoffset={arc.strokeDashoffset}
                  strokeLinecap="butt"
                  transform="rotate(-90 45 45)"
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              ))}
              {/* Center text */}
              <text
                x="45" y="42"
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill="#0f172a"
                fontFamily="var(--font-dm-sans), sans-serif"
              >
                {collectedPct}%
              </text>
              <text
                x="45" y="53"
                textAnchor="middle"
                fontSize="8"
                fill="#94a3b8"
                fontFamily="var(--font-dm-sans), sans-serif"
              >
                collected
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-2.5 flex-1 min-w-0">
            {arcs.map((arc) => (
              <div key={arc.key} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: arc.color }}
                  />
                  <span className="text-[11px] text-slate-500 truncate">{arc.label}</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-700 flex-shrink-0">
                  {formatRupee(arc.value)}
                </span>
              </div>
            ))}

            {/* Trend indicator */}
            <div className={`flex items-center gap-1 text-[10px] font-medium mt-0.5 ${trendColor}`}>
              <TrendIcon size={10} strokeWidth={2.5} />
              {collectedPct}% of ₹{formatRupee(target)} target
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-slate-400 font-medium">
              Target: {formatRupee(target)}
            </span>
            <span className="text-[10px] font-semibold text-slate-600">
              {progressPct}% paid or partial
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            {/* Collected segment */}
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${collectedPct}%`,
                background: 'linear-gradient(to right, #1d4ed8, #3b82f6)',
              }}
            />
          </div>
          {/* Partial overlay on a separate bar row */}
          {partial > 0 && (
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((partial / target) * 100)}%` }}
              />
            </div>
          )}
          {partial > 0 && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] text-blue-600">Collected</span>
              <span className="text-[9px] text-green-600">Partial</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}