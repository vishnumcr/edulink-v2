/**
 * components/notices/NoticeFilters.tsx
 *
 * Type + priority pill filters, and the urgent quick-filter. Receives
 * precomputed counts as props — doesn't compute them from a full
 * notices array itself, so "how counts are derived" stays in one
 * place (NoticesPage) rather than duplicated here.
 */
"use client";

import { AlertTriangle } from "lucide-react";
import { NoticePriority, NoticeType } from "@/types/notice";
import { TYPE_META } from "@/services/notices/noticesService";

interface NoticeFiltersProps {
  totalCount: number;
  typeCounts: Record<NoticeType, number>;
  filterType: NoticeType | "all";
  filterPriority: NoticePriority | "all";
  onTypeChange: (type: NoticeType | "all") => void;
  onPriorityChange: (priority: NoticePriority | "all") => void;
}

export function NoticeFilters({
  totalCount,
  typeCounts,
  filterType,
  filterPriority,
  onTypeChange,
  onPriorityChange,
}: NoticeFiltersProps) {
  return (
    <div className="ntc-filter-bar">
      <button className={`ntc-pill${filterType === "all" ? " sel" : ""}`} onClick={() => onTypeChange("all")}>
        All
        <span className="ntc-pill-count">{totalCount}</span>
      </button>

      {(Object.entries(TYPE_META) as [NoticeType, (typeof TYPE_META)[NoticeType]][]).map(([key, meta]) => (
        <button
          key={key}
          className={`ntc-pill${filterType === key ? " sel" : ""}`}
          onClick={() => onTypeChange(filterType === key ? "all" : key)}
        >
          {meta.emoji} {meta.label}
          {typeCounts[key] > 0 && <span className="ntc-pill-count">{typeCounts[key]}</span>}
        </button>
      ))}

      <div className="ntc-pill-divider" />

      <button
        className={`ntc-pill${filterPriority === "urgent" ? " sel-urgent" : ""}`}
        onClick={() => onPriorityChange(filterPriority === "urgent" ? "all" : "urgent")}
      >
        <AlertTriangle size={9} /> Urgent
      </button>
    </div>
  );
}
