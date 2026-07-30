/**
 * components/notices/TargetSelector.tsx
 *
 * Standalone, reusable "who should receive this?" picker. Produces
 * NoticeTargetRule[] — the only thing it reports upward, via onChange.
 *
 * Interpretation decision (the original spec described a flow, not a
 * data model — this resolves the ambiguity, documented here so it's
 * not silently assumed): targets is a UNION of independent rules, not
 * a sequential narrowing wizard. Picking "Parents" AND "Section 7A"
 * means "all parents school-wide, PLUS everyone in Section 7A" — not
 * "parents who are in Section 7A." See publishNotice.ts's
 * deriveAudienceKeys for the server-side mechanics this maps to.
 *
 * UI shape, to make that union behavior legible rather than
 * surprising: pick a scope first (Entire School, done — vs. Specific
 * Group). Inside "Specific Group," every choice (a role, a class, a
 * section) becomes its own removable chip that ADDS to the rule set —
 * a tag picker, not a wizard with a single path through it.
 *
 * Receives the classes/sections catalog as props — does NOT fetch
 * anything itself (no Firestore logic inside components; the drawer
 * fetches it once via the existing classesRepository.subscribeToClasses,
 * the same one Timetable already uses).
 */
"use client";

import { useState } from "react";
import { GraduationCap, School, Users, X } from "lucide-react";
import { NoticeAudienceRole, NoticeTargetRule } from "@/types/notice";

export interface TargetSelectorClassOption {
  id: string;
  className: string;
  sections: { id: string; name: string }[];
}

interface TargetSelectorProps {
  value: NoticeTargetRule[];
  onChange: (rules: NoticeTargetRule[]) => void;
  classes: TargetSelectorClassOption[];
}

const ROLE_OPTIONS: { value: NoticeAudienceRole; label: string }[] = [
  { value: "parent", label: "Parents" },
  { value: "teacher", label: "Teachers" },
  { value: "student", label: "Students" },
];

function ruleKey(rule: NoticeTargetRule): string {
  switch (rule.type) {
    case "school":
      return "school";
    case "role":
      return `role:${rule.role}`;
    case "class":
      return `class:${rule.className}`;
    case "section":
      return `section:${rule.className}:${rule.section}`;
  }
}

function ruleLabel(rule: NoticeTargetRule): string {
  switch (rule.type) {
    case "school":
      return "Entire School";
    case "role":
      return rule.role.charAt(0).toUpperCase() + rule.role.slice(1) + "s";
    case "class":
      return `Class ${rule.className}`;
    case "section":
      return `Class ${rule.className} · Section ${rule.section}`;
  }
}

export function TargetSelector({ value, onChange, classes }: TargetSelectorProps) {
  const isSchoolWide = value.length === 1 && value[0].type === "school";
  const [narrowClassId, setNarrowClassId] = useState("");
  const [narrowSectionId, setNarrowSectionId] = useState("");

  const scope: "school" | "group" = isSchoolWide ? "school" : "group";

  function setScope(next: "school" | "group") {
    if (next === "school") {
      onChange([{ type: "school" }]);
    } else {
      onChange([]);
    }
  }

  function toggleRole(role: NoticeAudienceRole) {
    const key = `role:${role}`;
    const exists = value.some((r) => ruleKey(r) === key);
    onChange(exists ? value.filter((r) => ruleKey(r) !== key) : [...value, { type: "role", role }]);
  }

  function addClassOrSection() {
    if (!narrowClassId) return;
    const cls = classes.find((c) => c.id === narrowClassId);
    if (!cls) return;

    const rule: NoticeTargetRule = narrowSectionId
      ? { type: "section", className: cls.className, section: cls.sections.find((s) => s.id === narrowSectionId)?.name ?? "" }
      : { type: "class", className: cls.className };

    const key = ruleKey(rule);
    if (value.some((r) => ruleKey(r) === key)) return; // already added
    onChange([...value, rule]);
    setNarrowClassId("");
    setNarrowSectionId("");
  }

  function removeRule(rule: NoticeTargetRule) {
    onChange(value.filter((r) => ruleKey(r) !== ruleKey(rule)));
  }

  const selectedClass = classes.find((c) => c.id === narrowClassId);

  return (
    <div className="ntc-field">
      <label className="ntc-label">
        Who should receive this? <span style={{ color: "#EF4444" }}>*</span>
      </label>

      <div className="ntc-target-scope-row">
        <button
          type="button"
          className={`ntc-target-scope-opt${scope === "school" ? " active" : ""}`}
          onClick={() => setScope("school")}
        >
          <School size={13} /> Entire School
        </button>
        <button
          type="button"
          className={`ntc-target-scope-opt${scope === "group" ? " active" : ""}`}
          onClick={() => setScope("group")}
        >
          <Users size={13} /> Specific Group
        </button>
      </div>

      {scope === "group" && (
        <>
          <div className="ntc-target-role-grid">
            {ROLE_OPTIONS.map((opt) => {
              const active = value.some((r) => r.type === "role" && r.role === opt.value);
              return (
                <button
                  type="button"
                  key={opt.value}
                  className={`ntc-target-role-opt${active ? " active" : ""}`}
                  onClick={() => toggleRole(opt.value)}
                >
                  <Users size={12} /> {opt.label}
                </button>
              );
            })}
          </div>

          <div className="ntc-target-narrow">
            <div className="ntc-target-narrow-label">Narrow by class / section (optional)</div>
            <div className="ntc-target-narrow-row">
              <select
                className="ntc-select"
                value={narrowClassId}
                onChange={(e) => {
                  setNarrowClassId(e.target.value);
                  setNarrowSectionId("");
                }}
              >
                <option value="">Select class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.className}
                  </option>
                ))}
              </select>
              {selectedClass && selectedClass.sections.length > 0 && (
                <select
                  className="ntc-select"
                  value={narrowSectionId}
                  onChange={(e) => setNarrowSectionId(e.target.value)}
                >
                  <option value="">Whole class</option>
                  {selectedClass.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      Section {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="button"
              className="ntc-target-scope-opt"
              disabled={!narrowClassId}
              onClick={addClassOrSection}
              style={{ opacity: narrowClassId ? 1 : 0.5 }}
            >
              <GraduationCap size={13} /> Add
            </button>
          </div>

          {value.length === 0 ? (
            <div className="ntc-target-empty-hint">Pick at least one role, class, or section above.</div>
          ) : (
            <div className="ntc-target-chips">
              {value.map((rule) => (
                <span key={ruleKey(rule)} className="ntc-target-chip">
                  {ruleLabel(rule)}
                  <button type="button" className="ntc-target-chip-x" onClick={() => removeRule(rule)}>
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
