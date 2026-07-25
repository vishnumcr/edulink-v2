# edulink-v2

Frozen architecture. Read this before adding files anywhere.

## Hosting

Firebase Hosting, Next.js framework adapter. `functions/` is a separate
codebase deployed alongside hosting (see `firebase.json`).

## The one rule that governs where code goes

**CRUD → client. Business transactions → `functions/`.**

- CRUD (plain reads/writes of records the user already has permission to
  touch) → straight through the Firebase client SDK, gated by Firestore
  rules.
- Business transactions — secrets, money, trusted calculations, coordinated
  multi-document writes, external APIs (Razorpay, MSG91, email, etc.) →
  Cloud Functions in `functions/`, following function → service →
  repository/provider layering.

`app/api/` is reserved for Next.js-only concerns (auth session cookies,
revalidation webhooks) — **not** a second place for business logic. If a
route handler starts validating money or calling a third-party API, it
belongs in `functions/` instead.

## Folder structure

```
app/
  (auth)/            → login, forgot-password. No dashboard chrome.
  (dashboard)/        → dashboard, students, teachers, attendance, finance,
                          settings. Guarded — redirects to /login if signed out.
  api/                → Next.js-only route handlers (see rule above)
  layout.tsx           → root layout: metadata, fonts, theme, AuthProvider,
                          Toaster. No business logic.
  page.tsx              → redirects to /dashboard or /login based on auth state

components/
  layout/    → Sidebar, Topbar, shell pieces
  ui/         → shadcn/ui primitives (added via CLI as needed)
  forms/      → shared RHF + Zod form building blocks
  tables/     → shared TanStack Table building blocks
  charts/     → shared Recharts wrappers
  finance/, students/, teachers/  → feature-specific components

services/{feature}/       → business logic per feature, feature-first
repositories/{feature}/    → Firestore/RTDB access per feature, feature-first
context/                    → React Context providers (AuthContext, etc.)
hooks/                       → shared React hooks
types/                        → shared TypeScript types
utils/, constants/, config/    → self-explanatory
functions/                      → Cloud Functions (separate codebase)
```

**Convention: feature names must match exactly across every layer.** If a
feature is called `finance` in `app/(dashboard)/finance/`, it's `finance`
in `components/finance/`, `services/finance/`, `repositories/finance/`,
and `types/` — never `fees` in one place and `finance` in another. This is
what makes the feature-first split actually navigable.

## Frozen library choices

| Concern | Library |
|---|---|
| Forms | React Hook Form + Zod |
| Tables | TanStack Table |
| Data fetching | Native Firebase SDK (no React Query yet) |
| Charts | Recharts |
| Dates | date-fns |
| Icons | Lucide |
| UI primitives | shadcn/ui |
| Notifications | Sonner |
| Validation | Zod |
| State | React Context (until proven insufficient) |

`components/ui/` starts empty — shadcn/ui components get added one at a
time via the CLI as features need them, which will also pull in the
relevant `@radix-ui/*` peer dependency at that point.

## Setup

1. `npm install`
2. Copy `.env.local.example` → `.env.local`, fill in Firebase web config.
3. `npm run dev`

## Status

Structure and root layout are frozen. Auth pages ((auth)/login,
(dashboard) guard) still need to be ported over from the edulink-vs
prototype into this structure — not done yet.
