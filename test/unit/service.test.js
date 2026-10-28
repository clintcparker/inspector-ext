// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../extension/lib/cache.js";
import { createService } from "../../extension/lib/service.js";
import { makeSite, route, siteFetch } from "../fixtures/site.mjs";
import { memoryStorage } from "../helpers/memory-storage.mjs";

const ORIGIN = "https://member.freemason.org";
const NOW = new Date(2026, 9, 28, 12).getTime();

function setup({ now = () => NOW, storage = memoryStorage() } = {}) {
  const site = makeSite("2026-10-28");
  const { fetchImpl, state } = siteFetch(site, ORIGIN);
  const service = createService({ storage, fetchImpl, now, queueOptions: { retryDelayMs: 0 } });
  const send = (msg) => service.handle(msg, ORIGIN);
  const districtHtml = route(site, "/districts/123").body;
  return { site, state, storage, service, send, districtHtml };
}
const add = (send, memberId, office, lodgeId, name = `M${memberId}`) => send({ type: "addCandidate", termYear: 2027, lodgeId, office, memberId, name });
const candidate = (view, lodgeId, office, memberId) =>
  view.lodges.find((l) => l.id === lodgeId).rows.find((r) => r.office === office).candidates.find((c) => c.memberId === memberId);

describe("service", () => {
  it("loads the district's lodges, then their current officers", async () => {
    const { send, service, districtHtml, storage } = setup();
    const first = await send({ type: "loadDistrict", html: districtHtml });
    expect(first.lodges.map((l) => l.number)).toEqual([101, 202]);
    expect(first.termYear).toBe(2027);
    await service.idle();
    const v = await send({ type: "view" });
    expect(v.lodges[0].current[0]).toEqual({ label: "WM", name: "Zed Zero", memberId: 2001 });
    expect(v.lodges[0].current.map((o) => o.label)).toEqual(["WM", "SW", "JW", "Treas", "Sec"]);
    expect(v.lodges[0].current[3]).toEqual({ label: "Treas", name: null, memberId: null });
    expect(storage.data.lodges).toHaveLength(2);
  });

  it("fetches a new candidate's four tabs and evaluates them", async () => {
    const { send, service, districtHtml, state } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    const res = await add(send, 1001, "WM", 11);
    expect(res.entries).toEqual([expect.objectContaining({ office: "WM", lodgeId: 11 })]);
    await service.idle();
    expect(state.requests.filter((p) => p.startsWith("/members/1001/"))).toHaveLength(4);
    const c = candidate(await send({ type: "view" }), 11, "WM", 1001);
    expect(c.cells.lmcp).toMatchObject({ status: "met", count: 4 });
    expect(c.cells.ritual.status).toBe("met");
  });

  it("keeps contested candidates side by side and removes one", async () => {
    const { send, service, districtHtml } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1002, "SW", 11);
    await add(send, 1003, "SW", 11);
    await service.idle();
    let v = await send({ type: "view" });
    expect(v.lodges[0].rows[1].candidates.map((c) => c.memberId)).toEqual([1002, 1003]);
    expect(candidate(v, 11, "SW", 1002).cells.lmcp).toMatchObject({ status: "missing", count: 1 });
    v = await send({ type: "removeCandidate", termYear: 2027, lodgeId: 11, office: "SW", memberId: 1002 });
    expect(v.lodges[0].rows[1].candidates.map((c) => c.memberId)).toEqual([1003]);
  });

  it("serves fresh cache without refetching, and refetches after the TTL", async () => {
    let now = NOW;
    const { send, service, districtHtml, state } = setup({ now: () => now });
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1001, "WM", 11);
    await service.idle();
    const count = () => state.requests.length;
    const before = count();
    await send({ type: "loadDistrict", html: districtHtml });
    await service.idle();
    expect(count()).toBe(before);
    now += 8 * DAY_MS;
    await send({ type: "loadDistrict", html: districtHtml });
    await service.idle();
    expect(count()).toBe(before + 2 + 4);
  });

  it("refresh forces a refetch for the chosen scope only", async () => {
    const { send, service, districtHtml, state } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1001, "WM", 11);
    await add(send, 1004, "JW", 22);
    await service.idle();
    const before = state.requests.length;
    await send({ type: "refresh", scope: { memberId: 1004 } });
    await service.idle();
    expect(state.requests.slice(before).every((p) => p.startsWith("/members/1004/"))).toBe(true);
    expect(state.requests.length - before).toBe(4);
  });

  it("flags signed-out and keeps cached data", async () => {
    const { send, service, districtHtml, state } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1001, "WM", 11);
    await service.idle();
    state.signedOut = true;
    await send({ type: "refresh", scope: "all" });
    await service.idle();
    const v = await send({ type: "view" });
    expect(v.signedOut).toBe(true);
    expect(candidate(v, 11, "WM", 1001).cells.lmcp.status).toBe("met");
  });

  it("clears signed-out once a parsed page proves the user is back in", async () => {
    const { send, service, districtHtml, state, storage } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1001, "WM", 11);
    await service.idle();
    state.signedOut = true;
    await send({ type: "refresh", scope: "all" });
    await service.idle();
    expect((await send({ type: "view" })).signedOut).toBe(true);
    state.signedOut = false;
    expect((await send({ type: "loadDistrict", html: districtHtml })).signedOut).toBe(false);
    expect(storage.data.status.signedOut).toBe(false);
  });

  it("keeps both candidates when two adds arrive at once", async () => {
    const { send, service, districtHtml } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await Promise.all([add(send, 1002, "SW", 11), add(send, 1003, "JW", 11)]);
    await service.idle();
    const v = await send({ type: "view" });
    expect(candidate(v, 11, "SW", 1002)).toBeTruthy();
    expect(candidate(v, 11, "JW", 1003)).toBeTruthy();
  });

  it("records a layout error when a tab no longer parses", async () => {
    const { send, service, districtHtml, state } = setup();
    state.override.set("/members/1001/awards", "<html><body>new design</body></html>");
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1001, "WM", 11);
    await service.idle();
    expect(candidate(await send({ type: "view" }), 11, "WM", 1001)).toMatchObject({ error: "layout", cells: null });
  });

  it("rejects bad office codes", async () => {
    const { send } = setup();
    expect(await add(send, 1001, "Tiler", 11)).toEqual({ error: "bad-request" });
  });

  it("rejects a bad term year without touching the stored setting", async () => {
    const { send, storage } = setup();
    await send({ type: "setTermYear", termYear: 2028 });
    for (const bad of ["abc", NaN, undefined, 1999, 2101, 2027.5]) {
      expect(await send({ type: "setTermYear", termYear: bad })).toEqual({ error: "bad-request" });
    }
    expect(storage.data.settings.termYear).toBe(2028);
  });

  it("rejects addCandidate with a bad term year", async () => {
    const { send } = setup();
    for (const bad of ["2027", NaN, undefined, 12]) {
      expect(await send({ type: "addCandidate", termYear: bad, lodgeId: 11, office: "WM", memberId: 1001, name: "x" })).toEqual({ error: "bad-request" });
    }
  });

  it("matches members-list rows to district lodges by number", async () => {
    const { send, districtHtml, site } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    await add(send, 1004, "JW", 22);
    const res = await send({ type: "listRows", html: route(site, "/districts/district_members").body });
    const dan = res.rows.find((r) => r?.memberId === 1004);
    expect(dan.lodges).toEqual([{ id: 22, name: "Sample Lodge", number: 202 }]);
    expect(dan.entries).toEqual([expect.objectContaining({ office: "JW" })]);
    expect(res.termYear).toBe(2027);
  });

  it("offers every district lodge when a list row's lodge is unknown", async () => {
    const { send, districtHtml } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    const html = '<table class="list-table"><tbody><tr><td><a href="/members/5">X, Y</a></td><td></td><td></td><td>Far Lodge No.999</td></tr></tbody></table>';
    expect((await send({ type: "listRows", html })).rows[0].lodges).toHaveLength(2);
  });

  it("resolves a member page's lodges from the membership sidebar", async () => {
    const { send, districtHtml } = setup();
    await send({ type: "loadDistrict", html: districtHtml });
    const res = await send({ type: "memberInfo", memberId: 1004 });
    expect(res.lodges).toEqual([{ id: 22, name: "Sample Lodge", number: 202 }]);
    expect(res.entries).toEqual([]);
  });
});
