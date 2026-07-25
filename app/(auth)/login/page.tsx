/**
 * --------------------------------------------------------------------
 * File:
 * app/(auth)/login/page.tsx
 *
 * Responsibilities:
 * ✅ Validate email
 * ✅ Validate password
 * ✅ Show errors
 * ✅ Call AuthService
 *
 * Does NOT:
 * ❌ Call Firestore
 * ❌ Call Firebase Auth directly
 * ❌ Decide when to redirect (AuthContext + this effect just react to it)
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { authService } from "@/services/auth/authService";
import { AuthError } from "@/types/auth";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required.").email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  rememberMe: z.boolean(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  // AuthContext is the single source of truth for auth state — once it
  // reports a signed-in user with a valid profile, leave the login page.
  useEffect(() => {
    if (!authLoading && user && profile) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, profile, router]);

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await authService.login(values);
      // No manual profile fetch or redirect here — AuthContext's
      // subscriptions pick up the new state and the effect above
      // handles navigation.
    } catch (error) {
      const message =
        error instanceof AuthError ? error.message : "Something went wrong. Please try again.";
      toast.error(message);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">EduLink</h1>
        <p className="mt-1 text-sm text-slate-500">School Management ERP</p>
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

        <div>
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            placeholder="••••••••"
          />
          {errors.password && (
            <p className="mt-1 text-xs font-medium text-red-600">{errors.password.message}</p>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" {...register("rememberMe")} className="h-4 w-4 rounded border-slate-300" />
            Remember Me
          </label>
          <a href="/forgot-password" className="font-medium text-slate-900 hover:underline">
            Forgot Password?
          </a>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
