import { idFromHref, toDoc } from "./dom.js";
import { lodgeNumber } from "./lodges.js";

// "Last, First Middle" -> "First Middle Last" (splits at the first comma). Anything else is returned trimmed.
export function firstLast(name) {
  const text = String(name).trim();
  const i = text.indexOf(",");
  if (i < 0) return text;
  const last = text.slice(0, i).trim();
  const first = text.slice(i + 1).trim();
  return last && first ? `${first} ${last}` : text;
}

// /districts/district_members: index-aligned with tbody rows (null when a row has no member link).
export function parseMembersList(html) {
  const table = toDoc(html).querySelector("table.list-table");
  if (!table) return { ok: false, error: "layout" };
  const data = [...table.querySelectorAll("tbody tr")].map((tr) => {
    const tds = tr.querySelectorAll("td");
    const a = tds[0]?.querySelector('a[href^="/members/"]');
    return a ? { memberId: idFromHref(a), name: firstLast(a.textContent), lodgeNumber: lodgeNumber(tds[3]?.textContent) } : null;
  });
  return { ok: true, data };
}
