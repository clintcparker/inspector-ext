export const toDoc = (html) => new DOMParser().parseFromString(html, "text/html");

// "/members/123" or "/lodges/11?x" → 123 / 11; null if there is no numeric id.
export function idFromHref(a) {
  const m = /\/(\d+)(?:$|[/?#])/.exec(a.getAttribute("href") ?? "");
  return m ? Number(m[1]) : null;
}
