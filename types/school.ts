/**
 * --------------------------------------------------------------------
 * File:
 * types/school.ts
 *
 * Purpose:
 * Shared types for school data.
 *
 * Two separate types on purpose:
 * - SchoolMeta: the lightweight subset (name, logo) used by the
 *   Sidebar/useSchoolMeta, which caches its result in sessionStorage.
 *   Kept narrow so that cache payload doesn't silently grow.
 * - SchoolProfile: the full settings/general profile, including
 *   read-only account fields (plan, status, joined) that this form
 *   displays but never writes.
 * --------------------------------------------------------------------
 */

export interface SchoolMeta {
  name: string;
  logoUrl: string;
}

export interface SchoolProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  principalName: string;
  currentAcademicYear: string;
  logoUrl: string;
  /** Read-only — set by the platform, never written from the settings form. */
  plan: string;
  /** Read-only — set by the platform, never written from the settings form. */
  status: string;
  /** Read-only — set by the platform, never written from the settings form. */
  joined: string;
}

export type EditableSchoolFields = Omit<SchoolProfile, "plan" | "status" | "joined">;