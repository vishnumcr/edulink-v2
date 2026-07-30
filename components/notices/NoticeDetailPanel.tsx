/**
 * components/notices/NoticeDetailPanel.tsx
 *
 * Full article rendering for one notice: editorial header, priority alert,
 * paragraph-mapped typography, attachments slot, document metadata, and 
 * an official sign-off block.
 */
"use client";

import { BookOpen, Calendar, Clock, Paperclip, Pin, Users, ShieldCheck } from "lucide-react";
import { Notice } from "@/types/notice";
import { 
  PRIORITY_META, 
  TYPE_META, 
  STATUS_META, 
  timeAgo, 
  fullDate, 
  scheduledLabel, 
  targetSummary 
} from "@/services/notices/noticesService";

interface NoticeDetailPanelProps {
  notice: Notice;
}

export function NoticeDetailPanel({ notice }: NoticeDetailPanelProps) {
  const pri = PRIORITY_META[notice.priority];
  const type = TYPE_META[notice.type];
  const status = STATUS_META[notice.status];
  const PriIcon = pri.icon;
  const StatusIcon = status.icon;
  const target = targetSummary(notice.targets);

  // Safely check for attachments without breaking strict type compilation if not yet on Notice interface
  const attachments = (notice as { attachments?: Array<{ name: string; url: string; size?: string }> }).attachments || [];

  return (
    <article className="ntc-circular">
      {/* 1. Editorial Header */}
      <header className="ntc-circular-header">
        <div className="ntc-circular-eyebrow">
          <span 
            className="ntc-cat-badge" 
            style={{ background: type.bg, color: type.color, borderColor: type.border }}
          >
            {type.emoji} {type.label}
          </span>
        </div>

        <div className="ntc-title-row">
          {notice.isPinned && (
            <Pin size={20} className="ntc-pin-icon" fill="currentColor" aria-label="Pinned Notice" />
          )}
          <h1 className="ntc-title">{notice.title}</h1>
        </div>

        <div className="ntc-meta-strip">
          <div className="ntc-meta-item">
            <Clock size={13} className="ntc-meta-icon" />
            <span title={notice.status === "scheduled" ? scheduledLabel(notice.publishAt) : fullDate(notice.createdAt)}>
              {notice.status === "scheduled" ? scheduledLabel(notice.publishAt) : timeAgo(notice.createdAt)}
            </span>
          </div>
          <span className="ntc-meta-bullet">•</span>
          <div className="ntc-meta-item">
            <BookOpen size={13} className="ntc-meta-icon" />
            <span>
              {notice.publishByName}
              {notice.publishByRole ? ` · ${notice.publishByRole}` : ""}
            </span>
          </div>
          <span className="ntc-meta-bullet">•</span>
          <div className="ntc-meta-item" title={target.detail}>
            <Users size={13} className="ntc-meta-icon" />
            <span>{target.label}</span>
          </div>
        </div>
      </header>

      <hr className="ntc-divider" />

      {/* 2. Priority Alert Banner (Only for Urgent/Important) */}
      {notice.priority !== "normal" && (
        <>
          <div className="ntc-alert-box" style={{ background: pri.bg, borderColor: pri.border }}>
            <div className="ntc-alert-icon" style={{ color: pri.color }}>
              <PriIcon size={20} />
            </div>
            <div className="ntc-alert-content">
              <h2 className="ntc-alert-title" style={{ color: pri.color }}>
                {pri.label} Notice
              </h2>
              <p className="ntc-alert-desc" style={{ color: pri.color }}>
                {notice.priority === "urgent"
                  ? "This announcement requires immediate attention and action from all designated recipients."
                  : "Please read and acknowledge the operational updates detailed below."}
              </p>
            </div>
          </div>
          <hr className="ntc-divider" />
        </>
      )}

      {/* 3. Body Content (Paragraph-mapped for document rhythm) */}
      <section className="ntc-body">
        {notice.message.split("\n").map((paragraph, index) =>
          paragraph.trim() ? (
            <p key={index} className="ntc-body-p">
              {paragraph}
            </p>
          ) : (
            <div key={index} className="ntc-body-spacer" />
          )
        )}
      </section>

      <hr className="ntc-divider" />

      {/* 4. Attachments Section */}
      <section className="ntc-section">
        <h3 className="ntc-section-title">
          <Paperclip size={14} className="ntc-section-icon" /> Attachments
        </h3>
        {attachments.length > 0 ? (
          <div className="ntc-attachment-list">
            {attachments.map((file, i) => (
              <a key={i} href={file.url} target="_blank" rel="noopener noreferrer" className="ntc-attachment-item">
                <span className="ntc-attachment-name">{file.name}</span>
                {file.size && <span className="ntc-attachment-size">({file.size})</span>}
              </a>
            ))}
          </div>
        ) : (
          <div className="ntc-empty-state">No attachments provided for this circular.</div>
        )}
      </section>

      <hr className="ntc-divider" />

      {/* 5. Document Information Footer */}
      <section className="ntc-section">
        <h3 className="ntc-section-title">Document Information</h3>
        <div className="ntc-doc-grid">
          <div className="ntc-doc-cell">
            <span className="ntc-doc-label">Posted Date</span>
            <span className="ntc-doc-val">
              <Calendar size={14} className="ntc-doc-icon" />
              {notice.createdAt
                ? new Date(notice.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </span>
          </div>
          <div className="ntc-doc-cell">
            <span className="ntc-doc-label">Target Audience</span>
            <span className="ntc-doc-val" title={target.detail}>
              <Users size={14} className="ntc-doc-icon" />
              {target.label}
            </span>
          </div>
          <div className="ntc-doc-cell">
            <span className="ntc-doc-label">Publication Status</span>
            <span className="ntc-doc-val" style={{ color: status.color }}>
              <StatusIcon size={14} className="ntc-doc-icon" />
              {status.label}
            </span>
          </div>
          <div className="ntc-doc-cell">
            <span className="ntc-doc-label">Priority Level</span>
            <span className="ntc-doc-val" style={{ color: pri.color }}>
              <PriIcon size={14} className="ntc-doc-icon" />
              {pri.label}
            </span>
          </div>
        </div>
      </section>

      <hr className="ntc-divider" />

      {/* 6. Official Sign-off / Attribution */}
      <footer className="ntc-signoff">
        <div className="ntc-signoff-badge">
          <ShieldCheck size={24} className="ntc-signoff-icon" />
        </div>
        <div className="ntc-signoff-text">
          <div className="ntc-signoff-label">Issued By Authority Of</div>
          <div className="ntc-signoff-author">{notice.publishByName}</div>
          <div className="ntc-signoff-role">
            {notice.publishByRole || "Authorized Administrator"} · Administration
          </div>
        </div>
      </footer>
    </article>
  );
}