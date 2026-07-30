/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/notices/page.tsx
 *
 * Purpose:
 * Notices — master-detail layout (list + article-style detail) plus
 * a slide-over composer drawer. Rebuilt around the frozen backend
 * architecture: Admin -> publishNotice() [Cloud Function] -> Firestore.
 * This page NEVER writes to Firestore directly anymore — see
 * repositories/notices/noticesRepository.ts (read-only by design) and
 * NoticeComposerDrawer (calls usePublishNotice, which calls the
 * callable). See notices-architecture.md for the full component
 * breakdown this was built from.
 *
 * This file coordinates state only: which notice is selected, the
 * drawer's open/closed state, and search/filter values. Everything
 * else — data fetching, normalization, form state, the actual publish
 * call — lives in the hooks/services/components it composes.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useNoticeList } from "@/hooks/notices/useNoticeList";
import { noticesService } from "@/services/notices/noticesService";
import { classesRepository } from "@/repositories/academic/classesRepository";
import { NoticeSearch } from "@/components/notices/NoticeSearch";
import { NoticeFilters } from "@/components/notices/NoticeFilters";
import { NoticeList } from "@/components/notices/NoticeList";
import { NoticeDetail } from "@/components/notices/NoticeDetail";
import { NoticeComposerDrawer } from "@/components/notices/NoticeComposerDrawer";
import { TargetSelectorClassOption } from "@/components/notices/TargetSelector";
import { Notice, NoticePriority, NoticeType } from "@/types/notice";
import { AlertTriangle, Bell, Plus } from "lucide-react";
import "@/styles/notices.css";

export default function NoticesPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const { notices, loading } = useNoticeList(schoolId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<NoticeType | "all">("all");
  const [filterPriority, setFilterPriority] = useState<NoticePriority | "all">("all");

  const [classes, setClasses] = useState<TargetSelectorClassOption[]>([]);

  // Classes catalog for TargetSelector — fetched once here (the same
  // repository Timetable already uses), passed down through the
  // drawer rather than fetched inside TargetSelector itself.
  useEffect(() => {
    if (!schoolId) return;
    const unsubscribe = classesRepository.subscribeToClasses(schoolId, (docs) => {
      setClasses(
        docs.map((d) => ({
          id: d.id,
          className: (d.data.className as string) || "",
          sections: ((d.data.sections as { id: string; name: string }[]) || []).map((s) => ({
            id: s.id,
            name: s.name,
          })),
        }))
      );
    });
    return unsubscribe;
  }, [schoolId]);

  const filtered = useMemo(
    () => noticesService.filter(notices, { search, type: filterType, priority: filterPriority }),
    [notices, search, filterType, filterPriority]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<NoticeType, number> = { general: 0, academic: 0, event: 0, fee: 0, holiday: 0 };
    for (const n of notices) counts[n.type]++;
    return counts;
  }, [notices]);

  const urgentCount = useMemo(() => notices.filter((n) => n.priority === "urgent").length, [notices]);

  const selected: Notice | null = useMemo(
    () => notices.find((n) => n.id === selectedId) ?? null,
    [notices, selectedId]
  );

  return (
    <div className="ntc">
      {/* ══════════ LEFT PANEL ══════════ */}
      <aside className="ntc-left">
        <div className="ntc-topbar">
          <div className="ntc-topbar-row">
            <div className="ntc-heading">
              <div className="ntc-heading-icon">
                <Bell size={14} />
              </div>
              Notices
              {urgentCount > 0 && (
                <span className="ntc-urgent-chip">
                  <AlertTriangle size={9} /> {urgentCount} urgent
                </span>
              )}
            </div>
            <button className="ntc-post-btn" onClick={() => setDrawerOpen(true)}>
              <Plus size={13} /> Post Notice
            </button>
          </div>

          <NoticeSearch value={search} onChange={setSearch} />

          <NoticeFilters
            totalCount={notices.length}
            typeCounts={typeCounts}
            filterType={filterType}
            filterPriority={filterPriority}
            onTypeChange={setFilterType}
            onPriorityChange={setFilterPriority}
          />
        </div>

        <NoticeList
          notices={filtered}
          loading={loading}
          selectedId={selectedId}
          searchActive={!!search}
          onSelect={(notice) => setSelectedId(notice.id)}
          onPostNotice={() => setDrawerOpen(true)}
        />
      </aside>

      {/* ══════════ DETAIL PANEL ══════════ */}
      <NoticeDetail notice={selected} />

      {/* ══════════ DRAWER ══════════ */}
      {drawerOpen && schoolId && (
        <NoticeComposerDrawer
          schoolId={schoolId}
          classes={classes}
          onClose={() => setDrawerOpen(false)}
          onPublished={() => {
            /* useNoticeList's live listener picks up the new/changed
               doc automatically — nothing to manually refetch here. */
          }}
        />
      )}
    </div>
  );
}
