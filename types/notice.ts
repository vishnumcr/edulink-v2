/**
 * --------------------------------------------------------------------
 * File:
 * types/notice.ts
 *
 * Purpose:
 * Shared types for the Notices feature.
 *
 * Firestore document:
 * schools/{schoolId}/notices/{noticeId}
 *
 * Backend architecture (frozen, per the redesign spec this was built
 * from):
 *   Admin → publishNotice() [Cloud Function] → Firestore
 *
 * The client NEVER writes to this collection directly — every write
 * goes through the publishNotice callable (see
 * functions/src/notices/publishNotice.ts). Reads are still a normal
 * Firestore listener (see repositories/notices/noticesRepository.ts) —
 * the "no direct writes" rule is about writes only.
 *
 * Deliberately NOT built (per the spec's "DO NOT BUILD" list):
 * ❌ readBy / seenBy — no per-user read tracking
 * ❌ analytics / delivery stats
 * ❌ fan-out collections, parentNoticeState, per-user notice copies
 * These would each be a real, separate feature (and a real read-cost
 * concern of their own) — not something to bolt on quietly here.
 * --------------------------------------------------------------------
 */

export type NoticeStatus = "draft" | "scheduled" | "published";
export type NoticePriority = "normal" | "important" | "urgent";
export type NoticeType = "general" | "academic" | "event" | "fee" | "holiday";
export type NoticeAudienceRole = "parent" | "teacher" | "student";

/**
 * What a notice targets. A notice can have multiple rules (e.g. "all
 * parents" AND "Class 5 Section A") — TargetSelector produces an
 * array of these, never a single value.
 *
 * audienceKeys (see Notice below) is DERIVED from these rules,
 * server-side, inside publishNotice — never sent by the client and
 * never trusted from client input, since it's the field future
 * audience-side queries (`array-contains-any`) will rely on.
 *
 * IMPORTANT: this is a UNION of independent rules, not a narrowing
 * filter. Picking both a "role: parent" rule and a "section: 7/A" rule
 * means "all parents school-wide, PLUS everyone (any role) in section
 * 7A" — not "parents who are specifically in section 7A." See
 * publishNotice.ts's audienceKeys derivation for exactly how each rule
 * type maps to a key, and TargetSelector's own header for how its UI
 * makes this union behavior legible rather than surprising.
 */
export type NoticeTargetRule =
  | { type: "school" }
  | { type: "role"; role: NoticeAudienceRole }
  | { type: "class"; className: string }
  | { type: "section"; className: string; section: string };

export interface NoticeAttachment {
  name: string;
  url: string;
  sizeBytes?: number;
}

export interface Notice {
  id: string;
  title: string;
  message: string;
  targets: NoticeTargetRule[];
  /** Denormalized from targets, server-computed — see the rule above. */
  audienceKeys: string[];
  status: NoticeStatus;
  priority: NoticePriority;
  type: NoticeType;
  attachments: NoticeAttachment[];
  publishBy: string; // uid
  publishByName: string;
  publishByRole: string;
  /**
   * When the notice should go/went live. For an immediate publish
   * this equals publishedAt. For a scheduled one, this is in the
   * future and status stays "scheduled" until a Cloud Scheduler
   * trigger (not yet built — see publishNotice.ts) flips it over.
   */
  publishAt: number | null;
  /** Set once status actually becomes "published" — null until then. */
  publishedAt: number | null;
  expiresAt: number | null;
  academicYearId: string;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the composer drawer collects and sends to publishNotice(). */
export interface PublishNoticeInput {
  schoolId: string;
  title: string;
  message: string;
  targets: NoticeTargetRule[];
  status: "draft" | "published"; // "scheduled" is derived server-side from publishAt, not chosen directly
  priority: NoticePriority;
  type: NoticeType;
  isPinned: boolean;
  /** epoch ms; null/omitted means "publish immediately" when status is "published". */
  publishAt?: number | null;
  expiresAt?: number | null;
  noticeId?: string; // present when editing/re-saving an existing draft
}

export interface PublishNoticeResult {
  success: true;
  noticeId: string;
  status: NoticeStatus;
}
