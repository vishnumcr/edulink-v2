/**
 * --------------------------------------------------------------------
 * File:
 * services/notices/noticesService.ts
 *
 * Purpose:
 * Business logic for the Notices feature.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed Notice
 * ✅ Own the priority/type/status metadata maps (colors, icons, labels)
 *    that drive the card stripe, badges, and detail-panel styling —
 *    carried over from the previous page's PRIORITY_META/CATEGORY_META,
 *    plus a new STATUS_META for the status this feature didn't have
 *    before (draft/scheduled/published)
 * ✅ The client-side search/filter predicate the page derives its
 *    visible list from
 * ✅ Call the publishNotice Cloud Function — the ONLY way a notice is
 *    ever created or edited (see noticesRepository's header for why
 *    there's no write method to call instead)
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job — and for
 *    writes, that's the Cloud Function's job; there is no client-side
 *    write path at all)
 * ❌ Own React state — see hooks/notices/useNoticeList.ts and
 *    usePublishNotice.ts, which wrap this service for components
 * --------------------------------------------------------------------
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { ElementType } from "react";
import {
  Notice,
  NoticePriority,
  NoticeStatus,
  NoticeType,
  PublishNoticeInput,
  PublishNoticeResult,
} from "@/types/notice";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileEdit,
  Flame,
  Info,
} from "lucide-react";

/** Same pattern as every other service in this codebase — see timetableService/calendarService for why this is duplicated per-service rather than shared. */
function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (
    typeof value === "object" &&
    "seconds" in (value as Record<string, unknown>) &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number }).seconds;
    const nanoseconds =
      "nanoseconds" in (value as Record<string, unknown>) &&
      typeof (value as { nanoseconds: unknown }).nanoseconds === "number"
        ? (value as { nanoseconds: number }).nanoseconds
        : 0;
    return seconds * 1000 + Math.round(nanoseconds / 1e6);
  }
  return null;
}

export const PRIORITY_META: Record<
  NoticePriority,
  { label: string; color: string; bg: string; border: string; stripe: string; icon: ElementType }
> = {
  normal: { label: "Normal", color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", stripe: "#CBD5E1", icon: Info },
  important: { label: "Important", color: "#B45309", bg: "#FFFBEB", border: "#FDE68A", stripe: "#F59E0B", icon: Flame },
  urgent: { label: "Urgent", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA", stripe: "#EF4444", icon: AlertTriangle },
};

/** Renamed 1:1 from the old page's CATEGORY_META — same five values, same colors, just NoticeType instead of NoticeCategory. */
export const TYPE_META: Record<NoticeType, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  general: { label: "General", emoji: "📢", color: "#475569", bg: "#F1F5F9", border: "#CBD5E1" },
  academic: { label: "Academic", emoji: "📚", color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
  event: { label: "Event", emoji: "🎉", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
  fee: { label: "Fee", emoji: "💳", color: "#059669", bg: "#F0FDF4", border: "#BBF7D0" },
  holiday: { label: "Holiday", emoji: "🏖️", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
};

/** New — didn't exist in the old page since every notice used to publish immediately with no concept of draft/scheduled. */
export const STATUS_META: Record<NoticeStatus, { label: string; color: string; bg: string; border: string; icon: ElementType }> = {
  draft: { label: "Draft", color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", icon: FileEdit },
  scheduled: { label: "Scheduled", color: "#B45309", bg: "#FFFBEB", border: "#FDE68A", icon: Clock },
  published: { label: "Published", color: "#059669", bg: "#F0FDF4", border: "#BBF7D0", icon: CheckCircle2 },
};

function normalizeNotice(id: string, data: Record<string, unknown>): Notice {
  return {
    id,
    title: (data.title as string) || "",
    message: (data.message as string) || "",
    targets: (data.targets as Notice["targets"]) || [],
    audienceKeys: (data.audienceKeys as string[]) || [],
    status: ((data.status as string) || "draft") as NoticeStatus,
    priority: ((data.priority as string) || "normal") as NoticePriority,
    type: ((data.type as string) || "general") as NoticeType,
    attachments: (data.attachments as Notice["attachments"]) || [],
    publishBy: (data.publishBy as string) || "",
    publishByName: (data.publishByName as string) || "Unknown",
    publishByRole: (data.publishByRole as string) || "",
    publishAt: toMillis(data.publishAt),
    publishedAt: toMillis(data.publishedAt),
    expiresAt: toMillis(data.expiresAt),
    academicYearId: (data.academicYearId as string) || "",
    isPinned: !!data.isPinned,
    createdAt: toMillis(data.createdAt) ?? 0,
    updatedAt: toMillis(data.updatedAt) ?? 0,
  };
}

/**
 * Pinned notices first, then newest first — matches the "pin sorts to
 * the top" UI improvement. Notices already arrive newest-first from
 * the repository's own query, so this only needs to re-group by pin,
 * not re-sort everything from scratch.
 */
function sortNotices(notices: Notice[]): Notice[] {
  return [...notices].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * The page's client-side search/filter predicate — search matches
 * title or message; type/priority filters are exact matches or "all".
 */
function matchesFilters(
  notice: Notice,
  filters: { search: string; type: NoticeType | "all"; priority: NoticePriority | "all" }
): boolean {
  const q = filters.search.trim().toLowerCase();
  const matchesSearch =
    !q || notice.title.toLowerCase().includes(q) || notice.message.toLowerCase().includes(q);
  const matchesType = filters.type === "all" || notice.type === filters.type;
  const matchesPriority = filters.priority === "all" || notice.priority === filters.priority;
  return matchesSearch && matchesType && matchesPriority;
}

export class NoticesService {
  normalizeAll(docs: { id: string; data: Record<string, unknown> }[]): Notice[] {
    return sortNotices(docs.map((d) => normalizeNotice(d.id, d.data)));
  }

  filter(
    notices: Notice[],
    filters: { search: string; type: NoticeType | "all"; priority: NoticePriority | "all" }
  ): Notice[] {
    return notices.filter((n) => matchesFilters(n, filters));
  }

  /**
   * The ONLY way a notice is ever created or edited — a thin wrapper
   * around the publishNotice callable. Used for BOTH "Save Draft" and
   * "Publish Notice": same call, same function, just a different
   * `status` in the input (see PublishNoticeInput's own comment on
   * why "scheduled" is never sent directly).
   */
  async publishNotice(input: PublishNoticeInput): Promise<PublishNoticeResult> {
    const callable = httpsCallable<PublishNoticeInput, PublishNoticeResult>(functions, "publishNotice");
    const { data } = await callable(input);
    return data;
  }
}

export const noticesService = new NoticesService();