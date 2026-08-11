import type { Metadata } from "next";
import "./globals.css";
import { DEFAULT_LOCALE, t } from "@/lib/i18n/strings";

// Arabic is the default and RTL is on from day one, per CLAUDE.md.
// Note: the `dir` attribute here is what makes Tailwind's logical properties
// (ps-*, pe-*, ms-*, me-*) flip correctly. Prefer those over left/right.

export const metadata: Metadata = {
  title: t(DEFAULT_LOCALE).appName,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={DEFAULT_LOCALE} dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
