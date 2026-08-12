"use client";

/**
 * The confirm screen. The most important screen in the product.
 *
 * A barista holding a cracked phone in one hand must be able to look at this,
 * understand it, and act, without reading carefully. So:
 *
 *   - the member's name is the largest thing on it, because saying it aloud is
 *     how the cashier confirms they have the right person
 *   - eligible: ONE green button, nothing else competing for the thumb
 *   - not eligible: a red card with a sentence, and NO confirm button at all.
 *     A disabled button invites tapping; an absent one does not.
 */
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { itemLabel, posStrings } from "@/lib/i18n/pos";
import { clearHandoff, useHandoff } from "@/lib/pos/handoff";
import { submitRedemption } from "@/lib/pos/queue";

type Outcome = {
  firstName: string;
  quotaRemaining: number | null;
  /** Queued but not yet accepted by the server. Amber, never green. */
  queued: boolean;
};

export default function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  const handoff = useHandoff(token);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);

  /**
   * Generated ONCE when the screen mounts and reused on every retry, per
   * BUILD-SPEC. This is the thing that makes a double-tap on bad café wifi
   * produce one redemption instead of two — regenerating it per click would
   * defeat the entire mechanism.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Phase 1: one subscription per member per café. If that ever stops being
  // true, this becomes a picker rather than an assumption.
  const subscription = handoff?.member.subscriptions[0] ?? null;
  const items = subscription?.eligibleItems ?? [];

  // A café selling only one thing should not pay a tap to say so. You asked
  // for item capture to be required; this keeps it required without making it
  // pointless. Derived rather than held in state — there is no moment where
  // the single item is "not yet selected".
  const chosenItem = pickedItem ?? (items.length === 1 ? items[0] : null);

  // Success auto-returns, so the next customer meets a ready screen rather
  // than the last person's name.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      clearHandoff(token);
      router.push("/pos");
    }, 3000);
    return () => clearTimeout(timer);
  }, [done, router, token]);

  async function confirm() {
    if (!handoff || !subscription) return;
    setBusy(true);
    setError(null);

    // Goes to the queue, which writes it down BEFORE touching the network and
    // then tries to send. Online it comes back "synced" in well under a
    // second; offline it comes back "pending" and the cup is still recorded.
    const result = await submitRedemption({
      id: idempotencyKey,
      memberRef: handoff.via === "qr" ? handoff.memberRef : undefined,
      phone: handoff.via === "phone" ? handoff.phone : undefined,
      subscriptionId: subscription.subscriptionId,
      itemLabel: chosenItem,
      clientCreatedAt: new Date().toISOString(),
      memberFirstName: handoff.member.firstName,
    });

    // Refused on the merits — another till got there first, or a queued
    // redemption already covers today. The only outcome that is an error.
    if (result.status === "rejected") {
      setError(result.reason?.[DEFAULT_LOCALE] ?? t.redeemFailed);
      setBusy(false);
      return;
    }

    setDone({
      firstName: handoff.member.firstName,
      quotaRemaining:
        subscription.quotaRemaining === null ? null : subscription.quotaRemaining - 1,
      queued: result.status === "pending",
    });
  }

  if (handoff === undefined) return null; // reading sessionStorage

  if (handoff === null || !subscription) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <p className="text-center text-lg">{t.sessionExpired}</p>
        <button
          onClick={() => router.push("/pos")}
          className="rounded-2xl border border-rule px-6 py-4 text-lg"
        >
          {t.back}
        </button>
      </main>
    );
  }

  // ---- Success, or saved-and-waiting -------------------------------------
  //
  // Amber when the server has not confirmed it yet. Green must mean "the
  // server has this"; using it for a queued item would train staff to
  // distrust the one signal that is supposed to be unambiguous.
  if (done) {
    return (
      <main
        className={`flex flex-1 flex-col items-center justify-center gap-4 p-6 text-white ${
          done.queued ? "bg-warn" : "bg-brand"
        }`}
      >
        <div className="text-6xl">{done.queued ? "⏱" : "✓"}</div>
        <div className="text-4xl font-bold">{done.firstName}</div>
        <div className="text-2xl">
          {done.quotaRemaining === null ? t.unlimited : t.cupsLeft(done.quotaRemaining)}
        </div>
        {done.queued && <div className="text-xl">{t.savedWillSync}</div>}
      </main>
    );
  }

  // ---- Not eligible ------------------------------------------------------
  if (!subscription.eligible) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-6">
        <div className="text-center">
          <div className="text-4xl font-bold">{handoff.member.firstName}</div>
          <div className="mt-1 text-sm text-muted">{subscription.planName}</div>
        </div>

        {/* Large, red, plain language. Never a code. */}
        <div className="flex flex-1 items-center justify-center rounded-3xl bg-danger p-6 text-center">
          <p className="text-2xl font-semibold text-white">
            {subscription.reason?.[DEFAULT_LOCALE]}
          </p>
        </div>

        <button
          onClick={() => router.push("/pos")}
          className="rounded-2xl border border-rule py-4 text-lg"
        >
          {t.back}
        </button>
      </main>
    );
  }

  // ---- Eligible ----------------------------------------------------------
  return (
    <main className="flex flex-1 flex-col gap-5 p-6">
      <div className="text-center">
        <div className="text-4xl font-bold">{handoff.member.firstName}</div>
        <div className="mt-1 text-sm text-muted">{subscription.planName}</div>
        <div className="mt-2 text-xl">
          {subscription.quotaRemaining === null
            ? t.unlimited
            : t.cupsLeft(subscription.quotaRemaining)}
        </div>
      </div>

      {items.length > 1 && (
        <div className="space-y-2">
          <div className="text-sm text-muted">{t.chooseItem}</div>
          <div className="grid grid-cols-2 gap-3">
            {items.map((item) => (
              <button
                key={item}
                onClick={() => setPickedItem(item)}
                className={`rounded-2xl border py-4 text-lg ${
                  chosenItem === item
                    ? "border-brand bg-brand text-white"
                    : "border-rule"
                }`}
              >
                {itemLabel(item, DEFAULT_LOCALE)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-danger">
          {error}
        </p>
      )}

      <button
        onClick={confirm}
        disabled={busy || (items.length > 0 && !chosenItem)}
        className="flex flex-1 items-center justify-center rounded-3xl bg-brand text-3xl font-bold text-white disabled:opacity-40"
      >
        {busy ? t.confirming : t.confirm}
      </button>
    </main>
  );
}
