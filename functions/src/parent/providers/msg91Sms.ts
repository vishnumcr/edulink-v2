/**
 * --------------------------------------------------------------------
 * File:
 * parent/providers/msg91Sms.ts
 *
 * Purpose:
 * Sends an OTP via SMS through MSG91's Flow API.
 *
 * Endpoint confirmed against MSG91's own current documentation and a
 * second independent integration example (both agree on this exact
 * request shape) rather than assumed from memory:
 *   POST https://control.msg91.com/api/v5/flow
 *   headers: { authkey, "Content-Type": "application/json" }
 *   body: { template_id, recipients: [{ mobiles, <templateVarName>: value }] }
 *
 * mobiles is the phone number WITHOUT the leading "+" (MSG91's
 * convention is a bare country-code-prefixed number, e.g.
 * "919876543210", not "+919876543210") — this file does that
 * stripping so nothing upstream needs to know about it.
 *
 * Responsibilities:
 * ✅ Format the MSG91 Flow API request and send it
 * ✅ Throw on any non-success response
 *
 * Does NOT:
 * ❌ Know anything about rate limiting, hashing, or storage (otpService.ts)
 * ❌ Retry on failure — a failed send should surface immediately so
 *    the caller can tell the parent "SMS failed, try again"
 * --------------------------------------------------------------------
 */

import { secretManager } from "../../services/secretManager";
import { Msg91Credentials, OtpProvider } from "./otpChannel";

const FLOW_API_URL = "https://control.msg91.com/api/v5/flow";
const SECRET_ID = "msg91-credentials";

interface Msg91FlowResponse {
  type: string;
  message?: string;
}

export class Msg91SmsProvider implements OtpProvider {
  async sendOtp(phone: string, otp: string): Promise<void> {
    const credentials = await secretManager.getSecret<Msg91Credentials>(SECRET_ID);

    const mobileNoPlus = phone.replace("+", "");

    const response = await fetch(FLOW_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: credentials.authKey,
      },
      body: JSON.stringify({
        template_id: credentials.smsOtpTemplateId,
        sender: credentials.senderId,
        short_url: "0",
        recipients: [
          {
            mobiles: mobileNoPlus,
            // Key name must match the DLT template's registered
            // variable exactly — see the ⚠️ note on Msg91Credentials.
            OTP: otp,
          },
        ],
      }),
    });

    const result = (await response.json()) as Msg91FlowResponse;

    if (!response.ok || result.type !== "success") {
      throw new Error(`MSG91 SMS send failed: ${result.message || `HTTP ${response.status}`}`);
    }
  }
}

export const msg91SmsProvider = new Msg91SmsProvider();