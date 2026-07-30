/**
 * components/notices/NoticeSearch.tsx
 *
 * Controlled search input. Reports the query string up on every
 * keystroke; does not filter anything itself — NoticesPage derives
 * the filtered list from this value.
 */
"use client";

import { Search } from "lucide-react";

interface NoticeSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function NoticeSearch({ value, onChange }: NoticeSearchProps) {
  return (
    <div className="ntc-search-wrap">
      <Search size={13} className="ntc-search-icon" />
      <input
        className="ntc-search"
        placeholder="Search by title or content…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
