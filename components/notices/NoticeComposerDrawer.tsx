/**
 * components/notices/NoticeComposerDrawer.tsx
 *
 * The slide-over shell: header, footer with Save Draft / Publish
 * Notice, Esc-to-close. Owns its own internal form state entirely —
 * nothing outside this component ever needs title/message/targets/etc
 * mid-edit. Calls usePublishNotice() on submit; has zero Firestore
 * logic itself, per the architecture's "Handles UI only" rule.
 *
 * Save Draft and Publish Notice are the SAME call (usePublishNotice().publish)
 * with a different `status` in the input — not two endpoints, not a
 * checkbox. See usePublishNotice's own header for why.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Paperclip,
  Pin,
  Send,
  X,
} from "lucide-react";
import { usePublishNotice } from "@/hooks/notices/usePublishNotice";
import { TargetSelector, TargetSelectorClassOption } from "./TargetSelector";
import { NoticePriority, NoticeTargetRule, NoticeType } from "@/types/notice";
import { PRIORITY_META, TYPE_META } from "@/services/notices/noticesService";

const MAX_MESSAGE = 1000;

interface ComposerForm {
  title: string;
  message: string;
  targets: NoticeTargetRule[];
  type: NoticeType;
  priority: NoticePriority;
  isPinned: boolean;
  publishAtLocal: string; // <input type="datetime-local"> value; "" = immediate
  expiresAtLocal: string; // <input type="date"> value; "" = no expiry
}

const EMPTY_FORM: ComposerForm = {
  title: "",
  message: "",
  targets: [],
  type: "general",
  priority: "normal",
  isPinned: false,
  publishAtLocal: "",
  expiresAtLocal: "",
};

interface NoticeComposerDrawerProps {
  schoolId: string;
  classes: TargetSelectorClassOption[];
  onClose: () => void;
  onPublished: () => void;
}

export function NoticeComposerDrawer({ schoolId, classes, onClose, onPublished }: NoticeComposerDrawerProps) {
  const [form, setForm] = useState<ComposerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [justSaved, setJustSaved] = useState<"draft" | "published" | null>(null);
  const { publish, saving, error: publishError, clearError } = usePublishNotice();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    },
    [saving, onClose]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function update<K extends keyof ComposerForm>(key: K, value: ComposerForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError("");
    clearError();
  }

  function validate(): string | null {
    if (!form.title.trim()) return "Title is required.";
    if (!form.message.trim()) return "Message is required.";
    if (form.message.length > MAX_MESSAGE) return `Message must be under ${MAX_MESSAGE} characters.`;
    if (form.targets.length === 0) return "Select at least one audience.";
    return null;
  }

  async function handleSubmit(status: "draft" | "published") {
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const result = await publish({
      schoolId,
      title: form.title,
      message: form.message,
      targets: form.targets,
      status,
      priority: form.priority,
      type: form.type,
      isPinned: form.isPinned,
      publishAt: form.publishAtLocal ? new Date(form.publishAtLocal).getTime() : null,
      expiresAt: form.expiresAtLocal ? new Date(form.expiresAtLocal).getTime() : null,
    });

    if (result) {
      setJustSaved(status === "draft" ? "draft" : result.status === "scheduled" ? "draft" : "published");
      onPublished();
      setTimeout(() => {
        onClose();
      }, 700);
    }
  }

  const messageChars = form.message.length;

  return (
    <div className="ntc-overlay">
      <div className="ntc-backdrop" onClick={() => !saving && onClose()} />
      <div className="ntc-drawer" role="dialog" aria-modal="true" aria-label="Post Notice">
        <div className="ntc-drawer-head">
          <div>
            <h2>Post Notice</h2>
            <p>Notify students, parents &amp; teachers instantly</p>
          </div>
          <button className="ntc-drawer-close" onClick={() => !saving && onClose()} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="ntc-drawer-body">
          {(formError || publishError) && (
            <div className="ntc-error">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {formError || publishError}
            </div>
          )}

          <div className="ntc-section-label">Content</div>

          <div className="ntc-field">
            <label className="ntc-label">
              Title <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input
              className="ntc-input"
              placeholder="e.g. School closed on Friday"
              value={form.title}
              maxLength={120}
              onChange={(e) => update("title", e.target.value)}
            />
          </div>

          <div className="ntc-field">
            <label className="ntc-label">
              Message <span style={{ color: "#EF4444" }}>*</span>
              <span className={`ntc-label-hint${messageChars > MAX_MESSAGE * 0.9 ? " ntc-char-count warn" : ""}`}>
                {messageChars}/{MAX_MESSAGE}
              </span>
            </label>
            <textarea
              className="ntc-input ntc-textarea"
              placeholder="Write the full notice here…"
              value={form.message}
              maxLength={MAX_MESSAGE}
              onChange={(e) => update("message", e.target.value)}
            />
          </div>

          <div className="ntc-section-label">Target Audience</div>

          <TargetSelector value={form.targets} onChange={(targets) => update("targets", targets)} classes={classes} />

          <div className="ntc-section-label">Notice Type</div>

          <div className="ntc-field">
            <select className="ntc-select" value={form.type} onChange={(e) => update("type", e.target.value as NoticeType)}>
              {(Object.entries(TYPE_META) as [NoticeType, (typeof TYPE_META)[NoticeType]][]).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.emoji} {meta.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ntc-field">
            <label className="ntc-label">Attachments</label>
            <div className="ntc-attach-placeholder">
              <Paperclip size={14} />
              Attach files (coming soon)
            </div>
          </div>

          <button
            type="button"
            className={`ntc-advanced-toggle${advancedOpen ? " open" : ""}`}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            Advanced <ChevronDown size={12} />
          </button>

          {advancedOpen && (
            <div className="ntc-advanced-body">
              <div className="ntc-field">
                <label className="ntc-label">Priority</label>
                <div className="ntc-priority-row">
                  {(Object.entries(PRIORITY_META) as [NoticePriority, (typeof PRIORITY_META)[NoticePriority]][]).map(
                    ([key, meta]) => {
                      const active = form.priority === key;
                      const Icon = meta.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          className="ntc-priority-opt"
                          style={{
                            background: active ? meta.bg : "#F8FAFC",
                            borderColor: active ? meta.stripe : "#E2E8F0",
                            color: active ? meta.color : "#94A3B8",
                          }}
                          onClick={() => update("priority", key as NoticePriority)}
                        >
                          <Icon size={12} /> {meta.label}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="ntc-pin-row">
                <div className="ntc-pin-row-label">
                  <Pin size={14} /> Pin Notice
                </div>
                <button
                  type="button"
                  className={`ntc-toggle-switch${form.isPinned ? " on" : ""}`}
                  onClick={() => update("isPinned", !form.isPinned)}
                  aria-label="Pin notice"
                />
              </div>

              <div className="ntc-field">
                <label className="ntc-label">
                  Schedule Publish <span className="ntc-label-hint">optional — leave blank to publish immediately</span>
                </label>
                <input
                  type="datetime-local"
                  className="ntc-input"
                  value={form.publishAtLocal}
                  onChange={(e) => update("publishAtLocal", e.target.value)}
                />
              </div>

              <div className="ntc-field">
                <label className="ntc-label">
                  Expiry <span className="ntc-label-hint">optional</span>
                </label>
                <input
                  type="date"
                  className="ntc-input"
                  value={form.expiresAtLocal}
                  onChange={(e) => update("expiresAtLocal", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="ntc-drawer-foot">
          <div className="ntc-drawer-foot-row">
            <button
              type="button"
              className="ntc-draft-btn"
              disabled={saving}
              onClick={() => handleSubmit("draft")}
            >
              {saving && justSaved !== "published" ? <div className="ntc-spinner dark" /> : "Save Draft"}
            </button>
            <button
              type="button"
              className={`ntc-send-btn${justSaved === "published" ? " sent" : ""}`}
              disabled={saving}
              onClick={() => handleSubmit("published")}
            >
              {saving ? (
                <>
                  <div className="ntc-spinner" /> Publishing…
                </>
              ) : justSaved === "published" ? (
                <>
                  <CheckCircle2 size={15} /> Published
                </>
              ) : (
                <>
                  <Send size={14} /> Publish Notice
                </>
              )}
            </button>
          </div>
          <div className="ntc-send-hint">
            Press{" "}
            <kbd style={{ background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 4, padding: "0 4px", fontSize: "0.6rem" }}>
              Esc
            </kbd>{" "}
            to discard
          </div>
        </div>
      </div>
    </div>
  );
}
