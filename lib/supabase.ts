/**
 * --------------------------------------------------------------------
 * File:
 * lib/supabase.ts
 *
 * Purpose:
 * Initializes the Supabase client SDK. Currently used for the
 * Academic Calendar only (see repositories/calendar/calendarRepository.ts)
 * — the one piece of data moved off Firestore because it's read on
 * every parent-app open and written only a handful of times a year.
 * Everything else in EduLink still talks to Firestore via lib/firebase.ts.
 *
 * The anon key is safe to expose to the browser (same reasoning as
 * the Firebase config in lib/firebase.ts) — access is enforced by
 * Postgres Row Level Security policies, not by keeping this key
 * secret. See supabase/migrations/0001_academic_calendar.sql for the
 * current (deliberately open, matching firestore.rules) policies.
 *
 * Does NOT:
 * ❌ Contain business logic
 * ❌ Read or write any table directly
 * --------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabasePublishableKey) {
  // Fails loudly in dev rather than silently returning empty data from
  // every calendar query — same spirit as this project's existing
  // Firebase init, which lets initializeApp throw on a missing config.
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — the Academic Calendar will not load. See .env.local."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

export default supabase;
