/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/parent/types.ts
 *
 * Purpose:
 * Local copy of the parent identity shapes for the Cloud Functions
 * package. Deliberately NOT imported from the client's types/parent.ts
 * — the functions/ package is fully self-contained (see tsconfig.json's
 * rootDir: "src"); reaching outside functions/src/ type-checks fine
 * locally but silently breaks at deploy time (same rule
 * collectAdmissionFee.ts already follows for its own local types).
 *
 * Keep this in sync with types/parent.ts by hand whenever either
 * changes — there's no build step that enforces it, so a shape change
 * on one side without the other is a real risk to watch for in review.
 *
 * Shared across every file under functions/src/parent/ via normal
 * relative imports (e.g. `import { ParentAccount } from "./types"`) —
 * the self-containment rule only blocks reaching OUTSIDE
 * functions/src/, not sharing within it (see paymentGateway/ for the
 * same pattern: connect.ts → paymentGatewayService.ts → providers/).
 * --------------------------------------------------------------------
 */

export type ParentRelationship = "father" | "mother";

export type ParentAccountStatus = "active" | "disabled";

export interface ParentLinkedStudent {
  schoolId: string;
  schoolName: string;
  studentId: string;
  studentName: string;
  className: string;
  section: string | null;
}

/** users/{uid} Firestore document, when users/{uid}.type === "parent". */
export interface ParentAccount {
  uid: string;
  type: "parent";
  eduLinkId: string;
  name: string;
  /** E.164 normalized — every lookup/write here assumes this format. */
  phone: string;
  relationship: ParentRelationship;
  status: ParentAccountStatus;
  linkedStudents: ParentLinkedStudent[];
  createdAt: unknown;
  updatedAt?: unknown;
}

/** schools/{schoolId}/students/{studentId}/parents/{uid} — reverse index. */
export interface StudentParentLink {
  uid: string;
  eduLinkId: string;
  name: string;
  phone: string;
  relationship: ParentRelationship;
  linkedAt: unknown;
}

/** Input to the admission-time create-or-link step, one per parent. */
export interface ParentLinkRequest {
  name: string;
  phone: string;
  relationship: ParentRelationship;
}

/** Result of a create-or-link attempt. */
export interface ParentLinkResult {
  uid: string;
  eduLinkId: string;
  wasCreated: boolean;
}