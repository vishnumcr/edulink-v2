/**
 * components/notices/NoticeDetail.tsx
 *
 * Container: shows the empty "select a notice" placeholder, or
 * delegates to NoticeDetailPanel when one is selected. Keeps
 * NoticeDetailPanel a pure "given a Notice, render it" component with
 * no null-checking inside it.
 */
"use client";

import { Bell } from "lucide-react";
import { Notice } from "@/types/notice";
import { NoticeDetailPanel } from "./NoticeDetailPanel";

interface NoticeDetailProps {
  notice: Notice | null;
}

export function NoticeDetail({ notice }: NoticeDetailProps) {
  return (
    <div className="ntc-detail">
      {!notice ? (
        <div className="ntc-detail-ph">
          <div className="ntc-detail-ph-ring">
            <Bell size={24} />
          </div>
          <p>Select a notice to read</p>
        </div>
      ) : (
        <NoticeDetailPanel notice={notice} />
      )}
    </div>
  );
}
