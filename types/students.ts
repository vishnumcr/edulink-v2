/**
 * --------------------------------------------------------------------
 * File:
 * types/students.ts
 *
 * Purpose:
 * Shared types for the Students feature.
 *
 * Firestore document:
 * schools/{schoolId}/students/{studentId}
 *
 * Nested by domain (profile / parent / contact) rather than flat —
 * matches how the school's other financial/academic pages already
 * group related fields, and scales better as more sections
 * (academic history, transport, etc.) get added to a student later.
 * --------------------------------------------------------------------
 */

export type Gender = "Male" | "Female" | "Other";
export type StudentStatus = "active" | "inactive" | "transferred";

export interface StudentProfile {
  name: string;
  rollNo: string;
  gender: Gender;
  dob: string;
  bloodGroup: string;
  photoUrl: string | null;
  /** APAAR ID — 12-digit national student ID (NEP 2020). Optional:
   *  existing students predate this field, and not every family has
   *  one generated at admission time. */
  apaarId?: string;
  /** State-issued Permanent Enrollment Number (e.g. AP/Telangana SATS). */
  penId?: string;
}

export interface StudentParent {
  fatherName: string;
  fatherPhone: string;
  motherName?: string;
  motherPhone?: string;
}

export interface StudentContact {
  email: string;
  phone: string;
  address: string;
}

export interface Student {
  id: string;
  profile: StudentProfile;
  className: string;
  /**
   * Nullable — many schools don't subdivide a class into sections at
   * all (a single class of 25 students has no reason to have a
   * "Section A"). Null means "this student's class has no sections,"
   * not "not yet assigned" — there's no meaningful default to invent
   * here, so every consumer treats absence as a real, valid state to
   * display/handle, not something to paper over with a fake value.
   */
  section: string | null;
  parent: StudentParent;
  contact: StudentContact;
  status: StudentStatus;
  avatarColor: string;
  /**
   * The school's official admission number — auto-generated (see
   * AdmissionRepository.getNextNumber) when a student comes through
   * the Admission flow. Optional because a student can also be
   * created directly via the manual add-student drawer, bypassing
   * Admission entirely; that path doesn't assign one.
   */
  admissionNumber?: string;
  /**
   * Soft-delete flag. StudentsRepository.deleteStudent sets this to
   * true instead of actually removing the Firestore document.
   *
   * This is required for the local cache to work at all: delta-sync
   * (getStudentsUpdatedSince) can only detect documents that still
   * exist and changed — a hard-deleted document just vanishes with no
   * trace, so a cached client would keep showing it forever with no
   * way to find out it was removed. Soft-deleting turns a deletion
   * into an ordinary update the delta query picks up like any other.
   *
   * Deleted students are filtered out of every list (the Students
   * page, and every other page's roster picker via
   * StudentsService.subscribeToStudents) — this is an internal detail,
   * not a "trash" UI concept exposed anywhere yet.
   */
  deleted: boolean;
  /**
   * Plain epoch-millisecond numbers, not Firestore Timestamps.
   * StudentsService converts on read (toMillis) so nothing downstream
   * — React state, the IndexedDB cache, JSX — ever touches a raw
   * Timestamp object. Firestore itself still stores these as real
   * Timestamps (written via serverTimestamp()); this conversion
   * happens at the normalization boundary, not in the database.
   *
   * Both fields are always set by the repository on write (including
   * on creation) so that updatedAt is never missing — a Firestore
   * inequality query like `where("updatedAt", ">", x)` silently
   * excludes documents where the field doesn't exist at all, which
   * would make newly-created, never-edited students invisible to
   * delta-sync otherwise.
   */
  createdAt: number;
  updatedAt: number;
}

/**
 * Shape submitted from the enroll/edit drawer. Flat, because it maps
 * 1:1 to form fields — StudentsService is responsible for reshaping
 * this into the nested Student document.
 */
export interface StudentFormValues {
  name: string;
  rollNo: string;
  gender: Gender;
  dob: string;
  bloodGroup: string;
  apaarId: string;
  penId: string;
  className: string;
  /** Empty string means "no section" — converted to null on save (see toNewDocument/toUpdateDocument). Kept as a plain string here since form inputs don't have a null state. */
  section: string;
  fatherName: string;
  fatherPhone: string;
  email: string;
  phone: string;
  address: string;
  status: StudentStatus;
}

/** Sortable fields on the Students page. */
export type StudentSortKey = "name" | "className" | "rollNo";

/**
 * How many rows the Students table renders per page.
 *
 * This is a pure UI/rendering concern now, not a Firestore query
 * param — the whole roster is cached and filtered/sorted in memory,
 * so this just slices the already-filtered array. It exists because
 * rendering thousands of DOM rows at once is slow on low-end devices
 * regardless of how the data was fetched; loading the data cheaply
 * doesn't make rendering all of it any faster.
 */
export const STUDENTS_PAGE_SIZE = 100;