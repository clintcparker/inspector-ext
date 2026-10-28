import { describe, expect, it } from "vitest";
import { addDays, addYears, parseUsDate, todayIso } from "../../extension/lib/dates.js";

describe("dates", () => {
  it("parses mm/dd/yyyy to ISO", () => {
    expect(parseUsDate("3/5/2019")).toBe("2019-03-05");
    expect(parseUsDate(" 12/31/2020 ")).toBe("2020-12-31");
  });
  it("rejects anything else", () => {
    expect(parseUsDate("")).toBeNull();
    expect(parseUsDate("2019-03-05")).toBeNull();
    expect(parseUsDate(undefined)).toBeNull();
  });
  it("adds years and days across boundaries", () => {
    expect(addYears("2021-06-15", 5)).toBe("2026-06-15");
    expect(addYears("2026-06-15", -5)).toBe("2021-06-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addYears("2024-02-29", 5)).toBe("2029-03-01");
  });
  it("formats today from local time", () => {
    expect(todayIso(new Date(2026, 9, 28, 23, 59))).toBe("2026-10-28");
  });
});
