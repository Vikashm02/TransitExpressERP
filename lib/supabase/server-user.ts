/**
 * User-scoped Supabase client for Next.js Route Handlers.
 *
 * Uses the anon key + the caller's JWT so Postgres RLS remains authoritative.
 * Never uses the service role. Does not modify the browser client in lib/supabase.ts.
 */

import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function extractBearerAccessToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export type UserScopedSupabaseResult =
  | { ok: true; client: SupabaseClient; user: User; accessToken: string }
  | { ok: false; reason: "missing_token" | "invalid_token" | "misconfigured" };

/**
 * Build a Supabase client bound to the authenticated staff session JWT.
 * Identity comes only from the verified access token — never from a client-supplied user_id.
 */
export async function createUserScopedSupabaseClient(
  accessToken: string,
): Promise<UserScopedSupabaseResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return { ok: false, reason: "misconfigured" };
  }

  const token = accessToken.trim();
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  const client = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) {
    return { ok: false, reason: "invalid_token" };
  }

  return { ok: true, client, user: data.user, accessToken: token };
}

export async function createUserScopedSupabaseClientFromRequest(
  request: Request,
): Promise<UserScopedSupabaseResult> {
  const token = extractBearerAccessToken(request);
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }
  return createUserScopedSupabaseClient(token);
}
