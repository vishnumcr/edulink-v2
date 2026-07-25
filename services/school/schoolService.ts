/**
 * --------------------------------------------------------------------
 * File:
 * services/school/schoolService.ts
 *
 * Purpose:
 * Business logic for school data — both the lightweight branding
 * subset (used by the Sidebar) and the full settings profile.
 *
 * Responsibilities:
 * ✅ Fetch school meta/profile via the repository, with defaults
 * ✅ Strip read-only fields (plan/status/joined) before saving,
 *    even if a caller accidentally includes them
 * ✅ Validate and convert a logo upload before handing it to the
 *    repository
 *
 * Does NOT:
 * ❌ Call Firestore/Storage directly
 * ❌ Cache results (that's the hook's job, since caching is a
 *    UI-lifecycle concern, not a business rule)
 * --------------------------------------------------------------------
 */

import { schoolRepository } from "@/repositories/school/schoolRepository";
import { convertToWebP } from "@/utils/image";
import { EditableSchoolFields, SchoolMeta, SchoolProfile } from "@/types/school";

const DEFAULT_SCHOOL_META: SchoolMeta = {
  name: "School",
  logoUrl: "",
};

const DEFAULT_SCHOOL_PROFILE: SchoolProfile = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  principalName: "",
  currentAcademicYear: "",
  logoUrl: "",
  plan: "",
  status: "",
  joined: "",
};

const ALLOWED_LOGO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;

export class SchoolService {
  /**
   * ----------------------------------------------------
   * Returns school branding metadata, always populated
   * with sensible defaults even if fields are missing or
   * the document doesn't exist.
   * ----------------------------------------------------
   */
  async getSchoolMeta(schoolId: string): Promise<SchoolMeta> {
    const raw = await schoolRepository.getSchoolMeta(schoolId);

    return {
      name: raw?.name || DEFAULT_SCHOOL_META.name,
      logoUrl: raw?.logoUrl || DEFAULT_SCHOOL_META.logoUrl,
    };
  }

  /**
   * ----------------------------------------------------
   * Returns the full school profile for the settings form,
   * defaulted so every field is a usable string.
   * ----------------------------------------------------
   */
  async getSchoolProfile(schoolId: string): Promise<SchoolProfile> {
    const raw = await schoolRepository.getSchoolProfile(schoolId);
    return { ...DEFAULT_SCHOOL_PROFILE, ...raw };
  }

  /**
   * ----------------------------------------------------
   * Save the editable school profile fields.
   *
   * Explicitly destructures only the editable fields before
   * writing, so plan/status/joined can never be overwritten from
   * this form, even if a caller passes a full SchoolProfile object.
   * ----------------------------------------------------
   */
  async saveSchoolProfile(schoolId: string, data: EditableSchoolFields): Promise<void> {
    const {
      name, email, phone, address, city, state,
      principalName, currentAcademicYear, logoUrl,
    } = data;

    await schoolRepository.updateSchoolProfile(schoolId, {
      name, email, phone, address, city, state,
      principalName, currentAcademicYear, logoUrl,
    });
  }

  /**
   * ----------------------------------------------------
   * Validate, convert, and upload a new school logo.
   * Throws a friendly error for invalid file type/size.
   * ----------------------------------------------------
   */
  async uploadLogo(
    schoolId: string,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<string> {
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      throw new Error("Only JPG, PNG, WebP, GIF or BMP images are allowed.");
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      throw new Error("Image must be under 5 MB.");
    }

    const webpBlob = await convertToWebP(file);
    return schoolRepository.uploadLogo(schoolId, webpBlob, onProgress);
  }
}

export const schoolService = new SchoolService();