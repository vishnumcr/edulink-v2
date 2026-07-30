/**
 * components/notices/NoticeList.tsx
 *
 * Renders NoticeCard for each item in the array it's given, plus
 * loading shimmer / empty states. Does NOT filter, search, or sort —
 * NoticesPage derives the array this receives; this just displays it.
 */
"use client";

import { Megaphone, Plus } from "lucide-react";
import { Notice } from "@/types/notice";
import { NoticeCard } from "./NoticeCard";

interface NoticeListProps {
  notices: Notice[];
  loading: boolean;
  selectedId: string | null;
  searchActive: boolean;
  onSelect: (notice: Notice) => void;
  onPostNotice: () => void;
}

export function NoticeList({ notices, loading, selectedId, searchActive, onSelect, onPostNotice }: NoticeListProps) {
  if (loading) {
    return (
      <div className="ntc-list">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="ntc-shimmer" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    );
  }

  if (notices.length === 0) {
    return (
      <div className="ntc-list">
        <div className="ntc-empty">
          <div className="ntc-empty-ring">
            <Megaphone size={20} />
          </div>
          <div className="ntc-empty-title">{searchActive ? "No results" : "No notices yet"}</div>
          <div className="ntc-empty-sub">
            {searchActive ? "Try a different search term or clear filters." : "Post the first notice to get started."}
          </div>
          {!searchActive && (
            <button className="ntc-empty-cta" onClick={onPostNotice}>
              <Plus size={12} /> Post Notice
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ntc-list">
      {notices.map((notice, idx) => (
        <NoticeCard
          key={notice.id}
          notice={notice}
          active={selectedId === notice.id}
          animationIndex={idx}
          onSelect={() => onSelect(notice)}
        />
      ))}
    </div>
  );
}
