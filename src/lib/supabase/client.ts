/**
 * Supabase client for BROWSER code (client components).
 *
 * Uses the publishable key, which is safe to ship to the browser because Row
 * Level Security gates every query on the database side. Never import the
 * secret key here.
 */
import { createBrowserClient } from "@supabase/ssr";

/**
 * These MUST be written as static property accesses.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_SOMETHING` with the literal value
 * at BUILD time by textual substitution. It only recognises the static form.
 * A dynamic lookup — process.env[name], where name is a variable — is left
 * exactly as written, and since browsers have no process.env, it evaluates to
 * undefined at runtime.
 *
 * An earlier version of this file used a requireEnv(name) helper for both
 * values. Server code was fine, because there `process.env` is real. The
 * browser silently got undefined, createBrowserClient was constructed with no
 * credentials, and signing in failed with the button stuck on "signing in…".
 *
 * Reading them at module scope also means a missing variable fails at import
 * rather than on the first click.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Locally: check .env.local. On Netlify: check the site's environment " +
        "variables, then redeploy — NEXT_PUBLIC_* values are baked in at build " +
        "time, so adding them without rebuilding changes nothing.",
    );
  }

  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
