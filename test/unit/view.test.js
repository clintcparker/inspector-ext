import { describe, expect, it } from "vitest";
import { buildView } from "../../extension/lib/view.js";

const lodges = [{ id: 11, name: "Example Lodge", number: 101 }];
const base = { lodges, termYear: 2027, today: "2026-10-28", pending: new Set(), signedOut: false };
const roster = { 2027: [
  { lodgeId: 11, office: "SW", memberId: 1, name: "A", addedAt: 1 },
  { lodgeId: 11, office: "SW", memberId: 2, name: "B", addedAt: 2 },
] };

describe("buildView", () => {
  it("lists every office per lodge with candidates in roster order", () => {
    const v = buildView({ ...base, roster, members: {}, officers: {} });
    expect(v.lodges[0].rows.map((r) => r.office)).toEqual(["WM", "SW", "JW", "SD"]);
    expect(v.lodges[0].rows[1].candidates.map((c) => c.memberId)).toEqual([1, 2]);
    expect(v.lodges[0].rows[0].candidates).toEqual([]);
  });
  it("leaves uncached candidates without cells, and evaluates cached ones", () => {
    const members = { 1: { fetchedAt: 500, events: { proficiency: [{ type: "SW Officer Qualification", date: "2026-01-01" }] } } };
    const v = buildView({ ...base, roster, members, officers: {}, pending: new Set(["member:1"]) });
    const [a, b] = v.lodges[0].rows[1].candidates;
    expect(a).toMatchObject({ error: null });
    expect(a.cells.ritual).toEqual({ status: "met", date: "2026-01-01", expires: "2028-01-01" });
    expect(a.cells.lmcp).toMatchObject({ status: "missing", count: 0, needed: 2 });
    expect(b).toMatchObject({ cells: null });
    expect(v.pending).toBe(1);
    expect(v.updatedAt).toBe(500);
  });
  it("shows SD as informational: MM na without a date, LMCP info with a count", () => {
    const sd = { 1: { fetchedAt: 500, events: { educational: [{ type: "Finance Exam", date: "2025-01-01" }] } } };
    const v = buildView({ ...base, roster: { 2027: [{ lodgeId: 11, office: "SD", memberId: 1, name: "A", addedAt: 1 }] }, members: sd, officers: {} });
    const [c] = v.lodges[0].rows[3].candidates;
    expect(c.cells.mm).toEqual({ status: "na" });
    expect(c.cells.lmcp).toMatchObject({ status: "info", count: 1 });
  });
  it("surfaces layout and fetch errors without cells", () => {
    const members = { 1: { fetchedAt: 5, error: "layout" }, 2: { error: "fetch" } };
    const [a, b] = buildView({ ...base, roster, members, officers: {} }).lodges[0].rows[1].candidates;
    expect(a).toMatchObject({ error: "layout", cells: null });
    expect(b).toMatchObject({ error: "fetch", cells: null });
  });
  it("summarises current WM, wardens, treasurer and secretary", () => {
    const officers = { 11: { fetchedAt: 9, officers: [
      { office: "Worshipful Master", memberId: 7, name: "W" },
      { office: "Tiler", memberId: 8, name: "T" },
      { office: "Treasurer", memberId: null, name: null },
      { office: "Secretary", memberId: null, name: null },
    ] } };
    const v = buildView({ ...base, roster: {}, members: {}, officers });
    expect(v.lodges[0].current).toEqual([
      { label: "WM", name: "W", memberId: 7 },
      { label: "Treas", name: null, memberId: null },
      { label: "Sec", name: null, memberId: null },
    ]);
    expect(v.lodges[0].currentError).toBeNull();
  });
  it("shows stored \"Last, First\" candidate names as \"First Last\"", () => {
    const r = { 2027: [{ lodgeId: 11, office: "SW", memberId: 1, name: "Baker, Ben", addedAt: 1 }, { lodgeId: 11, office: "SW", memberId: 2, name: "Ann Example", addedAt: 2 }] };
    const v = buildView({ ...base, roster: r, members: {}, officers: {} });
    expect(v.lodges[0].rows[1].candidates.map((c) => c.name)).toEqual(["Ben Baker", "Ann Example"]);
  });
});
