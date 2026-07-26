# Notices Module — Architecture (Pre-Implementation)

Grounded in the actual current file (`app/(dashboard)/notices/page.tsx`, 1053 lines) and the
frozen schema in `types/notice.ts`. Nothing below invents new visual language — every UI
element referenced already exists today (`.ntc-card`, `.ntc-article`, the priority stripe,
the Instrument Serif article title, the sectioned drawer). This is a wiring refactor plus
targeted, additive UI changes where the new data model asks for something the old one
couldn't represent (status, pinning, multi-rule targeting).

---

## 1. Final Component Hierarchy

```
NoticesPage
├── NoticeSearch
├── NoticeFilters
├── NoticeList
│    └── NoticeCard                (one per notice)
├── NoticeDetail
│    └── NoticeDetailPanel         (rendered only when a notice is selected)
└── NoticeComposerDrawer
     └── TargetSelector
```

`NoticeDetail` and `NoticeDetailPanel` are deliberately split, mirroring the existing
`!selected ? <placeholder/> : (() => {...})()` branch already in the file — the placeholder
and the real article are different enough (no data vs. a fully populated view) that
splitting them keeps `NoticeDetailPanel` a pure "given a Notice, render it" component with
no null-checking inside it at all.

---

## 2. Folder Structure

```
app/(dashboard)/notices/
  page.tsx                    — NoticesPage; coordinates state only, ~80–120 lines
  notices.css                 — the current <style> block, extracted to its own file
                                 (matches the config-*.css convention already used by
                                 settings/timings, settings/calendar, etc. — a page-level
                                 stylesheet rather than an inline template string)

components/notices/
  NoticeSearch.tsx
  NoticeFilters.tsx
  NoticeList.tsx
  NoticeCard.tsx
  NoticeDetail.tsx
  NoticeDetailPanel.tsx
  NoticeComposerDrawer.tsx
  TargetSelector.tsx

hooks/notices/
  useNoticeList.ts             — wraps the live Firestore listener
  usePublishNotice.ts          — wraps the callable Cloud Function

repositories/notices/
  noticesRepository.ts         — the ONLY file that touches Firestore for notices (reads
                                 only — see below); same role as every other repository in
                                 this codebase (timetableRepository, calendarRepository, …)

services/notices/
  noticesService.ts            — normalizes raw docs → Notice, owns PRIORITY_META/
                                 TYPE_META (renamed from CATEGORY_META — see §7), and the
                                 client-side search/filter predicate. Calls the
                                 publishNotice callable (httpsCallable lives here, not in
                                 the hook — same layering as teachersService calling
                                 createTeacher)

types/notice.ts                — already given, frozen, unchanged

functions/src/notices/
  publishNotice.ts              — the callable Cloud Function (the only writer)
```

This puts notices through the exact same three-layer shape (repository → service →
hook/component) as every other feature already in this codebase — nothing new is being
invented at the data layer, only added at the component layer (hooks didn't exist as a
pattern here before; see §5 for why they're additive, not a replacement for the service
layer).

---

## 3. Component Responsibilities

| Component | Responsibility | Must NOT do |
|---|---|---|
| **NoticesPage** | Composes the tree. Owns page-level UI-selection state only (§4). Derives the filtered list from `useNoticeList()`'s raw array + current search/filter state and passes the result down. | Touch Firestore. Own form state. Own drawer's internal fields. |
| **NoticeSearch** | Controlled text input, calls `onChange`. | Filter anything itself — it just reports the query string up. |
| **NoticeFilters** | Renders type/priority pills + counts + the urgent quick-filter. Receives precomputed counts as props. | Compute counts from a full notices array itself (keeps it testable against plain numbers, and keeps "how counts are derived" in one place — NoticesPage). |
| **NoticeList** | Renders `NoticeCard` for each item in the array it's given, plus loading shimmer / empty states. | Filter, search, or sort — it renders exactly the array it receives, in that order. |
| **NoticeCard** | One notice → one card. Priority stripe, badges, snippet, relative time, pin indicator. | Any state. Pure presentational component. |
| **NoticeDetail** | Empty-placeholder vs. `NoticeDetailPanel` branch. | Format any notice fields itself — delegates entirely to the panel. |
| **NoticeDetailPanel** | Full article rendering for one notice: eyebrow, serif title, meta strip, priority banner, body, info-card grid. | Know how it got selected, or what else is in the list. |
| **NoticeComposerDrawer** | Slide-over shell: header, Esc-to-close, footer with **Save Draft** / **Publish Notice** buttons. Owns its own internal form state (title, message, type, priority, isPinned, publishAt, expiresAt, and the `NoticeTargetRule[]` produced by `TargetSelector`). Calls `usePublishNotice()` on submit. | Any Firestore or callable logic itself — that's entirely inside the hook it calls. |
| **TargetSelector** | Standalone "who is this for" picker (Role → optionally Class → optionally Section). Internally manages its own step state; emits `NoticeTargetRule[]` upward on every change via a single `onChange` prop. Receives the classes/sections catalog as props (reusing the existing `classesRepository.subscribeToClasses` — the same one Timetable already uses — rather than re-fetching classes ad hoc the way the current page does inline). | Fetch anything from Firestore itself. Know it's specifically being used inside a notice composer — designed generically enough to be reusable wherever "pick an audience" comes up again. |

---

## 4. State Ownership

| State | Owner | Why here, not elsewhere |
|---|---|---|
| `notices: Notice[]`, `loading` | `useNoticeList()` (consumed by NoticesPage) | Genuinely global to the page — every other piece of UI derives from it. |
| `search`, `filterType`, `filterPriority` | `NoticesPage` | Cross-cutting — both `NoticeFilters` (to show active state) and the filtered-list derivation need them; neither `NoticeList` nor `NoticeFilters` alone should own something the other depends on. |
| `selectedNoticeId` | `NoticesPage` | Same reasoning — both `NoticeList` (highlight) and `NoticeDetail` (what to render) need it. |
| `drawerOpen` | `NoticesPage` | Toggled from multiple places (header "Post Notice" button, empty-state CTA, the drawer's own close button) — has to live above all of them. |
| Form fields (title, message, type, priority, isPinned, publishAt, expiresAt, targets) | `NoticeComposerDrawer` (internal) | Nothing outside the drawer ever needs these mid-edit — keeping them local avoids re-rendering the whole page on every keystroke. |
| `NoticeTargetRule[]` draft | `TargetSelector` (internal), lifted to the drawer only via `onChange` | The step-by-step picking UI (which step you're on, what's tentatively checked) is TargetSelector's own concern; only the final produced array needs to leave the component. |
| `sending`, `formError`, `sent` (per action) | `usePublishNotice()` | This is exactly what a hook wrapping an async call should own — the drawer just reads `{ saving, error }` off the hook rather than managing its own duplicate flags. |

---

## 5. Hook Responsibilities

**`useNoticeList(schoolId)`**
Wraps `noticesRepository.subscribeToNotices(schoolId, cb)` — a live `onSnapshot` listener,
per the spec ("reads are still a normal Firestore listener," this part isn't changing).
Returns `{ notices, loading }`. No filtering/search inside it — that stays a `NoticesPage`
concern so `NoticeList`/`NoticeFilters` remain pure functions of already-derived data.

**`usePublishNotice()`**
Wraps a single `httpsCallable(functions, "publishNotice")` call, exposed via
`noticesService.publishNotice(input)`. Returns `{ publish, saving, error }`.
**Save Draft** and **Publish Notice** are the *same* call with a different
`status` in the input (`"draft"` vs `"published"`) — not two endpoints, not a
checkbox. This is the direct mechanical answer to "two separate buttons, not a
checkbox": two buttons, one hook, one field that differs.

These two hooks are the only new *pattern* introduced here — nothing else in this codebase
uses a hooks layer today (everything else calls `service.method()` straight from a
`useEffect`). That's fine as an intentional, scoped addition: it's exactly what the spec
asks for ("No Firestore logic inside components"), and it sits *on top of* the existing
repository/service layers rather than replacing them, so it doesn't create a second,
inconsistent way of doing data access elsewhere in the app.

---

## 6. Data Flow Diagram

```
READ SIDE (live, unchanged in spirit)
──────────────────────────────────────
NoticesPage
   └─ useNoticeList(schoolId)
         └─ noticesRepository.subscribeToNotices()
               └─ onSnapshot(schools/{schoolId}/notices)
                     └─ Firestore
   (raw docs) → noticesService.normalizeNotice() → Notice[] → NoticesPage state
                     ↓
      NoticesPage derives `filtered` (search + type + priority) 
                     ↓
      NoticeList / NoticeFilters / NoticeDetail (props only, no fetching)


WRITE SIDE (frozen architecture — client never writes directly)
──────────────────────────────────────
NoticeComposerDrawer (Save Draft | Publish Notice)
   └─ usePublishNotice().publish(input)
         └─ noticesService.publishNotice(input)
               └─ httpsCallable(functions, "publishNotice")(input)
                     └─ [Cloud Function] publishNotice
                           ├─ resolves targets → audienceKeys (server-side, never trusted from client)
                           ├─ writes schools/{schoolId}/notices/{noticeId}
                           └─ [FUTURE, stubbed] Cloud Function trigger → FCM
                     ↓
               onSnapshot above picks up the new/changed doc automatically
                     ↓
               NoticesPage's live list updates — no manual refetch needed
```

The read side never learns about a publish directly — it just sees the same `onSnapshot`
listener fire again once the Cloud Function's write lands. That's the same reactive shape
the rest of this app already uses wherever a live listener exists.

---

## 7. UI Improvements That Preserve (Not Replace) the Current Design

Every item below reuses an existing visual motif rather than introducing a new one.

1. **The "Channel: Push Notification" info-card is repurposed into a Status card** (Draft /
   Scheduled / Published), using the exact same info-card treatment already there. This
   isn't cosmetic — `channel` doesn't exist in the frozen schema, and "Push Notification"
   was already a lie the moment FCM delivery gets stubbed rather than built. `status` is
   real, present on every notice, and exactly the kind of thing that info-card grid already
   exists to show.

2. **Pinned notices get a small icon before the title** (card and article both), and sort to
   the top of the list. Deliberately *not* a second colored stripe — the priority stripe is
   already the dominant left-edge signal on `NoticeCard`; pinning should read as a secondary,
   quieter marker (a small filled pin glyph next to the title), not compete with it.

3. **Scheduled notices need a distinct time treatment.** `timeAgo()` assumes something
   already happened; a scheduled-but-not-yet-published notice hasn't. Show "Scheduled for
   {date}" in that slot instead of a relative past-tense time, using the same
   `.ntc-card-time`/meta-item styling already in place — just different source data and
   phrasing depending on `status`.

4. **The single `target.label` badge becomes a compact renderer for `NoticeTargetRule[]`** —
   "All School" for a single school-wide rule, "3 Classes" or "Class 7A · Section B" when
   more specific, collapsing to a count with the full list on hover/expand once there's more
   than ~2 rules. Same badge shape and position as today; richer content underneath.

5. **Attachments are a visibly-disabled placeholder** in the Advanced section — "Attach
   files (coming soon)" — styled consistently with the rest of the form but clearly
   inactive, not a fully wired uploader. Matches the spec's explicit "Attachments
   (placeholder)."

6. **Real attribution.** The meta strip's "By Administrator" (currently a hardcoded string
   in every single notice, regardless of who posted it) becomes "By {publishByName} ·
   {publishByRole}" — same visual slot, now populated from the Cloud Function's own
   `request.auth`-derived values instead of a literal.

---

## One boundary worth stating explicitly

**Smart Alerts have zero surface area in this architecture** — no shared component, no
shared type, no shared state with anything above. They're generated client-side from
existing data (attendance, fees, birthdays, homework) and don't touch
`schools/{schoolId}/notices` at all. Worth saying plainly so nobody — future me included —
gets tempted to fold them into `NoticeList` or `Notice` later just because they'll visually
resemble notices in the UI.