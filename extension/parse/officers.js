import { idFromHref, toDoc } from "./dom.js";

// The /ous/{id}/ou_officers fragment: one row per office.
export function parseLodgeOfficers(html) {
  const table = [...toDoc(html).querySelectorAll("table.info-table")]
    .find((t) => t.querySelector("thead h5")?.textContent.trim() === "Officers");
  if (!table) return { ok: false, error: "layout" };
  const data = [];
  for (const tr of table.querySelectorAll("tbody tr")) {
    const [officeTd, memberTd] = tr.querySelectorAll("td");
    const office = officeTd?.textContent.trim();
    if (!office) continue;
    const a = memberTd?.querySelector('a[href^="/members/"]');
    data.push({ office, memberId: a ? idFromHref(a) : null, name: a ? a.textContent.trim() : null });
  }
  return { ok: true, data };
}
