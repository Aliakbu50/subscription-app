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
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Deliberately one message for both wrong-email and wrong-password.
      // Telling an attacker which half they got right is free information.
      setFailed(true);
      setBusy(false);
      return;
    }

    // refresh() re-runs the middleware so the new session cookie is picked up
    // before we navigate, otherwise /pos bounces straight back here.
    router.refresh();
    router.push("/pos");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
        <h1 className="text-2xl font-semibold">{t.signIn}</h1>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm opacity-70">
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
            className="w-full rounded-xl border border-black/20 dark:border-white/20 bg-transparent px-4 py-3 text-lg"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm opacity-70">
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
            className="w-full rounded-xl border border-black/20 dark:border-white/20 bg-transparent px-4 py-3 text-lg"
          />
        </div>

        {failed && (
          <p role="alert" className="text-sm text-red-600">
            {t.signInFailed}
          </p>
        )}

        {/* min-height 56px: a thumb target, not a mouse target. */}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-green-600 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
        >
          {busy ? t.signingIn : t.signIn}
        </button>
      </form>
    </main>
  );
}
