/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/layout.tsx
 *
 * Purpose:
 * Shared shell for every settings section — Academic, Fees, Transport,
 * Payment, General. Each section is its own route with its own
 * page/service/repository, same as every other feature in the app;
 * this layout only renders the nav that ties them together.
 * --------------------------------------------------------------------
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, IndianRupee, Bus, CreditCard, Settings2, ShieldCheck, Book, Clock3, CalendarRange, InfoIcon } from "lucide-react";

const SECTIONS = [
  { href: "/settings/academic", label: "Academic", icon: Layers },
  { href: "/settings/fees", label: "Fees", icon: IndianRupee },
  { href: "/settings/transport", label: "Transport", icon: Bus },
  { href: "/settings/payment", label: "Payment", icon: CreditCard },
  { href: "/settings/access", label: "Access", icon: ShieldCheck },
  { href: "/settings/general", label: "Info", icon: InfoIcon },
  { href: "/settings/subjects", label: "Subjects", icon: Book },
  { href: "/settings/timings", label: "Timings", icon: Clock3 },
  { href: "/settings/calendar", label: "Calendar", icon: CalendarRange },

];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="border-b border-zinc-200 bg-white px-6 pt-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Settings</h1>
          <p className="mt-1 text-sm text-zinc-500">Configure how your school runs on EduLink.</p>

          <div className="mt-5 flex gap-1 overflow-x-auto">
            {SECTIONS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname?.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-400 hover:text-zinc-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}