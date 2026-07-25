/**
 * --------------------------------------------------------------------
 * File:
 * parent/otpService.ts
 *
 * Purpose:
 * Generates, stores, rate-limits, and verifies OTPs for parent
 * sign-in. This is the ONE place that owns OTP lifecycle — sendOtp.ts
 * and verifyOtp.ts (the callable functions) are thin wrappers around
 * this, same "Cloud Functions stay thin, services own logic" split
 * paymentGatewayService/connect.ts already established.
 *
 * Storage: top-level `otps/{phone}` (phone E.164, e.g. "+919876543210",
 * used directly as the doc ID — not school-scoped, since a parent's
 * phone is the identity key across every school they have a child in).
 *
 * Security model — the OTP itself is NEVER stored in plain text.
 * scrypt(otp, salt) is stored; verification re-derives the hash from
 * the submitted code and compares with crypto.timingSafeEqual (not
 * `===`, which leaks timing information about how many leading bytes
 * matched — irrelevant for a 6-digit space in practice, but it's the
 * correct primitive for comparing secrets and costs nothing to use).
 *
 * Rate limiting — this exists because sendOtp/verifyOtp are
 * necessarily UNAUTHENTICATED endpoints (a parent has no Firebase
 * session until after they verify an OTP, so `requireRole` cannot
 * gate them). Without limits here, anyone could SMS-bomb an arbitrary
 * phone number by hitting sendOtp repeatedly, or brute-force a 6-digit
 * OTP by hitting verifyOtp repeatedly. Both are bounded below.
 *
 * Responsibilities:
 * ✅ Generate a 6-digit OTP and hash it before storing
 * ✅ Enforce a resend cooldown and a rolling-window send cap per phone
 * ✅ Enforce a max-attempts cap per OTP before it's invalidated
 * ✅ Verify a submitted OTP against the stored hash
 *
 * Does NOT:
 * ❌ Talk to MSG91 directly (see providers/msg91Sms.ts, msg91WhatsApp.ts)
 * ❌ Create or look up a ParentAccount, or mint a Firebase custom
 *    token — that's the next phase (sign-in / account resolution).
 *    This service's job ends at "yes, this OTP is valid for this phone."
 * --------------------------------------------------------------------
 */

import * as crypto from "crypto";
import { db } from "../services/firebaseAdmin";
import { OtpChannel, OtpProvider } from "./providers/otpChannel";
import { msg91SmsProvider } from "./providers/msg91Sms";
import { msg91WhatsAppProvider } from "./providers/msg91WhatsApp";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between sends
const SEND_WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24h window
const MAX_SENDS_PER_WINDOW = 5; // per phone, per rolling 24h window
const MAX_VERIFY_ATTEMPTS = 5; // per OTP, before it's invalidated

const PROVIDERS: Record<OtpChannel, OtpProvider> = {
  sms: msg91SmsProvider,
  whatsapp: msg91WhatsAppProvider,
};

interface OtpRecord {
  otpHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  sendCount: number;
  windowStart: number;
  lastSentAt: number;
  channel: OtpChannel;
}

export type SendOtpResult =
  | { ok: true; expiresInSeconds: number }
  | { ok: false; error: string; retryAfterSeconds?: number };

export type VerifyOtpResult = { ok: true } | { ok: false; error: string };

function generateOtp(): string {
  // crypto.randomInt is cryptographically secure, unlike Math.random —
  // matters here since this IS the secret being protected.
  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return String(n).padStart(OTP_LENGTH, "0");
}

function hashOtp(otp: string, salt: string): string {
  return crypto.scryptSync(otp, salt, 64).toString("hex");
}

function otpDocRef(phone: string) {
  return db.collection("otps").doc(phone);
}

export class OtpService {
  /**
   * ----------------------------------------------------
   * Generates, stores, and sends a new OTP — subject to the cooldown
   * and rolling-window caps above. Returns a machine-readable reason
   * (not a raw HttpsError) so sendOtp.ts can decide how to surface it;
   * this service doesn't know it's being called from a Cloud Function.
   * ----------------------------------------------------
   */
  async sendOtp(phone: string, channel: OtpChannel): Promise<SendOtpResult> {
    const ref = otpDocRef(phone);
    const now = Date.now();

    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as OtpRecord) : null;

    if (existing) {
      const sinceLastSent = now - existing.lastSentAt;
      if (sinceLastSent < RESEND_COOLDOWN_MS) {
        return {
          ok: false,
          error: "Please wait before requesting another OTP.",
          retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLastSent) / 1000),
        };
      }

      const windowExpired = now - existing.windowStart > SEND_WINDOW_MS;
      if (!windowExpired && existing.sendCount >= MAX_SENDS_PER_WINDOW) {
        return {
          ok: false,
          error: "Too many OTP requests for this number. Try again later.",
          retryAfterSeconds: Math.ceil((existing.windowStart + SEND_WINDOW_MS - now) / 1000),
        };
      }
    }

    const otp = generateOtp();
    const salt = crypto.randomBytes(16).toString("hex");
    const otpHash = hashOtp(otp, salt);

    const windowStart = existing && now - existing.windowStart <= SEND_WINDOW_MS ? existing.windowStart : now;
    const sendCount = existing && now - existing.windowStart <= SEND_WINDOW_MS ? existing.sendCount + 1 : 1;

    // Send BEFORE committing the record — if MSG91 fails, we want the
    // old record (if any) left untouched rather than a fresh OTP the
    // parent never actually received sitting there consuming an
    // attempt/window slot for nothing.
    const provider = PROVIDERS[channel];
    await provider.sendOtp(phone, otp);

    const record: OtpRecord = {
      otpHash,
      salt,
      expiresAt: now + OTP_EXPIRY_MS,
      attempts: 0,
      sendCount,
      windowStart,
      lastSentAt: now,
      channel,
    };
    await ref.set(record);

    return { ok: true, expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000) };
  }

  /**
   * ----------------------------------------------------
   * Verifies a submitted OTP. On the MAX_VERIFY_ATTEMPTS-th wrong
   * guess, the record is deleted outright (not just marked exhausted)
   * — forces a fresh sendOtp call, which also re-engages the cooldown/
   * window limits above rather than leaving a guessable window open.
   * ----------------------------------------------------
   */
  async verifyOtp(phone: string, submittedOtp: string): Promise<VerifyOtpResult> {
    const ref = otpDocRef(phone);
    const snap = await ref.get();

    if (!snap.exists) {
      return { ok: false, error: "No OTP was requested for this number, or it has expired." };
    }

    const record = snap.data() as OtpRecord;
    const now = Date.now();

    if (now > record.expiresAt) {
      await ref.delete();
      return { ok: false, error: "This OTP has expired. Request a new one." };
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await ref.delete();
      return { ok: false, error: "Too many incorrect attempts. Request a new OTP." };
    }

    const submittedHash = hashOtp(submittedOtp, record.salt);
    const storedHashBuffer = Buffer.from(record.otpHash, "hex");
    const submittedHashBuffer = Buffer.from(submittedHash, "hex");

    const isMatch =
      storedHashBuffer.length === submittedHashBuffer.length &&
      crypto.timingSafeEqual(storedHashBuffer, submittedHashBuffer);

    if (!isMatch) {
      const attemptsRemaining = MAX_VERIFY_ATTEMPTS - (record.attempts + 1);
      if (attemptsRemaining <= 0) {
        await ref.delete();
        return { ok: false, error: "Too many incorrect attempts. Request a new OTP." };
      }
      await ref.update({ attempts: record.attempts + 1 });
      return { ok: false, error: `Incorrect OTP. ${attemptsRemaining} attempt(s) remaining.` };
    }

    // Correct — the OTP is single-use, so it's consumed here rather
    // than left valid for a second verify call within its expiry window.
    await ref.delete();
    return { ok: true };
  }
}

export const otpService = new OtpService();