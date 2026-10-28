// Turns stored data into what the dashboard panel draws (spec §5).
import { firstLast } from "../parse/members-list.js";
import { entriesFor } from "./roster.js";
import { OFFICES, evaluate } from "./rules.js";

const CURRENT = { "Worshipful Master": "WM", "Senior Warden": "SW", "Junior Warden": "JW", Treasurer: "Treas", Secretary: "Sec" };

export function buildView({ lodges, roster, members, officers, termYear, today, pending, signedOut }) {
  const stamps = [];
  const stamp = (entry) => {
    if (entry?.fetchedAt) stamps.push(entry.fetchedAt);
  };
  const entries = entriesFor(roster, termYear);
  const view = {
    termYear,
    signedOut,
    pending: pending.size,
    lodges: lodges.map((lodge) => {
      const off = officers[lodge.id];
      stamp(off);
      return {
        id: lodge.id,
        name: lodge.name,
        number: lodge.number,
        current: off?.officers
          ? off.officers.filter((o) => CURRENT[o.office]).map((o) => ({ label: CURRENT[o.office], name: o.name == null ? o.name : firstLast(o.name), memberId: o.memberId }))
          : null,
        currentError: off?.error ?? null,
        rows: OFFICES.map((office) => ({
          office,
          candidates: entries
            .filter((e) => e.lodgeId === lodge.id && e.office === office)
            .map((e) => {
              const m = members[e.memberId];
              stamp(m);
              return {
                memberId: e.memberId,
                name: firstLast(e.name),
                error: m?.error ?? null,
                cells: m?.events ? evaluate(office, m.events, { termYear, today }) : null,
              };
            }),
        })),
      };
    }),
  };
  view.updatedAt = stamps.length ? Math.min(...stamps) : null;
  return view;
}
