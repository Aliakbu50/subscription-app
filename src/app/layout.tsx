import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DEFAULT_LOCALE, t } from "@/lib/i18n/strings";

// Arabic is the default and RTL is on from day one, per CLAUDE.md.
// Note: the `dir` attribute here is what makes Tailwind's logical properties
// (ps-*, pe-*, ms-*, me-*) flip correctly. Prefer those over left/right.

export const metadata: Metadata = {
  title: t(DEFAULT_LOCALE).appName,
  manifest: "/manifest.webmanifest",
  // Added to a home screen, iOS uses these rather than the manifest.
  appleWebApp: {
    capable: true,
    title: t(DEFAULT_LOCALE).appName,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // The phone's status bar picks this up, so a device with the app on its
  // home screen looks like one thing rather than a website in a frame.
  themeColor: "#2b3268",
  // A cashier must not be able to pinch-zoom the till screen by accident and
  // then wonder why the confirm button has moved.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={DEFAULT_LOCALE} dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
