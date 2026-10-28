import { parseUsDate } from "../lib/dates.js";
import { toDoc } from "./dom.js";

// One member-history tab: Proficiency, Educational, Awards or History.
// An empty tab has no event table, only a "~No … Found~" heading.
export function parseMemberEvents(html) {
  const doc = toDoc(html);
  if (!doc.querySelector(".member-hist-events")) {
    const empty = [...doc.querySelectorAll(".highlight")].some((h) => /^~?\s*No\b.*\bFound\s*~?$/i.test(h.textContent.trim()));
    return empty ? { ok: true, data: [] } : { ok: false, error: "layout" };
  }
  const data = [];
  for (const row of doc.querySelectorAll(".member-hist-events .div-table-body .div-table-row")) {
    const type = row.querySelector(".table-col-lg")?.textContent.trim();
    const date = parseUsDate(row.querySelector(".table-col-med")?.textContent);
    if (type && date) data.push({ type, date });
  }
  return { ok: true, data };
}
