/**
 * --------------------------------------------------------------------
 * File:
 * app/layout.tsx
 *
 * Purpose:
 * Root layout for the entire app. Owns app-wide concerns only.
 *
 * Responsibilities:
 * ✅ Metadata
 * ✅ Fonts
 * ✅ Global CSS / theme
 * ✅ AuthProvider
 * ✅ Toast provider (Sonner)
 *
 * Does NOT:
 * ❌ Contain business logic
 * ❌ Fetch or write data
 * ❌ Know about specific features (students, finance, etc.)
 *
 * Not yet added (intentionally deferred per the architecture freeze):
 * - Error boundary
 * - React Query provider
 * --------------------------------------------------------------------
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "EduLink",
  description: "School management platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>
          {children}
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
