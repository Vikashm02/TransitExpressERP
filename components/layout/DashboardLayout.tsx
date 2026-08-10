"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";

import { useAuth } from "@/lib/auth/AuthProvider";
import Sidebar from "./Sidebar";
import Header from "./Header";

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Every page in the app except `/login` renders through here, which
 * makes this the single place that enforces "you must be signed in to
 * use the app" (see lib/auth/AuthProvider.tsx) — rather than repeating
 * a guard in every `app/**\/page.tsx`. This is a client-side UX guard
 * only; the actual data protection is Supabase RLS on `lrs`/`pods`/
 * `lorry_expenses`/`app_users` (migration 017), which still applies
 * even if someone bypasses this redirect.
 */
export default function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Truck className="h-8 w-8 animate-pulse" />
          <p className="text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
