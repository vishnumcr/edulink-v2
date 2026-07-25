/**
 * --------------------------------------------------------------------
 * File:
 * types/admission.ts
 *
 * Purpose:
 * Shared types for the Admission feature.
 *
 * Firestore document:
 * schools/{schoolId}/admissions/{admissionId}
 *
 * Field shape is nested (student/parent/address/admission) rather than
 * flat — matches what the admission form was already writing before
 * this type existed, so no data migration is needed for admissions
 * submitted before this file was added.
 *
 * Status lifecycle (see the admission-flow planning conversation this
 * was designed from):
 *   pending  → application submitted, awaiting staff review
 *   approved → staff approved; awaiting admission fee payment
 *   rejected → staff rejected; rejectionReason set
 *   enrolled → admission fee paid; studentId set; a real Student +
 *              first invoice now exist
 *
 * Two separate auto-generated numbers, assigned at different stages —
 * neither is typed by staff:
 *   registrationNumber → assigned the moment an application is
 *                         submitted (every applicant gets one,
 *                         regardless of outcome — tracks "who applied")
 *   admissionNumber     → assigned only once actually enrolled (the
 *                         school's official student number — tracks
 *                         "who was admitted"). Undefined until then.
 * Both come from an atomically-incremented counter — see
 * repositories/admission/admissionRepository.ts (getNextNumber).
 * --------------------------------------------------------------------
 */

export type AdmissionStatus = "pending" | "approved" | "rejected" | "enrolled";
export type AdmissionFeeStatus = "unpaid" | "paid";

export type Category = "General" | "OBC" | "SC" | "ST" | "EWS";
export type Gender = "Male" | "Female" | "Other";
export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-" | "";

export interface AdmissionStudentInfo {
  name: string;
  dob: string;
  gender: Gender;
  bloodGroup: BloodGroup;
  aadhar: string;
  /** APAAR ID — the 12-digit national student ID under NEP 2020's
   *  "One Nation One Student ID" initiative. Optional at admission
   *  time since not every family has one generated yet. */
  apaarId: string;
  /** State-issued Permanent Enrollment Number (e.g. AP/Telangana SATS). */
  penId: string;
  category: Category;
  religion: string;
  nationality: string;
  previousSchool: string;
  tcNumber: string;
  lastClassPassed: string;
}

export interface AdmissionParentContact {
  name: string;
  phone: string;
  email: string;
  occupation: string;
  aadhar: string;
}

export interface AdmissionParentInfo {
  father: AdmissionParentContact;
  mother: AdmissionParentContact;
  annualIncome: string;
  siblingInSchool: boolean;
  siblingName: string;
  siblingClass: string;
}

export interface AdmissionAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pin: string;
}

export interface AdmissionAddressInfo {
  current: AdmissionAddress;
  permanent: AdmissionAddress;
}

export interface AdmissionDocuments {
  birthCertificate: boolean;
  tc: boolean;
  aadhar: boolean;
  photo: boolean;
  casteCertificate: boolean;
  incomeCertificate: boolean;
}

export interface AdmissionDetails {
  applyingForClass: string;
  sectionPreference: string;
  rollNo: string;
  admissionDate: string;
  remarks: string;
  /** Whether the family requested school transport at application time. */
  transportRequired: boolean;
  /** Set only when transportRequired is true. */
  transportRouteId: string;
  /** Set only when transportRequired is true. */
  transportStopName: string;
  documents: AdmissionDocuments;
}

export interface Admission {
  id: string;
  status: AdmissionStatus;
  /** Auto-generated at submission — every applicant gets one. */
  registrationNumber: string;
  /** Auto-generated at enrollment — undefined until status === "enrolled". */
  admissionNumber?: string;
  student: AdmissionStudentInfo;
  parent: AdmissionParentInfo;
  address: AdmissionAddressInfo;
  admission: AdmissionDetails;
  avatarColor: string;
  /** Only set when status === "rejected". */
  rejectionReason?: string;
  /** Only meaningful once status === "approved" or later. */
  feeStatus: AdmissionFeeStatus;
  /** Set once status === "enrolled" — links to the created Student. */
  studentId?: string;
}

/**
 * The editable subset the form submits — everything except id,
 * status, feeStatus, studentId, registrationNumber, and
 * admissionNumber, which the service/backend own.
 */
export type AdmissionInput = Pick<Admission, "student" | "parent" | "address" | "admission" | "avatarColor">;