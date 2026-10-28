import { describe, expect, it } from "vitest";
import { DAY_MS, isFresh, memberKey, officersKey } from "../../extension/lib/cache.js";
import { allowedOrigin } from "../../extension/lib/origin.js";
import { addEntry, entriesFor, removeEntry } from "../../extension/lib/roster.js";

describe("cache", () => {
  it("builds keys", () => {
    expect(memberKey(5)).toBe("member:5");
    expect(officersKey(11)).toBe("officers:11");
  });
  it("is fresh only within the TTL and only with fetchedAt", () => {
    const now = 100 * DAY_MS;
    expect(isFresh({ fetchedAt: now - 6 * DAY_MS }, now, 7)).toBe(true);
    expect(isFresh({ fetchedAt: now - 7 * DAY_MS }, now, 7)).toBe(false);
    expect(isFresh({ error: "fetch" }, now, 7)).toBe(false);
    expect(isFresh(undefined, now, 7)).toBe(false);
  });
});

describe("roster", () => {
  const a = { lodgeId: 11, office: "SW", memberId: 1, name: "A", addedAt: 1 };
  const b = { lodgeId: 11, office: "SW", memberId: 2, name: "B", addedAt: 2 };
  it("adds candidates per term year, allowing contested offices", () => {
    const r = addEntry(addEntry({}, 2027, a), 2027, b);
    expect(entriesFor(r, 2027)).toEqual([a, b]);
    expect(entriesFor(r, 2028)).toEqual([]);
  });
  it("ignores duplicates and does not mutate", () => {
    const r1 = addEntry({}, 2027, a);
    const r2 = addEntry(r1, 2027, { ...a, addedAt: 9 });
    expect(r2).toBe(r1);
    expect(addEntry(r1, 2027, b)).not.toBe(r1);
    expect(entriesFor(r1, 2027)).toEqual([a]);
  });
  it("removes by lodge, office and member", () => {
    const r = removeEntry(addEntry(addEntry({}, 2027, a), 2027, b), 2027, { lodgeId: 11, office: "SW", memberId: 1 });
    expect(entriesFor(r, 2027)).toEqual([b]);
  });
});

describe("allowedOrigin", () => {
  const patterns = ["https://member.freemason.org/*", "http://localhost/*"];
  it("returns the origin for matching hosts, any port", () => {
    expect(allowedOrigin("https://member.freemason.org/districts/123", patterns)).toBe("https://member.freemason.org");
    expect(allowedOrigin("http://localhost:4321/x", patterns)).toBe("http://localhost:4321");
  });
  it("rejects other hosts, schemes and junk", () => {
    expect(allowedOrigin("https://evil.example/", patterns)).toBeNull();
    expect(allowedOrigin("http://member.freemason.org/", patterns)).toBeNull();
    expect(allowedOrigin(undefined, patterns)).toBeNull();
  });
});
