/**
 * --------------------------------------------------------------------
 * File:
 * services/students/studentsService.ts
 *
 * Purpose:
 * Business logic for the Students feature.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed Student
 *    (defaulting missing/legacy fields defensively)
 * ✅ Validate form input
 * ✅ Map StudentFormValues → the nested Student document shape
 * ✅ Assign a random avatar color on creation
 * ✅ Orchestrate the local cache: sync students from Firestore into
 *    IndexedDB (studentsCache.ts) via delta-sync, and read them back
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Touch IndexedDB directly (that's studentsCache.ts's job — this
 *    file coordinates the two, it doesn't replace either)
 * --------------------------------------------------------------------
 */

import {
  studentsRepository,
  NewStudentDocument,
  StudentDocumentUpdate,
} from "@/repositories/students/studentsRepository";
import { studentsCache } from "@/services/students/studentsCache";
import { AVATAR_COLORS } from "@/constants/students";
import { Student, StudentFormValues } from "@/types/students";

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

/**
 * ----------------------------------------------------
 * Safely coerces a raw Firestore field into a plain
 * "YYYY-MM-DD" string, no matter what shape it's actually
 * stored as.
 *
 * Why this exists: `dob` is *supposed* to always be a plain
 * string (it comes from an <input type="date">), but a TS
 * `as string` cast on a raw Firestore doc does NOT convert
 * the value at runtime — it only silences the type checker.
 * If a document has `dob` stored as a Firestore Timestamp
 * (legacy data, a console edit, a bad import, etc.), the old
 * code would pass that Timestamp object straight through and
 * React would crash trying to render it as a child
 * ("Objects are not valid as a React child... {seconds, nanoseconds}").
 *
 * This normalizes any of those shapes into a safe string so
 * the UI never crashes, regardless of what's actually in the DB.
 * ----------------------------------------------------
 */
function safeDateString(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number }).seconds;
    return new Date(seconds * 1000).toISOString().split("T")[0];
  }
  return "";
}

/**
 * ----------------------------------------------------
 * Safely coerces a raw Firestore timestamp field into a plain
 * epoch-millisecond number.
 *
 * Firestore stores createdAt/updatedAt as Timestamp instances
 * (written via serverTimestamp()), but nothing past this
 * normalization boundary should ever touch that Timestamp object
 * directly — the same "cast lies about the runtime type" issue
 * that caused the dob crash applies here too, and a Timestamp
 * collapses into a bare {seconds, nanoseconds} object the moment
 * it's cloned into IndexedDB or JSON — exactly the shape that
 * crashes React if it ever reaches JSX. Converting to a number here
 * means every consumer (UI, cache, sync watermark) only ever sees a
 * plain number.
 * ----------------------------------------------------
 */
function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number }).seconds;
    const nanoseconds =
      "nanoseconds" in value && typeof (value as { nanoseconds: unknown }).nanoseconds === "number"
        ? (value as { nanoseconds: number }).nanoseconds
        : 0;
    return seconds * 1000 + Math.round(nanoseconds / 1e6);
  }
  return 0;
}

/**
 * ----------------------------------------------------
 * Normalizes a raw Firestore doc into a well-formed Student.
 * Defensive against legacy/partial documents — every field
 * falls back to a safe default rather than being undefined.
 * ----------------------------------------------------
 */
function normalizeStudent(id: string, data: Record<string, unknown>): Student {
  const profile = (data.profile as Record<string, unknown>) || {};
  const parent = (data.parent as Record<string, unknown>) || {};
  const contact = (data.contact as Record<string, unknown>) || {};

  return {
    id,
    profile: {
      name: (profile.name as string) || "",
      rollNo: (profile.rollNo as string) || "",
      gender: (profile.gender as Student["profile"]["gender"]) || "Male",
      dob: safeDateString(profile.dob),
      bloodGroup: (profile.bloodGroup as string) || "",
      apaarId: (profile.apaarId as string) || "",
      penId: (profile.penId as string) || "",
      photoUrl: (profile.photoUrl as string | null) ?? null,
    },
    className: (data.className as string) || "",
    section: (data.section as string) || null,
    parent: {
      fatherName: (parent.fatherName as string) || "",
      fatherPhone: (parent.fatherPhone as string) || "",
      motherName: parent.motherName as string | undefined,
      motherPhone: parent.motherPhone as string | undefined,
    },
    contact: {
      email: (contact.email as string) || "",
      phone: (contact.phone as string) || "",
      // Falls back to a legacy top-level `address` field: an earlier
      // version of the admission flow wrote address at the document
      // root instead of nesting it under `contact`, so older student
      // docs need this fallback to show their address at all.
      address: (contact.address as string) || (data.address as string) || "",
    },
    status: (data.status as Student["status"]) || "active",
    // Defaults false for any doc written before this field existed —
    // an un-migrated legacy student is correctly "not deleted."
    deleted: (data.deleted as boolean) ?? false,
    avatarColor: (data.avatarColor as string) || randomAvatarColor(),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function validateForm(values: StudentFormValues): void {
  if (!values.name.trim() || !values.className) {
    throw new Error("Name and grade are required.");
  }
}

function toNewDocument(values: StudentFormValues): NewStudentDocument {
  return {
    profile: {
      name: values.name,
      rollNo: values.rollNo,
      gender: values.gender,
      dob: values.dob,
      bloodGroup: values.bloodGroup,
      apaarId: values.apaarId,
      penId: values.penId,
      photoUrl: null,
    },
    className: values.className,
    classId: values.classId,
    // "" means no section was chosen — stored as null, not an empty
    // string, so every reader treats it as "genuinely no section" the
    // same way regardless of write path.
    section: values.section || null,
    sectionId: values.sectionId,
    parent: {
      fatherName: values.fatherName,
      fatherPhone: values.fatherPhone,
    },
    contact: {
      email: values.email,
      phone: values.phone,
      address: values.address,
    },
    status: values.status,
    deleted: false,
    avatarColor: randomAvatarColor(),
  };
}

function toUpdateDocument(values: StudentFormValues): StudentDocumentUpdate {
  return {
    profile: {
      name: values.name,
      rollNo: values.rollNo,
      gender: values.gender,
      dob: values.dob,
      bloodGroup: values.bloodGroup,
      apaarId: values.apaarId,
      penId: values.penId,
      photoUrl: null,
    },
    className: values.className,
    classId: values.classId,
    section: values.section || null,
    sectionId: values.sectionId,
    parent: {
      fatherName: values.fatherName,
      fatherPhone: values.fatherPhone,
    },
    contact: {
      email: values.email,
      phone: values.phone,
      address: values.address,
    },
    status: values.status,
    // avatarColor and deleted are intentionally left untouched on a
    // normal profile update — avatarColor is assigned once at
    // creation, and deleted is only ever set by deleteStudent.
  };
}

export class StudentsService {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's students, normalized — used by
   * OTHER pages' roster pickers (attendance, finance/collect,
   * results), not by the Students admin page (see syncStudents
   * below). Filters out soft-deleted students so a deleted student
   * disappears from every roster picker, matching the old
   * hard-delete behavior.
   * ----------------------------------------------------
   */
  subscribeToStudents(
    schoolId: string,
    callback: (students: Student[]) => void
  ): () => void {
    return studentsRepository.subscribeToStudents(schoolId, (docs) => {
      callback(
        docs.map((d) => normalizeStudent(d.id, d.data)).filter((s) => !s.deleted)
      );
    });
  }

  /**
   * ----------------------------------------------------
   * The Students admin page's data source. Syncs the local
   * IndexedDB cache with Firestore via delta-sync (only fetches
   * students updated since the last sync — on a cold cache that's
   * everything, since sinceMs defaults to 0), then returns the full
   * cached roster (soft-deleted students excluded).
   *
   * Cheap to call often: a no-op sync (nothing changed since last
   * time) costs a single Firestore query that matches zero
   * documents, not a re-read of the whole collection. Call this on
   * page open, after every write (create/update/delete), and on a
   * manual "Refresh" click — there's no live listener backing this
   * page anymore (see the students-page caching conversation for why).
   * ----------------------------------------------------
   */
  async syncStudents(schoolId: string): Promise<Student[]> {
    const lastSyncedAt = await studentsCache.getLastSyncedAt(schoolId);
    const updatedDocs = await studentsRepository.getStudentsUpdatedSince(schoolId, lastSyncedAt);
    const updatedStudents = updatedDocs.map((d) => normalizeStudent(d.id, d.data));

    if (updatedStudents.length > 0) {
      await studentsCache.upsertMany(schoolId, updatedStudents);
      // The new watermark is the latest updatedAt we actually saw,
      // not "now" — using wall-clock time here could skip documents
      // written between the query executing and this line running.
      const newWatermark = Math.max(lastSyncedAt, ...updatedStudents.map((s) => s.updatedAt));
      await studentsCache.setLastSyncedAt(schoolId, newWatermark);
    }

    const cached = await studentsCache.getAll(schoolId);
    return cached.filter((s) => !s.deleted);
  }

  /**
   * ----------------------------------------------------
   * All cached students, INCLUDING soft-deleted ones, as a lookup
   * map — for other features that need to display a student's
   * current name/phone attached to a historical record (an invoice,
   * a payment...) even if that student has since transferred out or
   * been deleted.
   *
   * Deliberately does NOT filter deleted students out — a deleted
   * student's old invoice should still show who it was for. The
   * Students admin page itself keeps using syncStudents() above,
   * which does filter deleted students, since that's a user-facing
   * roster, not a historical join.
   * ----------------------------------------------------
   */
  async getCachedStudentsMap(schoolId: string): Promise<Map<string, Student>> {
    const all = await studentsCache.getAll(schoolId);
    return new Map(all.map((s) => [s.id, s]));
  }

  /**
   * ----------------------------------------------------
   * Validate and create a new student.
   * ----------------------------------------------------
   */
  async createStudent(schoolId: string, values: StudentFormValues): Promise<void> {
    validateForm(values);
    await studentsRepository.createStudent(schoolId, toNewDocument(values));
  }

  /**
   * ----------------------------------------------------
   * Validate and update an existing student.
   * ----------------------------------------------------
   */
  async updateStudent(
    schoolId: string,
    studentId: string,
    values: StudentFormValues
  ): Promise<void> {
    validateForm(values);
    await studentsRepository.updateStudent(schoolId, studentId, toUpdateDocument(values));
  }

  /**
   * ----------------------------------------------------
   * Soft-delete a student (see the `deleted` field's doc comment in
   * types/students.ts). The caller is expected to re-sync afterward
   * (StudentsPage does, via syncStudents) so the cache picks up the
   * change and the student disappears from the visible list.
   * ----------------------------------------------------
   */
  async deleteStudent(schoolId: string, studentId: string): Promise<void> {
    await studentsRepository.deleteStudent(schoolId, studentId);
  }
}

export const studentsService = new StudentsService();