import { describe, expect, it } from "vitest";
import { classifySyncResult, retryDelayMs } from "@/lib/pos/queue-policy";

describe("classifySyncResult", () => {
  it("treats 2xx as synced", () => {
    expect(classifySyncResult({ status: 200 })).toEqual({ kind: "synced" });
    expect(classifySyncResult({ status: 201 })).toEqual({ kind: "synced" });
  });

  /**
   * The endpoint reports an idempotent replay as success on purpose, so this
   * layer never has to know the difference. If that ever changes, a retried
   * item would look like a failure and be retried forever.
   */
  it("treats a replayed idempotent write as synced, like any other success", () => {
    expect(classifySyncResult({ status: 200, body: {} })).toEqual({ kind: "synced" });
  });

  describe("things we must keep and try again", () => {
    /**
     * The most important case in this file. A request that never got an answer
     * might have been processed or might not. Treating it as failure and
     * discarding the item loses a cup the café already handed over.
     */
    it("keeps an item when the request never completed", () => {
      expect(classifySyncResult({ status: null })).toEqual({
        kind: "retry",
        because: "network",
      });
    });

    it("keeps an item when the server broke", () => {
      expect(classifySyncResult({ status: 500 })).toMatchObject({ kind: "retry" });
      expect(classifySyncResult({ status: 503 })).toMatchObject({ kind: "retry" });
    });

    it("keeps an item when the session expired while it was queued", () => {
      expect(classifySyncResult({ status: 401 })).toMatchObject({ kind: "retry" });
      expect(classifySyncResult({ status: 403 })).toMatchObject({ kind: "retry" });
    });

    it("keeps an item when rate limited", () => {
      expect(classifySyncResult({ status: 429 })).toEqual({
        kind: "retry",
        because: "rate_limited",
      });
    });
  });

  describe("things the server refused on the merits", () => {
    it("stops retrying a 409 and carries the reason through for the owner", () => {
      const result = classifySyncResult({
        status: 409,
        body: {
          error: "not_eligible",
          reason: { ar: "تم الاستخدام اليوم", en: "Already used today" },
        },
      });
      expect(result).toEqual({
        kind: "rejected",
        reason: { ar: "تم الاستخدام اليوم", en: "Already used today" },
      });
    });

    it("stops retrying a malformed request — identical bytes will fail again", () => {
      expect(classifySyncResult({ status: 400 })).toMatchObject({ kind: "rejected" });
      expect(classifySyncResult({ status: 404 })).toMatchObject({ kind: "rejected" });
    });
  });

  it("never returns anything other than the three known outcomes", () => {
    for (const status of [200, 204, 301, 400, 401, 404, 409, 418, 429, 500, 502, null]) {
      const kind = classifySyncResult({ status }).kind;
      expect(["synced", "retry", "rejected"]).toContain(kind);
    }
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially", () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(3)).toBe(8_000);
  });

  /**
   * A café whose wifi is out for an hour must not have a phone hammering a
   * dead router. On a shared shop device a flat battery is its own outage.
   */
  it("caps the wait so retries never become a battery drain", () => {
    expect(retryDelayMs(20)).toBe(60_000);
    expect(retryDelayMs(100)).toBe(60_000);
  });

  it("handles a first attempt sensibly", () => {
    expect(retryDelayMs(0)).toBe(2_000);
  });
});
