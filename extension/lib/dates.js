// Dates are ISO "YYYY-MM-DD" strings so they compare with < and >.

export function parseUsDate(text) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text ?? "");
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function shift(iso, { years = 0, days = 0 }) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d + days)).toISOString().slice(0, 10);
}

export const addYears = (iso, n) => shift(iso, { years: n });
export const addDays = (iso, n) => shift(iso, { days: n });
