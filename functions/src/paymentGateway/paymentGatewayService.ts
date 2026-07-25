/**
 * --------------------------------------------------------------------
 * File:
 * paymentGateway/paymentGatewayService.ts
 *
 * Purpose:
 * Business logic for connecting a school's payment gateway.
 *
 * Responsibilities:
 * ✔ Verify provider credentials
 * ✔ Store secrets securely
 * ✔ Save public metadata in Firestore
 *
 * Does NOT:
 * ✘ Authenticate users
 * ✘ Receive HTTP requests
 * ✘ Know how Razorpay internally works
 *
 * Called By:
 * paymentGateway/connect.ts
 * --------------------------------------------------------------------
 */

import { FieldValue } from "firebase-admin/firestore";

import { db } from "../services/firebaseAdmin";
import { secretManager } from "../services/secretManager";
import { razorpayProvider } from "./providers/razorpay";

export class PaymentGatewayService {

  /**
   * Connect a school's payment gateway.
   */
  async connect(data: {
    schoolId: string;
    provider: string;
    keyId: string;
    keySecret: string;
    webhookSecret?: string;
  }) {

    //----------------------------------------------------
    // STEP 1
    // Verify credentials BEFORE storing anything.
    //----------------------------------------------------
    switch (data.provider) {

      case "razorpay":

        await razorpayProvider.verifyCredentials(
          data.keyId,
          data.keySecret
        );

        break;

      default:

        throw new Error(
          `Unsupported payment provider: ${data.provider}`
        );

    }

    //----------------------------------------------------
    // STEP 2
    // Generate a unique secret name.
    //----------------------------------------------------
    const secretName =
      `edulink-school-${data.schoolId}-${data.provider}`;

    //----------------------------------------------------
    // STEP 3
    // Store sensitive credentials.
    //----------------------------------------------------
    await secretManager.createOrUpdateSecret(
      secretName,
      {

        provider: data.provider,

        keyId: data.keyId,

        keySecret: data.keySecret,

        webhookSecret: data.webhookSecret ?? ""

      }
    );

    //----------------------------------------------------
    // STEP 4
    // Store ONLY public information in Firestore.
    //----------------------------------------------------
    await db
      .collection("schools")
      .doc(data.schoolId)
      .collection("config")
      .doc("paymentGateway")
      .set({

        enabled: true,

        connected: true,

        provider: data.provider,

        keyId: data.keyId,

        connectedAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp()

      }, { merge: true });

    //----------------------------------------------------
    // STEP 5
    // Return success.
    //----------------------------------------------------
    return {

      success: true,

      provider: data.provider,

      message: "Payment gateway connected successfully."

    };

  }

}

export const paymentGatewayService =
  new PaymentGatewayService();