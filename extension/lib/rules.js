// Qualification rules for presumptive officers (spec §2.1).
import { addDays, addYears } from "./dates.js";

export const OFFICES = ["WM", "SW", "JW", "SD"];
export const LMCP_COURSES = ["Hall Association Management Exam", "Lodge Administration Exam", "Member Experience Exam", "Finance Exam"];
const HAM = LMCP_COURSES[0];
const COMPLETION_EDUCATIONAL = "Lodge Management Certification Program";
const COMPLETION_AWARD = "Lodge Management Certification Completion Award";
const MM_PROFICIENCY = "Proficiency - MM";
const WINDOW_YEARS = 5;
const WARN_DAYS = 90;
const RITUAL_YEARS = 2;
const NEEDED = { WM: 4, SW: 2, JW: 1, SD: 0 };

const latest = (events = [], type) => events.filter((e) => e.type === type).map((e) => e.date).sort().at(-1) ?? null;
const dated = (date) => (date ? { status: "met", date } : { status: "missing" });
const expiry = (date) => addYears(date, WINDOW_YEARS);

function lmcp(office, events, today) {
  const live = (date) => Boolean(date) && expiry(date) > today;
  const courses = LMCP_COURSES.map((type) => ({ type, date: latest(events.educational, type) })).filter((c) => live(c.date));
  const ham = courses.find((c) => c.type === HAM);
  const others = courses.filter((c) => c !== ham).map((c) => expiry(c.date)).sort().reverse();
  const all = courses.map((c) => expiry(c.date)).sort();
  const needed = NEEDED[office];
  let met;
  let expires = null;
  if (office === "WM") {
    met = courses.length;
    if (met === needed) expires = all[0];
  } else if (office === "SW") {
    met = (ham ? 1 : 0) + Math.min(1, others.length);
    if (met === needed) expires = [expiry(ham.date), others[0]].sort()[0];
  } else if (office === "JW") {
    met = Math.min(1, courses.length);
    if (met === needed) expires = all.at(-1);
  }
  const completionDate = [latest(events.educational, COMPLETION_EDUCATIONAL), latest(events.awards, COMPLETION_AWARD)].filter(Boolean).sort().at(-1);
  const completion = live(completionDate) ? completionDate : null;
  const count = completion ? LMCP_COURSES.length : courses.length;
  if (office === "SD") return { status: "info", count, needed, expires: null, courses, completion };
  if (completion && (!expires || expiry(completion) > expires)) expires = expiry(completion);
  return { status: expires ? "met" : "missing", count, needed, expires, courses, completion };
}

function ritual(office, events, today) {
  const date = latest(events.proficiency, `${office} Officer Qualification`);
  if (!date) return { status: "missing" };
  const expires = addYears(date, RITUAL_YEARS);
  return expires > today ? { status: "met", date, expires } : { status: "expired", date, expires };
}

export function evaluate(office, events, { termYear, today }) {
  const mmDate = latest(events.history, MM_PROFICIENCY);
  const cells = {
    mm: office === "SD" ? (mmDate ? { status: "info", date: mmDate } : { status: "na" }) : dated(mmDate),
    ritual: ritual(office, events, today),
    lmcp: lmcp(office, events, today),
  };
  const lapsing = (c) => c.expires < `${termYear}-01-01` || c.expires <= addDays(today, WARN_DAYS);
  for (const c of [cells.lmcp, cells.ritual]) if (c.status === "met" && lapsing(c)) c.status = "expiring";
  return cells;
}
