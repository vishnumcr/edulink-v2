/**
 * -------------------------------------------------------------------
 * File:
 * paymentGateway/connect.ts
 *
 * Purpose:
 * Entry point for connecting a school's payment gateway.
 *
 * Responsibilities:
 * ✅ Authenticate caller
 * ✅ Verify the user is a school admin
 * ✅ Validate request payload
 * ✅ Delegate business logic to PaymentGatewayService
 *
 * Does NOT:
 * ❌ Store secrets
 * ❌ Talk directly to Firestore
 * ❌ Call Razorpay APIs
 *
 * Why?
 * Cloud Functions should stay thin.
 * Business logic belongs inside services.
 * -------------------------------------------------------------------
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";

import { requireRole } from "../auth/requireRole";
import { paymentGatewayService } from "./paymentGatewayService";

export const connectPaymentGateway = onCall(
    {
    region: "asia-south1",
  },async (request) => {

    // ------------------------------------------------------------
    // Step 1
    // Verify the caller is authenticated
    // and has the Admin role.
    // ------------------------------------------------------------
    const admin = await requireRole(request, "admin");

    // ------------------------------------------------------------
    // Step 2
    // Read data sent by the frontend.
    // ------------------------------------------------------------
    const {
        provider,
        keyId,
        keySecret,
        webhookSecret
    } = request.data;

    // ------------------------------------------------------------
    // Step 3
    // Basic validation.
    // More provider-specific validation
    // will happen inside the service.
    // ------------------------------------------------------------
    if (!provider) {
        throw new HttpsError(
            "invalid-argument",
            "Provider is required."
        );
    }

    if (!keyId) {
        throw new HttpsError(
            "invalid-argument",
            "Key ID is required."
        );
    }

    if (!keySecret) {
        throw new HttpsError(
            "invalid-argument",
            "Key Secret is required."
        );
    }

    // ------------------------------------------------------------
    // Step 4
    // Delegate all business logic.
    // ------------------------------------------------------------
    return await paymentGatewayService.connect({

        schoolId: admin.schoolId,

        provider,

        keyId,

        keySecret,

        webhookSecret

    });

});