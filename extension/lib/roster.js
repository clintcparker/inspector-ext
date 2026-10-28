// roster: { "<termYear>": [{ lodgeId, office, memberId, name, addedAt }] }
const same = (a, b) => a.lodgeId === b.lodgeId && a.office === b.office && a.memberId === b.memberId;

export const entriesFor = (roster, termYear) => roster[String(termYear)] ?? [];

export function addEntry(roster, termYear, entry) {
  const list = entriesFor(roster, termYear);
  if (list.some((e) => same(e, entry))) return roster;
  return { ...roster, [String(termYear)]: [...list, entry] };
}

export function removeEntry(roster, termYear, key) {
  return { ...roster, [String(termYear)]: entriesFor(roster, termYear).filter((e) => !same(e, key)) };
}
