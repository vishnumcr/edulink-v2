/**
 * components/notices/NoticeCard.tsx
 *
 * One notice -> one card. Priority stripe (the signature visual
 * element, unchanged from the original page), badges, pin marker,
 * snippet, and relative/scheduled time. Purely presentational — no
 * state, no data fetching.
 */
"use client";

import { CSSProperties } from "react";
import { Pin, Users } from "lucide-react";
import { Notice } from "@/types/notice";
import {
  PRIORITY_META,
  TYPE_META,
  STATUS_META,
  timeAgo,
  scheduledLabel,
  targetSummary,
} from "@/services/notices/noticesService";

interface NoticeCardProps {
  notice: Notice;
  active: boolean;
  animationIndex: number;
  onSelect: () => void;
}

export function NoticeCard({ notice, active, animationIndex, onSelect }: NoticeCardProps) {
  const pri = PRIORITY_META[notice.priority];
  const type = TYPE_META[notice.type];
  const PriIcon = pri.icon;
  const target = targetSummary(notice.targets);

  return (
    <div
      className={`ntc-card${active ? " active" : ""}`}
      style={
        {
          "--stripe": pri.stripe,
          animationName: "ntcUp",
          animationDuration: "0.2s",
          animationTimingFunction: "ease",
          animationFillMode: "both",
          animationDelay: `${animationIndex * 20}ms`,
        } as CSSProperties
      }
      onClick={onSelect}
    >
      <div className="ntc-card-top">
        <div className="ntc-card-title-row">
          {notice.isPinned && <Pin size={11} className="ntc-pin-icon" fill="currentColor" />}
          <div className="ntc-card-title">{notice.title}</div>
        </div>
        <span className="ntc-card-time" title={fullDateTitle(notice)}>
          {notice.status === "scheduled" ? scheduledLabel(notice.publishAt) : timeAgo(notice.createdAt)}
        </span>
      </div>
      <div className="ntc-card-snippet">{notice.message}</div>
      <div className="ntc-card-footer">
        {notice.status !== "published" && (
          <StatusBadge notice={notice} />
        )}
        {notice.priority !== "normal" && (
          <span className="ntc-badge" style={{ background: pri.bg, color: pri.color, borderColor: pri.border }}>
            <PriIcon size={9} /> {pri.label}
          </span>
        )}
        <span className="ntc-badge" style={{ background: type.bg, color: type.color, borderColor: type.border }}>
          {type.emoji} {type.label}
        </span>
        <span
          className="ntc-badge"
          style={{ background: "#F8FAFC", color: "#64748B", borderColor: "#E2E8F0" }}
          title={target.detail}
        >
          <Users size={9} />
          &nbsp;{target.label}
        </span>
      </div>
    </div>
  );
}

function fullDateTitle(notice: Notice): string {
  if (notice.status === "scheduled") return scheduledLabel(notice.publishAt);
  return new Date(notice.createdAt).toLocaleString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ notice }: { notice: Notice }) {
  const meta = STATUS_META[notice.status];
  const Icon = meta.icon;
  return (
    <span className="ntc-badge" style={{ background: meta.bg, color: meta.color, borderColor: meta.border }}>
      <Icon size={9} /> {meta.label}
    </span>
  );
}