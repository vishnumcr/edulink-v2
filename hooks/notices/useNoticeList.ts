/**
 * --------------------------------------------------------------------
 * File:
 * hooks/notices/useNoticeList.ts
 *
 * Purpose:
 * Wraps noticesRepository.subscribeToNotices + noticesService.normalizeAll
 * behind a hook, so NoticesPage never touches Firestore or normalization
 * directly. Pure data-fetching — no search/filter logic here; that
 * stays a NoticesPage-level derivation so NoticeList/NoticeFilters stay
 * pure functions of already-filtered data (see the architecture doc
 * this was built from for why that split matters).
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { noticesRepository } from "@/repositories/notices/noticesRepository";
import { noticesService } from "@/services/notices/noticesService";
import { Notice } from "@/types/notice";

export function useNoticeList(schoolId: string | undefined) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) {
      setNotices([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = noticesRepository.subscribeToNotices(schoolId, (docs) => {
      setNotices(noticesService.normalizeAll(docs));
      setLoading(false);
    });

    return unsubscribe;
  }, [schoolId]);

  return { notices, loading };
}