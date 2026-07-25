/**
 * --------------------------------------------------------------------
 * File:
 * parent/verifyOtp.ts
 *
 * Purpose:
 * Entry point for verifying an OTP during parent sign-in.
 *
 * ⚠️ Deliberately UNAUTHENTICATED, same reasoning as sendOtp.ts —
 * verifying IS the act of authenticating, so there's no session to
 * require yet. otpService's per-OTP attempt cap is what prevents this
 * from being a brute-force oracle against the 6-digit code space.
 *
 * Scope boundary for this phase: this function returns ONLY whether
 * the OTP was valid. It does NOT look up or create a ParentAccount,
 * and does NOT mint a Firebase custom token for the parent to actually
 * sign in with — that's the next phase (sign-in / account resolution).
 * Returning `{ ok: true }` here proves phone ownership; turning that
 * into an actual signed-in session is separate, deliberately-deferred
 * work, not an oversight.
 *
 * Responsibilities:
 * ✅ Validate and normalize the phone number
 * ✅ Validate the submitted OTP shape
 * ✅ Delegate to OtpService
 *
 * Does NOT:
 * ❌ Touch ParentAccount / users/{uid} documents
 * ❌ Call admin.auth().createCustomToken()
 * --------------------------------------------------------------------
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";

import { normalizeIndianPhone } from "./identity";
import { otpService } from "./otpService";

export const verifyOtp = onCall(
  { region: "asia-south1" },
  async (request) => {
    const { phone, otp } = request.data ?? {};

    if (!phone || typeof phone !== "string") {
      throw new HttpsError("invalid-argument", "Phone number is required.");
    }
    if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      throw new HttpsError("invalid-argument", "Enter the 6-digit OTP.");
    }

    const normalizedPhone = normalizeIndianPhone(phone);
    if (!normalizedPhone) {
      throw new HttpsError("invalid-argument", "Enter a valid 10-digit Indian mobile number.");
    }

    const result = await otpService.verifyOtp(normalizedPhone, otp);

    if (!result.ok) {
      throw new HttpsError("permission-denied", result.error);
    }

    return { success: true };
  }
);