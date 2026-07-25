/**
 * --------------------------------------------------------------------
 * File:
 * parent/sendOtp.ts
 *
 * Purpose:
 * Entry point for requesting an OTP to sign in as a parent.
 *
 * ⚠️ Deliberately UNAUTHENTICATED — this is the one class of endpoint
 * in this codebase where requireRole (or any auth check) cannot apply:
 * a parent has no Firebase session until AFTER they verify an OTP, so
 * there's no auth to check yet. That's exactly why otpService's
 * cooldown/rolling-window rate limiting exists — this function is
 * genuinely open on the internet, and the rate limiting is the only
 * thing standing between it and being an SMS-bombing tool. Adding
 * Firebase App Check on the parent-facing client is the recommended
 * next hardening step (confirms the caller is a genuine app instance,
 * not just any HTTP client) — not implemented here since it requires
 * client-side setup in the separate parent-facing project, out of
 * this repo's reach.
 *
 * Responsibilities:
 * ✅ Validate and normalize the phone number
 * ✅ Validate the channel
 * ✅ Delegate to OtpService
 *
 * Does NOT:
 * ❌ Store secrets, talk to MSG91, or touch Firestore directly
 * --------------------------------------------------------------------
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";

import { normalizeIndianPhone } from "./identity";
import { otpService } from "./otpService";
import { OtpChannel } from "./providers/otpChannel";

const VALID_CHANNELS: OtpChannel[] = ["sms", "whatsapp"];

export const sendOtp = onCall(
  { region: "asia-south1" },
  async (request) => {
    const { phone, channel } = request.data ?? {};

    if (!phone || typeof phone !== "string") {
      throw new HttpsError("invalid-argument", "Phone number is required.");
    }

    const normalizedPhone = normalizeIndianPhone(phone);
    if (!normalizedPhone) {
      throw new HttpsError("invalid-argument", "Enter a valid 10-digit Indian mobile number.");
    }

    const resolvedChannel: OtpChannel = channel && VALID_CHANNELS.includes(channel) ? channel : "sms";

    const result = await otpService.sendOtp(normalizedPhone, resolvedChannel);

    if (!result.ok) {
      throw new HttpsError("resource-exhausted", result.error, {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    return { success: true, expiresInSeconds: result.expiresInSeconds };
  }
);