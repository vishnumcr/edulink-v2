/**
 * --------------------------------------------------------------------
 * File:
 * hooks/notices/usePublishNotice.ts
 *
 * Purpose:
 * Wraps noticesService.publishNotice (the callable Cloud Function)
 * behind a hook, exposing the saving/error state NoticeComposerDrawer
 * needs without the drawer managing those flags itself.
 *
 * Used identically for BOTH "Save Draft" and "Publish Notice" — the
 * caller decides which by setting `status` in the input it passes;
 * this hook doesn't know or care which button triggered it.
 * --------------------------------------------------------------------
 */

"use client";

import { useState } from "react";
import { noticesService } from "@/services/notices/noticesService";
import { PublishNoticeInput, PublishNoticeResult } from "@/types/notice";

export function usePublishNotice() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function publish(input: PublishNoticeInput): Promise<PublishNoticeResult | null> {
    setSaving(true);
    setError("");
    try {
      const result = await noticesService.publishNotice(input);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish. Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { publish, saving, error, clearError: () => setError("") };
}