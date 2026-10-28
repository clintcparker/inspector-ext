import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueue } from "../../extension/lib/queue.js";

const response = (status, text = "ok", url) => ({ ok: status < 400, status, url, text: async () => text });

afterEach(() => vi.useRealTimers());

describe("createQueue", () => {
  it("runs at most two requests at once", async () => {
    let active = 0;
    let peak = 0;
    const release = [];
    const fetchImpl = (url) => {
      active++;
      peak = Math.max(peak, active);
      return new Promise((r) => release.push(() => { active--; r(response(200, url, url)); }));
    };
    const q = createQueue({ fetchImpl });
    const all = Promise.all(["a", "b", "c", "d"].map((u) => q.get(`https://x.test/${u}`)));
    await vi.waitFor(() => expect(release.length).toBe(2));
    while (release.length) { release.shift()(); await new Promise((r) => setTimeout(r, 0)); }
    const results = await all;
    expect(peak).toBe(2);
    expect(results.map((r) => r.text)).toEqual(["a", "b", "c", "d"].map((u) => `https://x.test/${u}`));
  });

  it("shares one request between concurrent gets of the same URL", async () => {
    const fetchImpl = vi.fn(async (url) => response(200, "x", url));
    const q = createQueue({ fetchImpl });
    const [r1, r2] = await Promise.all([q.get("https://x.test/a"), q.get("https://x.test/a")]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("times out after 60 s and retries once after 5 s", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = (url, { signal }) => {
      calls++;
      if (calls === 1) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      return Promise.resolve(response(200, "second", url));
    };
    const q = createQueue({ fetchImpl });
    const p = q.get("https://x.test/slow");
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toMatchObject({ ok: true, text: "second" });
    expect(calls).toBe(2);
  });

  it("gives up after the retry with the error kind", async () => {
    vi.useFakeTimers();
    const q = createQueue({ fetchImpl: async () => { throw new TypeError("NetworkError"); } });
    const p = q.get("https://x.test/down");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toEqual({ ok: false, error: "network" });
  });

  it("does not retry 4xx and reports the status", async () => {
    const fetchImpl = vi.fn(async (url) => response(404, "nope", url));
    const q = createQueue({ fetchImpl });
    expect(await q.get("https://x.test/missing")).toEqual({ ok: false, error: "http", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends cookies", async () => {
    const fetchImpl = vi.fn(async (url) => response(200, "x", url));
    await createQueue({ fetchImpl }).get("https://x.test/a");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });
});
