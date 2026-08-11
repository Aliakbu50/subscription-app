/**
 * Supabase clients for SERVER code (server components, route handlers).
 *
 * There are two, and picking the wrong one is a security bug:
 *
 *   createServerClient()  — acts as the signed-in user. RLS applies.
 *                           Use this for almost everything.
 *
 *   createAdminClient()   — uses the secret key. RLS is BYPASSED entirely.
 *                           Only for operations that legitimately need to read
 *                           across tenants, e.g. the server-side member lookup
 *                           in Slice 1. Every call must be audit-logged.
 *
 * Neither of these may ever be imported from a client component.
 */
import "server-only";

import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Acts as the signed-in user. Row Level Security applies. Prefer this. */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component, where cookies are read-only.
            // Safe to ignore when middleware is refreshing the session.
          }
        },
      },
    },
  );
}

/**
 * BYPASSES Row Level Security. Server-side only, and only where genuinely
 * required. If you are reaching for this, first ask whether an RLS policy or a
 * `security definer` database function would do the job instead.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}
