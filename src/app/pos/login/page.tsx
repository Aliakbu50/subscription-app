"use client";

/**
 * Cashier sign-in.
 *
 * One shared account per café, so this is used rarely — at setup, and after a
 * device is replaced or wiped. It still has to work one-handed on a phone,
 * because that is where it will be done.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";

export default function LoginPage() {
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [crashed, setCrashed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    setCrashed(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Deliberately one message for both wrong-email and wrong-password.
        // Telling an attacker which half they got right is free information.
        setFailed(true);
        setBusy(false);
        return;
      }
    } catch (err) {
      // Anything that is NOT a rejected credential: misconfiguration, network,
      // a client that could not be constructed. Without this the promise
      // rejects unhandled, setBusy(false) never runs, and the button sits on
      // "signing in…" forever — which looks identical to a slow connection and
      // tells whoever is holding the phone nothing at all.
      setCrashed(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }

    // refresh() re-runs the proxy so the new session cookie is picked up before
    // we navigate, otherwise /pos bounces straight back here.
    router.refresh();
    router.push("/pos");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
        <h1 className="text-2xl font-semibold">{t.signIn}</h1>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm text-muted">
            {t.email}
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-ink bg-paper px-4 py-3 text-lg"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm text-muted">
            {t.password}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-ink bg-paper px-4 py-3 text-lg"
          />
        </div>

        {failed && (
          <p role="alert" className="text-sm text-danger">
            {t.signInFailed}
          </p>
        )}

        {/* Not a wrong password — something is broken. Shown verbatim because
            the only person who ever sees it is whoever is setting the app up,
            and a real message beats "something went wrong". */}
        {crashed && (
          <p role="alert" className="text-sm text-danger" dir="ltr">
            {crashed}
          </p>
        )}

        {/* min-height 56px: a thumb target, not a mouse target. */}
        <button
          type="submit"
          disabled={busy}
          className="w-full border border-ink bg-brand px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
        >
          {busy ? t.signingIn : t.signIn}
        </button>
      </form>
    </main>
  );
}
