"use client";

/**
 * The camera scanner.
 *
 * BUILD-SPEC: "Camera opens immediately — no permission prompt on repeat
 * visits, no intermediate screen." So the camera is requested the moment this
 * mounts. There is no "tap to start" step; a barista who tapped Scan has
 * already said what they want.
 *
 * The scan loop runs continuously for as long as the camera is open. A decode
 * does not tear it down — it sets a flag that pauses decoding. That way a QR
 * that turns out to be a wifi code, or a member the server does not know,
 * simply resumes scanning instead of needing the camera restarted.
 *
 * Everything that can go wrong ends with the same advice — use phone lookup —
 * because a cashier mid-rush needs the next action, not a diagnosis.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";
import { decodeFrame } from "@/lib/pos/barcode";
import { parseMemberRef } from "@/lib/pos/member-ref";
import { storeHandoff } from "@/lib/pos/handoff";
import type { ResolvedMember } from "@/lib/pos/resolve";

type Status = "starting" | "scanning" | "resolving" | "denied" | "unavailable";

export default function ScanPage() {
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<Status>("starting");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    /** Pauses decoding while a scanned code is being looked up. */
    let busy = false;

    async function handle(raw: string) {
      const memberRef = parseMemberRef(raw);

      // A wifi code, a poster, someone's business card. Say so and carry on
      // scanning — making the cashier back out and start again would be worse.
      if (!memberRef) {
        setNotice(t.notOurCode);
        busy = false;
        return;
      }

      setStatus("resolving");

      try {
        const response = await fetch("/api/pos/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberRef }),
        });

        if (!response.ok) {
          setNotice(response.status === 404 ? t.memberNotFound : t.redeemFailed);
          setStatus("scanning");
          busy = false;
          return;
        }

        const { member } = (await response.json()) as { member: ResolvedMember };
        const token = storeHandoff({
          member,
          via: "qr",
          memberRef,
          resolvedAt: new Date().toISOString(),
        });
        router.push(`/pos/confirm/${token}`);
      } catch {
        setNotice(t.redeemFailed);
        setStatus("scanning");
        busy = false;
      }
    }

    async function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (stopped || !video || !canvas || !context) return;

      if (!busy && video.readyState === video.HAVE_ENOUGH_DATA) {
        // Downscale to 640px on the long edge. jsQR reads every pixel, and a
        // full 1080p frame on a cheap Android is the difference between a
        // smooth scan and a stuttering one.
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const raw = await decodeFrame(canvas, context);
        if (raw) {
          busy = true;
          void handle(raw);
        }
      }

      if (!stopped) requestAnimationFrame(() => void loop());
    }

    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }

      try {
        // 'environment' is the rear camera — the cashier points the phone at
        // the customer's screen, not at themselves.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();
        setStatus("scanning");
        void loop();
      } catch (err) {
        // NotAllowedError is a refused permission; anything else is a missing
        // or busy camera. Different sentences, same fallback.
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        setStatus(denied ? "denied" : "unavailable");
      }
    }

    void open();

    return () => {
      stopped = true;
      // Release the camera, or the indicator light stays on after leaving.
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [router, t]);

  if (status === "denied" || status === "unavailable") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <p className="text-center text-lg">
          {status === "denied" ? t.cameraDenied : t.cameraUnavailable}
        </p>
        <Link
          href="/pos/lookup"
          className="rounded-2xl bg-brand px-6 py-4 text-lg font-semibold text-white"
        >
          {t.lookupByPhone}
        </Link>
      </main>
    );
  }

  return (
    <main className="relative flex flex-1 flex-col">
      {/* playsInline keeps iOS Safari from throwing this into a fullscreen
          player, which would cover the whole screen. */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* An aiming frame. Purely visual, but it is what stops people pressing
          the phone flat against the customer's screen. */}
      <div className="pointer-events-none relative flex flex-1 items-center justify-center">
        <div className="h-56 w-56 rounded-3xl border-4 border-white/80" />
      </div>

      <div className="relative bg-black/60 p-4 text-center text-white">
        {status === "resolving" ? t.resolving : (notice ?? t.pointAtCode)}
      </div>

      <Link
        href="/pos/lookup"
        className="relative bg-black/60 p-4 text-center text-white underline"
      >
        {t.lookupByPhone}
      </Link>
    </main>
  );
}
