/**
 * Supabase client for BROWSER code (client components).
 *
 * This uses the publishable key, which is safe to ship to the browser because
 * Row Level Security gates every query on the database side. A member can only
 * ever read their own rows; a cashier can only ever read their merchant's rows.
 *
 * Never import the secret key here.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  );
}

/**
 * Fail loudly at startup rather than mysteriously at query time. A missing key
 * should look like a missing key, not like "the member has no subscriptions".
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}
