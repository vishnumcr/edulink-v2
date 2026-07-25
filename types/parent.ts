/**
 * --------------------------------------------------------------------
 * File:
 * types/parent.ts
 *
 * Purpose:
 * Shared types for the parent identity system — one Firebase Auth
 * account per parent (never per family, never per student), created
 * or linked at admission time, authenticated via mobile + OTP only
 * (no password — see functions/src/parent/ for the OTP flow).
 *
 * This project (the staff-facing app) never signs a parent in. It
 * only creates/links these accounts at admission and reads them for
 * staff-facing display (e.g. "Parent account linked ✓" on a student's
 * profile). The actual parent login UI lives in a separate project;
 * these types exist here because admission-time linking is a
 * staff-app responsibility, and because Firestore security rules
 * (governing the OTHER project's reads) live in this same repo.
 *
 * Naming: "parent," never "guardian" — this system deliberately only
 * covers Father/Mother. A non-parent caretaker is out of scope for
 * now (see the admission conversation this was decided in); if that
 * ever changes, it's a new relationship value and a product decision,
 * not a silent extension of this type.
 *
 * Phone numbers are always stored normalized to E.164 (e.g.
 * "+919876543210") — every lookup/write in the parent identity system
 * assumes this format. Normalization happens once, at the boundary
 * (see functions/src/parent/identity.ts), never repeated ad hoc.
 *
 * Does NOT:
 * ❌ Read Firestore or call Firebase Auth (see services/parent/* for that)
 * ❌ Contain OTP/rate-limiting types (see types for that live alongside
 *    the OTP service itself, once built — a parent account existing
 *    is a longer-lived concept than a short-lived OTP attempt)
 * --------------------------------------------------------------------
 */

import { UserStatus } from "@/types/auth";

export type ParentRelationship = "father" | "mother";

/**
 * -------------------------------------------------------
 * One entry in a parent's linkedStudents[] — denormalized
 * on purpose, so "show this parent their kids across every
 * school" is a single users/{uid} read, not a fan-out query
 * across schools/*\/students/*.
 *
 * Kept in sync whenever the source student record changes
 * name/class/section — see services/parent/parentLinkService.ts
 * (built in a later phase) for where that sync lives.
 * -------------------------------------------------------
 */
export interface ParentLinkedStudent {
  schoolId: string;
  schoolName: string;
  studentId: string;
  studentName: string;
  className: string;
  section: string | null;
}

/**
 * -------------------------------------------------------
 * users/{uid} Firestore document, when users/{uid}.type === "parent".
 *
 * Sibling shape to UserProfile (types/auth.ts), which is
 * users/{uid} when .type === "staff". Deliberately NOT merged into
 * one unioned UserProfile type — this project's AuthContext only
 * ever constructs/reads staff-shaped docs, and a parent never signs
 * in here, so widening UserProfile into a union would force type
 * narrowing onto dozens of existing staff-only call sites for no
 * benefit to this project. The "type" field is what lets Firestore
 * SECURITY RULES tell the two shapes apart — that's the only place
 * both shapes need to be reasoned about together.
 * -------------------------------------------------------
 */
export interface ParentAccount {
  uid: string;
  type: "parent";
  /**
   * Permanent, human-readable ID (e.g. "EL00012458"). Internal/staff
   * use and dedup only — a parent never types this in; login is
   * mobile + OTP. See functions/src/parent/identity.ts for generation.
   */
  eduLinkId: string;
  name: string;
  /** E.164 normalized. This is the login identifier and the create-or-link key. */
  phone: string;
  relationship: ParentRelationship;
  status: UserStatus;
  linkedStudents: ParentLinkedStudent[];
  createdAt: unknown;
  updatedAt?: unknown;
}

/**
 * -------------------------------------------------------
 * schools/{schoolId}/students/{studentId}/parents/{uid} — the
 * reverse index, colocated with the student the same way
 * results/attendance/finance already are, so "who are this
 * student's linked parents" is a subcollection read scoped to one
 * school, not a collection-group query across every school.
 *
 * This is intentionally a smaller projection than ParentAccount, not
 * a duplicate of it — it exists for THIS student's context, so it
 * doesn't need the parent's other linkedStudents.
 * -------------------------------------------------------
 */
export interface StudentParentLink {
  uid: string;
  eduLinkId: string;
  name: string;
  phone: string;
  relationship: ParentRelationship;
  linkedAt: unknown;
}

/**
 * -------------------------------------------------------
 * Input to the admission-time create-or-link step (one per
 * parent — father and mother are always linked independently,
 * never as a shared account). See types/admission.ts's
 * AdmissionParentContact for where name/phone come from.
 * -------------------------------------------------------
 */
export interface ParentLinkRequest {
  name: string;
  phone: string;
  relationship: ParentRelationship;
}

/**
 * -------------------------------------------------------
 * Result of a create-or-link attempt, for staff-facing
 * confirmation messaging ("Linked to existing parent account"
 * vs. "New parent account created").
 * -------------------------------------------------------
 */
export interface ParentLinkResult {
  uid: string;
  eduLinkId: string;
  wasCreated: boolean;
}