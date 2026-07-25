/**
 * ------------------------------------------------------------------
 * File:
 * services/secretManager.ts
 *
 * Purpose:
 * Centralized service for interacting with Google Secret Manager.
 *
 * Why?
 * Instead of every module talking directly to Google Secret Manager,
 * they all use this service.
 *
 * Used By:
 * - Payment Gateway
 * - WhatsApp
 * - SMTP
 * - SMS
 * - Future third-party integrations
 *
 * Responsibilities:
 * ✅ Create a secret
 * ✅ Update an existing secret (new version)
 * ✅ Read the latest secret
 *
 * Does NOT:
 * ❌ Know anything about Razorpay
 * ❌ Know anything about PhonePe
 * ❌ Know anything about Firestore
 * ------------------------------------------------------------------
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

export class SecretManagerService {

  /**
   * Google Cloud Project ID.
   * Automatically available inside Cloud Functions.
   */
  private readonly projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;

  /**
   * Creates a new secret if it doesn't exist.
   * If it already exists, a new secret version is added.
   */
  async createOrUpdateSecret(
    secretId: string,
    payload: unknown
  ): Promise<void> {

    if (!this.projectId) {
      throw new Error("Google Cloud Project ID not found.");
    }

    const parent = `projects/${this.projectId}`;
    const secretName = `${parent}/secrets/${secretId}`;

    const secretPayload = Buffer.from(
      JSON.stringify(payload),
      "utf8"
    );

    try {

      // Check whether the secret already exists.
      await client.getSecret({
        name: secretName,
      });

    } catch {

      // Secret doesn't exist.
      // Create it.
      await client.createSecret({
        parent,
        secretId,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });

    }

    // Every update becomes a NEW version.
    await client.addSecretVersion({
      parent: secretName,
      payload: {
        data: secretPayload,
      },
    });

  }

  /**
   * Reads the latest version of a secret.
   */
  async getSecret<T>(
    secretId: string
  ): Promise<T> {

    if (!this.projectId) {
      throw new Error("Google Cloud Project ID not found.");
    }

    const [version] =
      await client.accessSecretVersion({

        name:
          `projects/${this.projectId}/secrets/${secretId}/versions/latest`

      });

    const payload =
      version.payload?.data?.toString() ?? "{}";

    return JSON.parse(payload) as T;

  }

}

export const secretManager =
  new SecretManagerService();