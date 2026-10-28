import { describe, expect, it } from "vitest";
import { evaluate } from "../../extension/lib/rules.js";

const today = "2026-10-28";
const ctx = { termYear: 2027, today };
const HAM = "Hall Association Management Exam";
const ADM = "Lodge Administration Exam";
const MEX = "Member Experience Exam";
const FIN = "Finance Exam";
const edu = (...pairs) => ({ educational: pairs.map(([type, date]) => ({ type, date })) });

describe("evaluate: MM proficiency and ritual", () => {
  it("uses the latest matching event for MM", () => {
    const r = evaluate("SW", {
      history: [{ type: "Proficiency - MM", date: "2001-01-01" }, { type: "Proficiency - MM", date: "2003-02-02" }],
      proficiency: [{ type: "SW Officer Qualification", date: "2026-09-01" }],
    }, ctx);
    expect(r.mm).toEqual({ status: "met", date: "2003-02-02" });
    expect(r.ritual).toEqual({ status: "met", date: "2026-09-01", expires: "2028-09-01" });
  });
  it("requires the qualification for the office stood for", () => {
    const r = evaluate("SW", { proficiency: [{ type: "WM Officer Qualification", date: "2026-09-01" }] }, ctx);
    expect(r.ritual).toEqual({ status: "missing" });
    expect(r.mm).toEqual({ status: "missing" });
  });
  it("ritual dated just inside 24 months is still counted (expiring)", () => {
    const r = evaluate("WM", { proficiency: [{ type: "WM Officer Qualification", date: "2024-10-29" }] }, ctx);
    expect(r.ritual).toEqual({ status: "expiring", date: "2024-10-29", expires: "2026-10-29" });
  });
  it("ritual comfortably inside the window is met", () => {
    const r = evaluate("WM", { proficiency: [{ type: "WM Officer Qualification", date: "2026-06-01" }] }, ctx);
    expect(r.ritual).toEqual({ status: "met", date: "2026-06-01", expires: "2028-06-01" });
  });
  it("ritual lapsing before the term starts is expiring", () => {
    // Expires 2027-06-01: over 90 days out, but before a 2028 term starts.
    const proficiency = [{ type: "WM Officer Qualification", date: "2025-06-01" }];
    expect(evaluate("WM", { proficiency }, { termYear: 2028, today }).ritual).toMatchObject({ status: "expiring", expires: "2027-06-01" });
    expect(evaluate("WM", { proficiency }, ctx).ritual.status).toBe("met");
  });
  it("ritual lapsing within 90 days is expiring even after the term starts", () => {
    const r = evaluate("WM", { proficiency: [{ type: "WM Officer Qualification", date: "2024-12-15" }] }, { termYear: 2026, today });
    expect(r.ritual).toMatchObject({ status: "expiring", expires: "2026-12-15" });
  });
  it("ritual dated exactly 24 months ago is expired, with its date and expiry", () => {
    const r = evaluate("WM", { proficiency: [{ type: "WM Officer Qualification", date: "2024-10-28" }] }, ctx);
    expect(r.ritual).toEqual({ status: "expired", date: "2024-10-28", expires: "2026-10-28" });
  });
  it("an old qualification superseded by a recent one is met", () => {
    const r = evaluate("JW", { proficiency: [{ type: "JW Officer Qualification", date: "2020-01-01" }, { type: "JW Officer Qualification", date: "2026-01-01" }] }, ctx);
    expect(r.ritual).toEqual({ status: "met", date: "2026-01-01", expires: "2028-01-01" });
  });
  it("checks the SD ritual with the same window", () => {
    expect(evaluate("SD", { proficiency: [{ type: "SD Officer Qualification", date: "2026-08-01" }] }, ctx).ritual.status).toBe("met");
    expect(evaluate("SD", { proficiency: [{ type: "SD Officer Qualification", date: "2023-08-01" }] }, ctx).ritual).toMatchObject({ status: "expired", date: "2023-08-01" });
  });
  it("SD MM with a date is info, without is na", () => {
    expect(evaluate("SD", { history: [{ type: "Proficiency - MM", date: "2003-02-02" }] }, ctx).mm).toEqual({ status: "info", date: "2003-02-02" });
    expect(evaluate("SD", {}, ctx).mm).toEqual({ status: "na" });
  });
  it("WM, SW and JW MM stay met or missing", () => {
    for (const office of ["WM", "SW", "JW"]) {
      expect(evaluate(office, { history: [{ type: "Proficiency - MM", date: "2003-02-02" }] }, ctx).mm).toEqual({ status: "met", date: "2003-02-02" });
      expect(evaluate(office, {}, ctx).mm).toEqual({ status: "missing" });
    }
  });
});

describe("evaluate: LMCP count and SD", () => {
  it("count is independent of office, status depends on it", () => {
    const e = edu([HAM, "2025-01-01"], [FIN, "2025-01-01"]);
    expect(evaluate("WM", e, ctx).lmcp).toMatchObject({ status: "missing", count: 2, needed: 4 });
    expect(evaluate("SW", e, ctx).lmcp).toMatchObject({ status: "met", count: 2, needed: 2 });
    expect(evaluate("JW", e, ctx).lmcp).toMatchObject({ status: "met", count: 2, needed: 1 });
  });
  it("counts only courses inside the window, latest date per course", () => {
    const r = evaluate("WM", edu([HAM, "2019-01-01"], [HAM, "2025-01-01"], [ADM, "2020-01-01"], [MEX, "2025-02-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "missing", count: 2 });
  });
  it("SW with no courses shows 0", () => {
    expect(evaluate("SW", {}, ctx).lmcp).toMatchObject({ status: "missing", count: 0, needed: 2 });
  });
  it("SD is info with a count, no expiry and no requirement", () => {
    const r = evaluate("SD", edu([HAM, "2025-01-01"], [FIN, "2025-01-01"], [ADM, "2018-01-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "info", count: 2, needed: 0, expires: null });
    expect(evaluate("SD", {}, ctx).lmcp).toMatchObject({ status: "info", count: 0 });
  });
  it("a SD completion counts as 4/4 with no expiry", () => {
    const r = evaluate("SD", edu(["Lodge Management Certification Program", "2022-11-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "info", count: 4, expires: null });
  });
});

describe("evaluate: LMCP tiers", () => {
  it("WM needs all four, expiring with the oldest", () => {
    const r = evaluate("WM", edu([HAM, "2024-01-01"], [ADM, "2023-05-01"], [MEX, "2025-01-01"], [FIN, "2024-06-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", count: 4, needed: 4, expires: "2028-05-01" });
  });
  it("WM with one course older than 5 years is missing", () => {
    const r = evaluate("WM", edu([HAM, "2024-01-01"], [ADM, "2020-05-01"], [MEX, "2025-01-01"], [FIN, "2024-06-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "missing", count: 3, needed: 4, expires: null });
  });
  it("SW needs Hall Association plus any one other, expiring with the earlier of HAM and the latest other", () => {
    const r = evaluate("SW", edu([HAM, "2025-01-01"], [FIN, "2023-03-01"], [MEX, "2024-03-01"], [ADM, "2022-12-01"]), ctx);
    // HAM expires 2030-01-01; the latest-expiring other (MEX) expires 2029-03-01, an earlier other would give 2028-03-01 or 2027-12-01.
    expect(r.lmcp).toMatchObject({ status: "met", count: 4, needed: 2, expires: "2029-03-01" });
  });
  it("SW expiry is capped by Hall Association when it expires before the others", () => {
    const r = evaluate("SW", edu([HAM, "2023-01-01"], [FIN, "2025-03-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", count: 2, needed: 2, expires: "2028-01-01" });
  });
  it("SW with Hall Association only is missing", () => {
    const r = evaluate("SW", edu([HAM, "2025-01-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "missing", count: 1, needed: 2, expires: null });
  });
  it("SW without Hall Association is missing even with three other courses", () => {
    const r = evaluate("SW", edu([FIN, "2025-01-01"], [MEX, "2025-01-01"], [ADM, "2025-01-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "missing", count: 3, needed: 2 });
  });
  it("JW needs any one, expiring with the newest", () => {
    const r = evaluate("JW", edu([FIN, "2022-12-01"], [MEX, "2025-04-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", count: 2, needed: 1, expires: "2030-04-01" });
  });
  it("a course retaken counts from its latest date", () => {
    const r = evaluate("JW", edu([FIN, "2019-01-01"], [FIN, "2025-02-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", expires: "2030-02-01", courses: [{ type: FIN, date: "2025-02-01" }] });
  });
});

describe("evaluate: LMCP completion and the 5-year window", () => {
  it("a program completion within 5 years meets any tier", () => {
    const r = evaluate("WM", edu(["Lodge Management Certification Program", "2023-01-10"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", count: 4, needed: 4, expires: "2028-01-10", completion: "2023-01-10" });
  });
  it("the completion award counts as a completion", () => {
    const r = evaluate("SW", { awards: [{ type: "Lodge Management Certification Completion Award", date: "2024-02-02" }] }, ctx);
    expect(r.lmcp).toMatchObject({ status: "met", expires: "2029-02-02" });
  });
  it("an old completion falls back to individual courses", () => {
    const r = evaluate("JW", edu(["Lodge Management Certification Program", "2019-01-01"], [ADM, "2024-01-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "met", completion: null, expires: "2029-01-01" });
  });
  it("a course dated exactly 5 years ago no longer counts; one day later it does", () => {
    expect(evaluate("JW", edu([ADM, "2021-10-28"]), ctx).lmcp.status).toBe("missing");
    expect(evaluate("JW", edu([ADM, "2021-10-29"]), ctx).lmcp.status).toBe("expiring");
  });
  it("flags expiring when it lapses before the term starts", () => {
    // Expires 2027-06-01: more than 90 days out, but before a 2028 term starts.
    expect(evaluate("JW", edu([ADM, "2022-06-01"]), { termYear: 2028, today }).lmcp).toMatchObject({ status: "expiring", expires: "2027-06-01" });
    expect(evaluate("JW", edu([ADM, "2022-06-01"]), ctx).lmcp.status).toBe("met");
  });
  it("flags expiring within 90 days even after the term starts", () => {
    const r = evaluate("JW", edu([ADM, "2021-12-15"]), { termYear: 2026, today: "2026-10-28" });
    expect(r.lmcp.status).toBe("expiring");
  });
  it("ignores unknown event types", () => {
    const r = evaluate("JW", edu(["Annual Communication", "2026-01-01"], ["Lodge Audit", "2026-01-01"]), ctx);
    expect(r.lmcp).toMatchObject({ status: "missing", count: 0 });
  });
});
