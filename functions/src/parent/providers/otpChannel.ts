/**
 * --------------------------------------------------------------------
 * File:
 * parent/providers/otpChannel.ts
 *
 * Purpose:
 * The provider abstraction OtpService dispatches through. Two
 * channels (SMS, WhatsApp), both delivered via ONE MSG91 account
 * owned by EduLink itself — unlike the payment gateway, there is no
 * per-school "connect" flow here, so no equivalent of
 * paymentGatewayService's multi-tenant credential storage. One secret,
 * read the same way regardless of which school the parent belongs to.
 *
 * Why an interface instead of just calling msg91Sms directly?
 * OtpService shouldn't need to know or care which channel it's
 * dispatching to — it picks a provider by OtpChannel and calls
 * .send(), same shape either way. Adding a third channel later means
 * writing one new provider file, not touching OtpService's logic.
 *
 * Responsibilities:
 * ✅ Define the shape every OTP provider implements
 * ✅ Define the shared MSG91 credential shape both providers read
 *
 * Does NOT:
 * ❌ Talk to MSG91 itself (see msg91Sms.ts / msg91WhatsApp.ts)
 * ❌ Generate, hash, store, or rate-limit OTPs (see otpService.ts)
 * --------------------------------------------------------------------
 */

export type OtpChannel = "sms" | "whatsapp";

export interface OtpProvider {
  /**
   * Sends a 6-digit OTP to `phone` (E.164, e.g. "+919876543210").
   * Throws on any non-success response from MSG91 — OtpService
   * decides what to do with that failure (surface it to the caller),
   * this layer doesn't swallow or retry.
   */
  sendOtp(phone: string, otp: string): Promise<void>;
}

/**
 * -------------------------------------------------------
 * Single secret, ID "msg91-credentials", read via secretManager the
 * same way paymentGateway reads per-school credentials — just not
 * scoped to a school here. Set up once via `gcloud secrets` (or the
 * Secret Manager console), NOT through a callable function exposed to
 * schools — there's deliberately no "connect MSG91" endpoint, since
 * only EduLink itself ever configures this, never a school.
 *
 * ⚠️ smsOtpTemplateId MUST be a DLT-approved template whose variable
 * placeholder is named exactly `OTP` (i.e. the template text contains
 * `##OTP##`) — MSG91's Flow API matches the JSON key you send against
 * the template's registered variable name verbatim. A mismatch here
 * doesn't error at send time; MSG91 just silently fails to deliver
 * (this was flagged as the most common real-world MSG91 integration
 * bug during setup — worth re-confirming the exact variable name in
 * the MSG91 dashboard when the template is created, not assuming).
 * -------------------------------------------------------
 */
export interface Msg91Credentials {
  authKey: string;
  /** SMS sender ID (6 chars, DLT-registered), e.g. "EDULNK". */
  senderId: string;
  /** DLT-approved Flow template ID whose sole variable is named OTP. */
  smsOtpTemplateId: string;
  /** WhatsApp Business phone number ID connected to this MSG91 account. */
  whatsappIntegratedNumber: string;
  /** Approved WhatsApp template name (not the display text — the template's registered name). */
  whatsappTemplateName: string;
  /** WhatsApp template namespace, from the MSG91/WhatsApp Business dashboard. */
  whatsappNamespace: string;
  /** e.g. "en" — must match the template's registered language exactly. */
  whatsappLanguageCode: string;
}