// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isSignInResponse } from "../../extension/parse/auth.js";
import { parseMemberEvents } from "../../extension/parse/events.js";
import { lodgeNumber, parseDistrictLodges, parseMemberLodges } from "../../extension/parse/lodges.js";
import { firstLast, parseMembersList } from "../../extension/parse/members-list.js";
import { parseLodgeOfficers } from "../../extension/parse/officers.js";
import { districtPage, emptyEventsTab, eventsTab, membersList, officersFragment, sidebarMemberships, signInPage } from "../fixtures/site.mjs";

const LAYOUT = { ok: false, error: "layout" };
const unrelated = "<!DOCTYPE html><html><body><p>Something else</p></body></html>";

describe("parseMemberEvents", () => {
  it("reads type and ISO date from each body row, skipping the heading row", () => {
    const html = eventsTab("Award Type", [{ type: "WM Officer Qualification", date: "2026-09-01" }, { type: "Finance Exam", date: "2022-01-15" }]);
    expect(parseMemberEvents(html)).toEqual({ ok: true, data: [
      { type: "WM Officer Qualification", date: "2026-09-01" },
      { type: "Finance Exam", date: "2022-01-15" },
    ] });
  });
  it("returns an empty list for an empty tab", () => {
    expect(parseMemberEvents(eventsTab("Award Type", []))).toEqual({ ok: true, data: [] });
  });
  it("returns an empty list for the site's \"~No … Found~\" placeholder", () => {
    expect(parseMemberEvents(emptyEventsTab("Awards"))).toEqual({ ok: true, data: [] });
    expect(parseMemberEvents(emptyEventsTab("Educational Events"))).toEqual({ ok: true, data: [] });
  });
  it("reports layout when the event table is missing", () => {
    expect(parseMemberEvents(unrelated)).toEqual(LAYOUT);
  });
});

describe("parseLodgeOfficers", () => {
  it("reads office, member id and name, allowing vacant offices", () => {
    const html = officersFragment([{ office: "Worshipful Master", memberId: 7, name: "Ann Example" }, { office: "Tiler", memberId: null, name: null }]);
    expect(parseLodgeOfficers(html)).toEqual({ ok: true, data: [
      { office: "Worshipful Master", memberId: 7, name: "Ann Example" },
      { office: "Tiler", memberId: null, name: null },
    ] });
  });
  it("reports layout without an Officers table", () => {
    expect(parseLodgeOfficers(unrelated)).toEqual(LAYOUT);
  });
});

describe("lodges", () => {
  const lodges = [{ id: 11, name: "Example Lodge", number: 101 }, { id: 22, name: "Sample Lodge", number: 202 }];
  it("reads the district's lodge links", () => {
    expect(parseDistrictLodges(districtPage({ number: 123, lodges }))).toEqual({ ok: true, data: lodges });
  });
  it("reports layout when the Lodges block is missing", () => {
    expect(parseDistrictLodges(unrelated)).toEqual(LAYOUT);
  });
  it("reads lodge links from the membership sidebar, de-duplicated", () => {
    expect(parseMemberLodges(sidebarMemberships([lodges[1], lodges[1]]))).toEqual({ ok: true, data: [lodges[1]] });
    expect(parseMemberLodges("")).toEqual({ ok: true, data: [] });
  });
  it("extracts lodge numbers with or without a space", () => {
    expect(lodgeNumber("Example Lodge No.101")).toBe(101);
    expect(lodgeNumber("Example Lodge No. 101")).toBe(101);
    expect(lodgeNumber("Example Lodge")).toBeNull();
  });
});

describe("parseMembersList", () => {
  it("returns one entry per row with the lodge number", () => {
    const html = membersList([{ memberId: 5, name: "Example, Ann", memberNumber: 1, status: "Master Mason", lodge: "Example Lodge No.101" }]);
    expect(parseMembersList(html)).toEqual({ ok: true, data: [{ memberId: 5, name: "Ann Example", lodgeNumber: 101 }] });
  });
  it("accepts a bare table (what the content script sends)", () => {
    const html = '<table class="list-table"><tbody><tr><td>no link</td></tr><tr><td><a href="/members/9">Doe, J</a></td><td></td><td></td><td>X Lodge No.7</td></tr></tbody></table>';
    expect(parseMembersList(html).data).toEqual([null, { memberId: 9, name: "J Doe", lodgeNumber: 7 }]);
  });
  it("reports layout without the list table", () => {
    expect(parseMembersList(unrelated)).toEqual(LAYOUT);
  });
});

describe("isSignInResponse", () => {
  it("detects the sign-in page by URL or by its password field", () => {
    expect(isSignInResponse("https://member.freemason.org/users/sign_in", "")).toBe(true);
    expect(isSignInResponse("https://member.freemason.org/members/1/awards", signInPage())).toBe(true);
    expect(isSignInResponse("https://member.freemason.org/members/1/awards", eventsTab("Award Type", []))).toBe(false);
  });
});

describe("firstLast", () => {
  it("turns \"Last, First\" into \"First Last\", splitting at the first comma", () => {
    expect(firstLast("Doe, Jane")).toBe("Jane Doe");
    expect(firstLast("Smith Jr., John Paul")).toBe("John Paul Smith Jr.");
  });
  it("trims whitespace around each part", () => {
    expect(firstLast("  Doe ,  Jane  ")).toBe("Jane Doe");
  });
  it("returns names without a comma or with an empty part trimmed but unchanged", () => {
    expect(firstLast("Madonna")).toBe("Madonna");
    expect(firstLast("Doe,")).toBe("Doe,");
    expect(firstLast(" , Jane ")).toBe(", Jane");
  });
});
