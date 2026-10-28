// Fetches pages from the (slow) site: at most `concurrency` at once, a timeout
// per attempt, and one retry for timeouts, network errors and 5xx.
export function createQueue({ fetchImpl, concurrency = 2, timeoutMs = 60_000, retryDelayMs = 5_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const waiting = [];
  const inflight = new Map();
  let active = 0;

  async function attempt(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { credentials: "include", signal: ctl.signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: "http", status: res.status, retry: res.status >= 500 };
      return { ok: true, status: res.status, url: res.url || url, text };
    } catch {
      return { ok: false, error: ctl.signal.aborted ? "timeout" : "network", retry: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(url) {
    let r = await attempt(url);
    if (!r.ok && r.retry) {
      await sleep(retryDelayMs);
      r = await attempt(url);
    }
    const { retry, ...result } = r;
    return result;
  }

  function pump() {
    while (active < concurrency && waiting.length) {
      const { url, resolve } = waiting.shift();
      active++;
      run(url).then(resolve).finally(() => {
        active--;
        pump();
      });
    }
  }

  return {
    get(url) {
      if (!inflight.has(url)) {
        const p = new Promise((resolve) => {
          waiting.push({ url, resolve });
          pump();
        }).finally(() => inflight.delete(url));
        inflight.set(url, p);
      }
      return inflight.get(url);
    },
    get size() {
      return active + waiting.length;
    },
  };
}
