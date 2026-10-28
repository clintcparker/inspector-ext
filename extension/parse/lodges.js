import { idFromHref, toDoc } from "./dom.js";

export function lodgeNumber(text) {
  const m = /No\.\s*(\d+)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

function fromLink(a) {
  const text = a.textContent.trim();
  return { id: idFromHref(a), name: text.replace(/\s*No\.\s*\d+\s*$/, ""), number: lodgeNumber(text) };
}

// The "Lodges" block on /districts/{id}.
export function parseDistrictLodges(html) {
  const links = toDoc(html).querySelectorAll('.district-sidebar-link a[href^="/lodges/"]');
  if (!links.length) return { ok: false, error: "layout" };
  return { ok: true, data: [...links].map(fromLink) };
}

// The /mems/{id}/sidebar_memberships fragment. No memberships is a valid answer.
export function parseMemberLodges(html) {
  const seen = new Map();
  for (const a of toDoc(html).querySelectorAll('a[href^="/lodges/"]')) {
    const lodge = fromLink(a);
    if (lodge.id != null && !seen.has(lodge.id)) seen.set(lodge.id, lodge);
  }
  return { ok: true, data: [...seen.values()] };
}
