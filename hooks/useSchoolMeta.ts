/**
 * --------------------------------------------------------------------
 * File:
 * hooks/useSchoolMeta.ts
 *
 * Purpose:
 * Loads school branding metadata (name/logo) for the given schoolId,
 * caching the result in sessionStorage so navigating between pages
 * costs 0 Firestore reads — only the first mount per browser session
 * hits Firestore.
 *
 * This is purely a UI-lifecycle optimization (minimizing reads), not
 * a business rule, which is why it lives in a hook rather than in
 * SchoolService.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { schoolService } from "@/services/school/schoolService";
import { SchoolMeta } from "@/types/school";

const CACHE_KEY_PREFIX = "edulink_school_meta_";

export function useSchoolMeta(schoolId: string | undefined) {
  const [school, setSchool] = useState<SchoolMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) {
      setSchool(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${CACHE_KEY_PREFIX}${schoolId}`;
    const cached = sessionStorage.getItem(cacheKey);

    if (cached) {
      try {
        setSchool(JSON.parse(cached) as SchoolMeta);
        setLoading(false);
        return;
      } catch {
        // Corrupted cache entry — fall through and refetch.
      }
    }

    let cancelled = false;
    setLoading(true);

    schoolService
      .getSchoolMeta(schoolId)
      .then((meta) => {
        if (cancelled) return;
        setSchool(meta);
        sessionStorage.setItem(cacheKey, JSON.stringify(meta));
      })
      .catch((error) => {
        console.error("Failed to load school meta:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  return { school, loading };
}
