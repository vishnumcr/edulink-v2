/**
 * --------------------------------------------------------------------
 * File:
 * services/admission/admissionService.ts
 *
 * Purpose:
 * Business logic for the Admission feature.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into well-formed Admission records
 * ✅ Validate a submitted application before persisting
 * ✅ Approve / reject an application
 * ✅ Enroll an approved application via the collectAdmissionFee Cloud
 *    Function — server-side validates the admission fee amount
 *    against Fee Structure, builds the invoice (tuition + transport,
 *    if requested + books + one-time/annual misc fees), creates the
 *    Student, and flips the admission to "enrolled", all in one
 *    transaction. See functions/src/collectAdmissionFee.ts.
 *
 * This used to compute the invoice and validate the payment amount
 * client-side, going straight through admissionRepository.enrollAdmission's
 * Firestore transaction — a real gap, since nothing stopped a modified
 * client from submitting a different payment amount than the school's
 * configured fee. It also silently omitted transport fees from the
 * enrollment invoice (the client-side calc never read
 * transportRequired/transportRouteId/transportStopName off the
 * admission, even though the Cloud Function always has). Both are
 * fixed by calling the Cloud Function instead — it already existed,
 * fully built and exported from functions/src/index.ts, and already
 * accounts for transport.
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Compute invoice amounts (that's the Cloud Function's job now —
 *    the client can't be trusted to compute its own bill)
 * --------------------------------------------------------------------
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { admissionRepository } from "@/repositories/admission/admissionRepository";
import {
  Admission,
  AdmissionAddressInfo,
  AdmissionDetails,
  AdmissionFeeStatus,
  AdmissionInput,
  AdmissionParentInfo,
  AdmissionStatus,
  AdmissionStudentInfo,
} from "@/types/admission";

export type { Admission, AdmissionInput };

export type AdmissionPaymentMode = "cash" | "upi" | "card" | "cheque" | "bank_transfer";

export interface CollectAdmissionFeePayment {
  amount: number;
  mode: AdmissionPaymentMode;
  referenceNumber?: string;
  note?: string;
}

export interface CollectAdmissionFeeRequest {
  admissionId: string;
  /** Required only when the school's admissionFee.isActive === true. */
  payment?: CollectAdmissionFeePayment;
}

export interface CollectAdmissionFeeResult {
  success: true;
  studentId: string;
  invoiceId: string;
  receiptId: string | null;
  admissionNumber: string;
  /**
   * One entry per parent with a phone on file (father/mother
   * independently). A parent-linking failure here does NOT mean
   * enrollment failed — the student/invoice were already created
   * successfully by this point; this just reports whether their
   * account was created/linked/failed, for staff-facing confirmation.
   */
  parentLinks: {
    relationship: "father" | "mother";
    result: { uid: string; eduLinkId: string; wasCreated: boolean } | null;
    error: string | null;
  }[];
}

function normalizeAdmission(id: string, data: Record<string, unknown>): Admission {
  return {
    id,
    status: ((data.status as AdmissionStatus) || "pending"),
    registrationNumber: (data.registrationNumber as string) || "",
    admissionNumber: data.admissionNumber as string | undefined,
    student: (data.student as AdmissionStudentInfo),
    parent: (data.parent as AdmissionParentInfo),
    address: (data.address as AdmissionAddressInfo),
    admission: (data.admission as AdmissionDetails),
    avatarColor: (data.avatarColor as string) || "#2563EB",
    rejectionReason: data.rejectionReason as string | undefined,
    feeStatus: ((data.feeStatus as AdmissionFeeStatus) || "unpaid"),
    studentId: data.studentId as string | undefined,
  };
}

export class AdmissionService {
  subscribeToAdmissions(
    schoolId: string,
    callback: (admissions: Admission[]) => void
  ): () => void {
    return admissionRepository.subscribeToAdmissions(schoolId, (docs) => {
      callback(docs.map((d) => normalizeAdmission(d.id, d.data)));
    });
  }

  filterByStatus(admissions: Admission[], status: AdmissionStatus): Admission[] {
    return admissions.filter((a) => a.status === status);
  }

  private validate(input: AdmissionInput): string | null {
    if (!input.student.name.trim()) return "Student name is required.";
    if (!input.student.dob) return "Date of birth is required.";
    if (!input.student.category) return "Category is required.";
    if (!input.parent.father.name.trim() && !input.parent.mother.name.trim())
      return "At least one parent name is required.";
    if (!input.parent.father.phone && !input.parent.mother.phone)
      return "At least one parent phone number is required.";
    if (!input.address.current.line1.trim()) return "Current address is required.";
    if (!input.address.current.city.trim()) return "City is required.";
    if (!input.address.current.pin.trim()) return "PIN code is required.";
    if (!input.admission.applyingForClass) return "Class applied for is required.";
    if (!input.admission.admissionDate) return "Admission date is required.";
    return null;
  }

  /**
   * ----------------------------------------------------
   * Submits an application. Writes ONLY the admissions document —
   * status starts "pending" (set by the repository), a registration
   * number is auto-assigned, and no Student is created here. This is
   * the fix for the admission page previously creating a live, active
   * Student on every submission regardless of review status.
   * ----------------------------------------------------
   */
  async submitAdmission(
    schoolId: string,
    input: AdmissionInput
  ): Promise<{ ok: true; admissionId: string; registrationNumber: string } | { ok: false; error: string }> {
    const error = this.validate(input);
    if (error) return { ok: false, error };

    const { admissionId, registrationNumber } = await admissionRepository.addAdmission(
      schoolId,
      input as unknown as Record<string, unknown>
    );
    return { ok: true, admissionId, registrationNumber };
  }

  async approveAdmission(schoolId: string, admissionId: string): Promise<void> {
    await admissionRepository.approveAdmission(schoolId, admissionId);
  }

  async rejectAdmission(schoolId: string, admissionId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!reason.trim()) return { ok: false, error: "A rejection reason is required." };
    await admissionRepository.rejectAdmission(schoolId, admissionId, reason.trim());
    return { ok: true };
  }

  /**
   * ----------------------------------------------------
   * Enrolls an approved application by calling the collectAdmissionFee
   * Cloud Function — see functions/src/collectAdmissionFee.ts for the
   * full transaction (admission fee validation, Student + Invoice +
   * Payment creation, admission number assignment).
   * ----------------------------------------------------
   */
  async collectAdmissionFee(
    schoolId: string,
    request: CollectAdmissionFeeRequest
  ): Promise<CollectAdmissionFeeResult> {
    const callable = httpsCallable<
      CollectAdmissionFeeRequest & { schoolId: string },
      CollectAdmissionFeeResult
    >(functions, "collectAdmissionFee");

    const response = await callable({ schoolId, ...request });
    return response.data;
  }
}

export const admissionService = new AdmissionService();