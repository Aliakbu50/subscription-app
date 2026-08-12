"use client";

/**
 * Phone-number fallback, for a member who has lost their QR or their phone is
 * dead.
 *
 * Its own keypad rather than the OS keyboard: a system numeric keyboard eats
 * half the screen, varies by device, and on some Android builds still offers
 * autocomplete on a field that should never autocomplete. Large fixed buttons
 * are also faster one-handed, which is the whole point.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";
import { normalizeSaudiPhone } from "@/lib/pos/phone";
import { storeHandoff } from "@/lib/pos/handoff";
import type { ResolvedMember } from "@/lib/pos/resolve";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export default function LookupPage() {
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saudi mobiles are 10 digits as typed (05XXXXXXXX). Longer is a mistake.
  const push = (d: string) => {
    setError(null);
    setDigits((current) => (current.length >= 10 ? current : current + d));
  };

  const canSearch = normalizeSaudiPhone(digits) !== null;

  async function search() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/pos/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });

      if (response.status === 404) {
        setError(t.memberNotFound);
        setBusy(false);
        return;
      }
      if (!response.ok) {
        setError(response.status === 400 ? t.invalidPhone : t.redeemFailed);
        setBusy(false);
        return;
      }

      const { member } = (await response.json()) as { member: ResolvedMember };
      const token = storeHandoff({
        member,
        via: "phone",
        phone: digits,
        resolvedAt: new Date().toISOString(),
      });
      router.push(`/pos/confirm/${token}`);
    } catch {
      setError(t.redeemFailed);
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <label className="text-sm text-muted">{t.enterPhone}</label>

      {/* dir=ltr: a phone number reads left-to-right even in an RTL layout. */}
      <div
        dir="ltr"
        className="rounded-2xl border border-rule bg-surface px-4 py-4 text-center text-3xl font-semibold tabular-nums tracking-widest"
      >
        {digits || " "}
      </div>

      {error && (
        <p role="alert" className="text-center text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => {
          if (key === "clear") {
            return (
              <button
                key={key}
                onClick={() => {
                  setDigits("");
                  setError(null);
                }}
                className="rounded-2xl border border-rule bg-surface py-5 text-lg"
              >
                {t.clear}
              </button>
            );
          }
          if (key === "back") {
            return (
              <button
                key={key}
                onClick={() => setDigits((d) => d.slice(0, -1))}
                className="rounded-2xl border border-rule bg-surface py-5 text-2xl"
                aria-label={t.back}
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={key}
              onClick={() => push(key)}
              className="rounded-2xl border border-rule bg-surface py-5 text-2xl font-semibold tabular-nums"
            >
              {key}
            </button>
          );
        })}
      </div>

      <button
        onClick={search}
        disabled={!canSearch || busy}
        className="rounded-2xl bg-brand py-5 text-xl font-bold text-white disabled:opacity-40"
      >
        {busy ? t.searching : t.find}
      </button>
    </main>
  );
}
