"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";

export function SignOutButton() {
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
    router.push("/pos/login");
  }

  return (
    <button onClick={signOut} className="text-sm text-muted underline">
      {t.signOut}
    </button>
  );
}
