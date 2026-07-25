/**
 * --------------------------------------------------------------------
 * File:
 * parent/providers/msg91WhatsApp.ts
 *
 * Purpose:
 * Sends an OTP via WhatsApp through MSG91's WhatsApp Business API.
 *
 * Endpoint and body shape taken directly from MSG91's own official
 * WhatsApp OTP documentation (highest-confidence source available —
 * their docs page for this exact use case, not a third-party example):
 *   POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/
 *   headers: { authkey, "Content-Type": "application/json" }
 *   body: { integrated_number, content_type: "template", payload: {...} }
 *
 * WhatsApp template approval is a SEPARATE process from SMS's DLT
 * registration — a WhatsApp Business template with the same visible
 * text as the SMS template still needs its own approval and has its
 * own name/namespace, configured independently in Msg91Credentials.
 *
 * Responsibilities:
 * ✅ Format the MSG91 WhatsApp template-message request and send it
 * ✅ Throw on any non-success response
 *
 * Does NOT:
 * ❌ Know anything about rate limiting, hashing, or storage (otpService.ts)
 * ❌ Assume the template has a "copy code" button — only the body
 *    variable is sent; add a components.button_1 block here if/when
 *    the approved template actually has one
 * --------------------------------------------------------------------
 */

import { secretManager } from "../../services/secretManager";
import { Msg91Credentials, OtpProvider } from "./otpChannel";

const WHATSAPP_API_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const SECRET_ID = "msg91-credentials";

interface Msg91WhatsAppResponse {
  status?: string;
  message?: string;
}

export class Msg91WhatsAppProvider implements OtpProvider {
  async sendOtp(phone: string, otp: string): Promise<void> {
    const credentials = await secretManager.getSecret<Msg91Credentials>(SECRET_ID);

    const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: credentials.authKey,
      },
      body: JSON.stringify({
        integrated_number: credentials.whatsappIntegratedNumber,
        content_type: "template",
        payload: {
          messaging_product: "whatsapp",
          type: "template",
          template: {
            name: credentials.whatsappTemplateName,
            language: { code: credentials.whatsappLanguageCode, policy: "deterministic" },
            namespace: credentials.whatsappNamespace,
            to_and_components: [
              {
                to: [phone.replace("+", "")],
                components: {
                  body_1: { type: "text", value: otp },
                },
              },
            ],
          },
        },
      }),
    });

    const result = (await response.json()) as Msg91WhatsAppResponse;

    if (!response.ok || result.status === "error") {
      throw new Error(`MSG91 WhatsApp send failed: ${result.message || `HTTP ${response.status}`}`);
    }
  }
}

export const msg91WhatsAppProvider = new Msg91WhatsAppProvider();