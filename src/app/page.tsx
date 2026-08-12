import { DEFAULT_LOCALE, t } from "@/lib/i18n/strings";

/**
 * Placeholder landing page. Exists only to confirm the toolchain works.
 * The real surfaces are /pos/*, /m/* and /dashboard/*.
 */
export default function Home() {
  const s = t(DEFAULT_LOCALE);

  // Read on the server so the secret key is never involved in this check.
  const envReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{s.setupTitle}</h1>
        <p className="text-sm text-muted">{s.setupBody}</p>
        <p
          className={`text-sm ${envReady ? "text-brand" : "text-warn"}`}
        >
          {envReady ? s.envReady : s.envMissing}
        </p>
      </div>
    </main>
  );
}
