/**
 * --------------------------------------------------------------------
 * File:
 * app/(auth)/forgot-password/page.tsx
 *
 * Responsibilities:
 * ✅ Validate email
 * ✅ Show errors
 * ✅ Call AuthService.resetPassword
 * ✅ Show a neutral success state (does not confirm/deny account existence)
 *
 * Does NOT:
 * ❌ Call Firestore
 * ❌ Call Firebase Auth directly
 * ❌ Redirect on success — user chooses when to go back to /login
 * --------------------------------------------------------------------
 */

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { authService } from "@/services/auth/authService";
import { AuthError } from "@/types/auth";

const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required.").email("Invalid email address."),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      await authService.resetPassword(values.email);
      // Firebase's sendPasswordResetEmail resolves the same way whether
      // or not the account exists — we mirror that here rather than
      // revealing account existence through a differing UI state.
      setSubmittedEmail(values.email);
    } catch (error) {
      const message =
        error instanceof AuthError ? error.message : "Something went wrong. Please try again.";
      toast.error(message);
    }
  };

  if (submittedEmail) {
    return (
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-500">
          If an account exists for <span className="font-medium text-slate-700">{submittedEmail}</span>,
          we&apos;ve sent a link to reset your password.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Back to Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Forgot Password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-slate-700">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            placeholder="you@school.edu"
          />
          {errors.email && (
            <p className="mt-1 text-xs font-medium text-red-600">{errors.email.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Sending..." : "Send Reset Link"}
        </button>

        <a
          href="/login"
          className="block text-center text-sm font-medium text-slate-600 hover:underline"
        >
          Back to Sign In
        </a>
      </form>
    </div>
  );
}