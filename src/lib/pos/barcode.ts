"use client";

/**
 * Decoding QR codes from a video frame.
 *
 * Two paths, because you have mixed devices:
 *
 *   BarcodeDetector  — built into Chrome on Android. Hardware-accelerated,
 *                      nothing to download, noticeably faster to first read.
 *   jsQR             — a small pure-JS decoder, used everywhere else. Safari
 *                      has no BarcodeDetector, so every iPhone lands here.
 *
 * The native path is tried first and falls back permanently if constructing
 * it throws — some browsers expose the class but support no formats.
 */
import jsQR from "jsqr";

/** Not in TypeScript's DOM types yet. */
type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

let native: BarcodeDetectorLike | null | undefined;

function nativeDetector(): BarcodeDetectorLike | null {
  if (native !== undefined) return native;

  try {
    native = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null;
  } catch {
    native = null;
  }
  return native;
}

/** True when this browser decodes in native code rather than JavaScript. */
export function usingNativeDecoder(): boolean {
  return nativeDetector() !== null;
}

/**
 * Decode one frame. Returns the raw string, or null if no QR is in view.
 *
 * Never throws: a decode failure on one frame is completely ordinary — the
 * camera is looking at a countertop most of the time — and must not interrupt
 * the scan loop.
 */
export async function decodeFrame(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): Promise<string | null> {
  const detector = nativeDetector();

  if (detector) {
    try {
      const results = await detector.detect(canvas);
      return results[0]?.rawValue ?? null;
    } catch {
      return null;
    }
  }

  try {
    const { width, height } = canvas;
    if (width === 0 || height === 0) return null;

    const image = context.getImageData(0, 0, width, height);
    // "dontInvert" is the fast path. A printed black-on-white QR on a card or
    // a phone screen is never inverted, and trying both doubles the work on
    // exactly the low-end devices that can least afford it.
    const found = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
    return found?.data ?? null;
  } catch {
    return null;
  }
}
