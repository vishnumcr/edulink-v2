/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/page.tsx
 *
 * Redirects /settings to the first fully-built section. Swap this to
 * /settings/general once that section exists — it's the more natural
 * default landing for a settings hub.
 * --------------------------------------------------------------------
 */

import { redirect } from "next/navigation";

export default function SettingsIndexPage() {
  redirect("/settings/fees");
}