/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/notices/publishNotice.ts
 *
 * Purpose:
 * The ONLY writer for schools/{schoolId}/notices/{noticeId}. Per the
 * frozen architecture this was built from: Admin → publishNotice()
 * (this function) → Firestore. The client never writes to this
 * collection directly — see repositories/notices/noticesRepository.ts
 * on the client, which is read-only by design.
 *
 * Responsibilities:
 * ✅ Validate every input server-side (title/message required, targets
 *    non-empty and well-formed, type/priority against known enums)
 * ✅ Derive `audienceKeys` from `targets` — NEVER trust or accept an
 *    audienceKeys value from the client; see the key scheme below
 * ✅ Derive the real `status` — the client can only ask for "draft" or
 *    "published"; "scheduled" is decided here, from whether `publishAt`
 *    is in the future (see the status/publishAt logic below)
 * ✅ Stamp real attribution (publishBy/publishByName/publishByRole)
 *    from the caller's own users/{uid} profile, never from client input
 * ✅ Look up the school's current academic year server-side for
 *    academicYearId
 *
 * Authorization implemented here (same shape as createTeacher.ts /
 * recordPayment.ts):
 * ✅ Caller must be signed in
 * ✅ Caller's users/{uid} profile must exist, be "active", and belong
 *    to the SAME schoolId as the notice being published
 *
 * Authorization intentionally NOT implemented here yet (same
 * documented gap as recordPayment.ts/createTeacher.ts): no role check
 * restricting this to "admin" callers specifically, since
 * users/{uid}.role has no formalized taxonomy anywhere in this
 * codebase yet.
 *
 * audienceKeys scheme (designed here, not consumed by anything yet —
 * no audience-facing reader exists in this codebase today, but this is
 * the contract a future one would query against with
 * `array-contains-any`):
 *   { type: "school" }                          -> "school"
 *   { type: "role", role }                      -> "role:{role}"
 *   { type: "class", className }                -> "class:{className}"
 *   { type: "section", className, section }     -> "section:{className}:{section}"
 * `targets` is a UNION of independent rules, not a narrowing filter —
 * picking both "Parents" and "Section 7A" means "all parents school-
 * wide, AND everyone (any role) in section 7A," not "parents who are
 * specifically in section 7A." That's what makes array-contains-any
 * (an OR/union match) the right query shape for whatever eventually
 * reads this — an intersection semantic wouldn't be expressible that
 * way at all.
 *
 * Deliberately NOT implemented (see types/notice.ts's own header and
 * the spec this was built from):
 * ❌ readBy / seenBy / analytics / delivery stats / fan-out collections
 * ❌ The Cloud Scheduler trigger that would flip a "scheduled" notice
 *    to "published" once publishAt arrives — status/publishAt are
 *    modeled correctly here, but nothing currently watches for that
 *    moment to act on it. A scheduled notice will sit at status:
 *    "scheduled" indefinitely until that trigger is built.
 * ❌ The Cloud Function trigger -> FCM push delivery step. Needs
 *    device-token registration/storage infrastructure that doesn't
 *    exist anywhere in this codebase — a separate undertaking.
 * ❌ Optimistic concurrency on edits (re-saving a draft with a
 *    noticeId). Two staff editing the same draft at once could race —
 *    not addressed here; flagged rather than silently accepted as
 *    correct.
 * --------------------------------------------------------------------
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../services/firebaseAdmin";

type NoticeStatusInput = "draft" | "published";
type NoticePriority = "normal" | "important" | "urgent";
type NoticeType = "general" | "academic" | "event" | "fee" | "holiday";
type NoticeAudienceRole = "parent" | "teacher" | "student";

type NoticeTargetRule =
  | { type: "school" }
  | { type: "role"; role: NoticeAudienceRole }
  | { type: "class"; className: string }
  | { type: "section"; className: string; section: string };

interface PublishNoticeRequest {
  schoolId: string;
  title: string;
  message: string;
  targets: NoticeTargetRule[];
  status: NoticeStatusInput;
  priority: NoticePriority;
  type: NoticeType;
  isPinned: boolean;
  publishAt?: number | null;
  expiresAt?: number | null;
  noticeId?: string;
}

interface PublishNoticeResult {
  success: true;
  noticeId: string;
  status: "draft" | "scheduled" | "published";
}

const PRIORITIES: NoticePriority[] = ["normal", "important", "urgent"];
const TYPES: NoticeType[] = ["general", "academic", "event", "fee", "holiday"];
const ROLES: NoticeAudienceRole[] = ["parent", "teacher", "student"];

function isValidTarget(rule: unknown): rule is NoticeTargetRule {
  if (!rule || typeof rule !== "object") return false;
  const r = rule as Record<string, unknown>;
  switch (r.type) {
    case "school":
      return true;
    case "role":
      return typeof r.role === "string" && ROLES.includes(r.role as NoticeAudienceRole);
    case "class":
      return typeof r.className === "string" && r.className.trim().length > 0;
    case "section":
      return (
        typeof r.className === "string" &&
        r.className.trim().length > 0 &&
        typeof r.section === "string" &&
        r.section.trim().length > 0
      );
    default:
      return false;
  }
}

/** See this file's header for the key scheme and why it's a union, not a narrowing filter. */
function deriveAudienceKeys(targets: NoticeTargetRule[]): string[] {
  const keys = new Set<string>();
  for (const rule of targets) {
    switch (rule.type) {
      case "school":
        keys.add("school");
        break;
      case "role":
        keys.add(`role:${rule.role}`);
        break;
      case "class":
        keys.add(`class:${rule.className}`);
        break;
      case "section":
        keys.add(`section:${rule.className}:${rule.section}`);
        break;
    }
  }
  return Array.from(keys);
}

export const publishNotice = onCall(
  { region: "asia-south1" },
  async (request): Promise<PublishNoticeResult> => {
    // ── Authentication ──────────────────────────────────────────────
    const callerAuth = request.auth;
    if (!callerAuth) {
      throw new HttpsError("unauthenticated", "You must be signed in to publish a notice.");
    }

    const data = (request.data ?? {}) as Partial<PublishNoticeRequest>;

    // ── Input validation ────────────────────────────────────────────
    if (!data.schoolId || typeof data.schoolId !== "string") {
      throw new HttpsError("invalid-argument", "schoolId is required.");
    }
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new HttpsError("invalid-argument", "A title is required.");
    }
    if (!data.message || typeof data.message !== "string" || !data.message.trim()) {
      throw new HttpsError("invalid-argument", "A message is required.");
    }
    if (!Array.isArray(data.targets) || data.targets.length === 0) {
      throw new HttpsError("invalid-argument", "Select at least one audience.");
    }
    if (!data.targets.every(isValidTarget)) {
      throw new HttpsError("invalid-argument", "One or more audience targets are malformed.");
    }
    if (data.status !== "draft" && data.status !== "published") {
      throw new HttpsError("invalid-argument", "status must be \"draft\" or \"published\".");
    }
    if (!data.priority || !PRIORITIES.includes(data.priority)) {
      throw new HttpsError("invalid-argument", "priority is invalid.");
    }
    if (!data.type || !TYPES.includes(data.type)) {
      throw new HttpsError("invalid-argument", "type is invalid.");
    }

    const schoolId = data.schoolId;

    // ── Authorization: caller must belong to this school ────────────
    const callerSnap = await db.collection("users").doc(callerAuth.uid).get();
    if (!callerSnap.exists) {
      throw new HttpsError("permission-denied", "No user profile found for this account.");
    }
    const caller = callerSnap.data() as { schoolId?: string; status?: string; name?: string; role?: string };
    if (caller.status !== "active") {
      throw new HttpsError("permission-denied", "This account is disabled.");
    }
    if (caller.schoolId !== schoolId) {
      throw new HttpsError("permission-denied", "You do not have access to publish notices for this school.");
    }

    // ── Academic year, looked up server-side (never trusted from the client) ──
    const schoolSnap = await db.collection("schools").doc(schoolId).get();
    const academicYearId = (schoolSnap.data()?.currentAcademicYear as string) || "";

    // ── Derive the real status from publishAt — "scheduled" is never
    // a value the client sends directly (see PublishNoticeInput's own
    // comment on the client side). ─────────────────────────────────
    const now = Date.now();
    let finalStatus: "draft" | "scheduled" | "published";
    let publishAt: number | null = typeof data.publishAt === "number" ? data.publishAt : null;
    let publishedAt: number | null = null;

    if (data.status === "draft") {
      finalStatus = "draft";
    } else if (publishAt && publishAt > now) {
      finalStatus = "scheduled";
      // publishedAt stays null until the (not yet built) scheduled
      // trigger flips this over — see this file's header.
    } else {
      finalStatus = "published";
      publishAt = publishAt ?? now;
      publishedAt = now;
    }

    const audienceKeys = deriveAudienceKeys(data.targets);

    const noticeRef = data.noticeId
      ? db.collection("schools").doc(schoolId).collection("notices").doc(data.noticeId)
      : db.collection("schools").doc(schoolId).collection("notices").doc();

    // Preserve the original createdAt when re-saving an existing
    // draft, rather than resetting its "first created" timestamp
    // every time it's edited.
    const existing = data.noticeId ? await noticeRef.get() : null;
    const createdAt = existing?.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp();

    await noticeRef.set(
      {
        title: data.title.trim(),
        message: data.message.trim(),
        targets: data.targets,
        audienceKeys,
        status: finalStatus,
        priority: data.priority,
        type: data.type,
        // Attachments are a placeholder in the composer UI right now —
        // never actually uploaded, so always written empty rather than
        // trusting an unvalidated client-supplied list.
        attachments: [],
        publishBy: callerAuth.uid,
        publishByName: caller.name || "Unknown",
        publishByRole: caller.role || "staff",
        publishAt,
        publishedAt,
        expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
        academicYearId,
        isPinned: !!data.isPinned,
        createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true, noticeId: noticeRef.id, status: finalStatus };
  }
);
