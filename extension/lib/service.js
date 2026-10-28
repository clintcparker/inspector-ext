// Background logic, free of browser.* so it can be unit-tested. Owns the
// roster, the fetch queue and the cache (spec §4).
import { isSignInResponse } from "../parse/auth.js";
import { parseMemberEvents } from "../parse/events.js";
import { parseDistrictLodges, parseMemberLodges } from "../parse/lodges.js";
import { parseMembersList } from "../parse/members-list.js";
import { parseLodgeOfficers } from "../parse/officers.js";
import { isFresh, memberKey, officersKey } from "./cache.js";
import { todayIso } from "./dates.js";
import { createQueue } from "./queue.js";
import { addEntry, entriesFor, removeEntry } from "./roster.js";
import { OFFICES } from "./rules.js";
import { buildView } from "./view.js";

const TABS = [
  { key: "proficiency", path: "proficiency_events" },
  { key: "educational", path: "educational_events" },
  { key: "awards", path: "awards" },
  { key: "history", path: "history" },
];

const validYear = (y) => Number.isInteger(y) && y >= 2000 && y <= 2100;

export function createService({ storage, fetchImpl, now = () => Date.now(), log = () => {}, queueOptions = {} }) {
  const queue = createQueue({ fetchImpl, ...queueOptions });
  const pending = new Set();
  const running = new Set();
  let signedOut = false;
  let chain = Promise.resolve();

  // Read-modify-write edits run one at a time; a rejection doesn't poison later ones.
  const serial = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };

  async function load() {
    const { lodges = [], roster = {}, settings = {} } = await storage.get(["lodges", "roster", "settings"]);
    const s = { ttlDays: 7, ...settings };
    return { lodges, roster, settings: s, termYear: s.termYear ?? new Date(now()).getFullYear() + 1 };
  }

  const touch = () => storage.set({ status: { pending: pending.size, signedOut, at: now() } });

  const signedIn = async () => {
    if (!signedOut) return;
    signedOut = false;
    await touch();
  };

  function schedule(p) {
    const tracked = p.catch((e) => log(`refresh failed: ${e?.name ?? "error"}`)).finally(() => running.delete(tracked));
    running.add(tracked);
  }

  async function fetchPage(origin, path) {
    const r = await queue.get(origin + path);
    if (!r.ok) {
      log(`fetch failed kind=${r.error}${r.status ? ` status=${r.status}` : ""}`);
      return { error: "fetch" };
    }
    if (isSignInResponse(r.url, r.text)) {
      signedOut = true;
      return { error: "signedOut" };
    }
    signedOut = false;
    return { text: r.text };
  }

  // Runs one refresh; `work` resolves to { entry } or { error: "fetch"|"signedOut" }.
  async function refresh(key, work) {
    if (pending.has(key)) return;
    pending.add(key);
    try {
      await touch();
      const result = await work();
      if (result.error === "signedOut") return;
      const { [key]: old } = await storage.get(key);
      await storage.set({ [key]: result.error ? { ...old, error: result.error } : result.entry });
    } finally {
      pending.delete(key);
      await touch();
    }
  }

  const refreshOfficers = (origin, lodgeId) =>
    refresh(officersKey(lodgeId), async () => {
      const page = await fetchPage(origin, `/ous/${lodgeId}/ou_officers`);
      if (page.error) return page;
      const parsed = parseLodgeOfficers(page.text);
      return { entry: parsed.ok ? { fetchedAt: now(), officers: parsed.data } : { fetchedAt: now(), error: "layout" } };
    });

  const refreshMember = (origin, memberId) =>
    refresh(memberKey(memberId), async () => {
      const pages = await Promise.all(TABS.map((t) => fetchPage(origin, `/members/${memberId}/${t.path}`)));
      const failed = pages.find((p) => p.error === "signedOut") ?? pages.find((p) => p.error);
      if (failed) return failed;
      const events = {};
      for (const [i, t] of TABS.entries()) {
        const parsed = parseMemberEvents(pages[i].text);
        if (!parsed.ok) return { entry: { fetchedAt: now(), error: "layout" } };
        events[t.key] = parsed.data;
      }
      return { entry: { fetchedAt: now(), events } };
    });

  async function refreshStale(origin, force, scope = "all") {
    const { lodges, roster, settings, termYear } = await load();
    const inLodge = (lodgeId) => scope === "all" || scope.lodgeId === lodgeId;
    const lodgeIds = lodges.map((l) => l.id).filter(inLodge);
    const memberIds = [...new Set(entriesFor(roster, termYear)
      .filter((e) => (scope.memberId ? e.memberId === scope.memberId : inLodge(e.lodgeId)))
      .map((e) => e.memberId))];
    const keys = [...lodgeIds.map(officersKey), ...memberIds.map(memberKey)];
    const cached = keys.length ? await storage.get(keys) : {};
    const stale = (key) => force || !isFresh(cached[key], now(), settings.ttlDays);
    for (const id of lodgeIds) if (stale(officersKey(id))) schedule(refreshOfficers(origin, id));
    for (const id of memberIds) if (stale(memberKey(id))) schedule(refreshMember(origin, id));
  }

  async function view() {
    const { lodges, roster, termYear } = await load();
    const ids = [...new Set(entriesFor(roster, termYear).map((e) => e.memberId))];
    const keys = [...ids.map(memberKey), ...lodges.map((l) => officersKey(l.id))];
    const got = keys.length ? await storage.get(keys) : {};
    return buildView({
      lodges,
      roster,
      termYear,
      members: Object.fromEntries(ids.map((id) => [id, got[memberKey(id)]])),
      officers: Object.fromEntries(lodges.map((l) => [l.id, got[officersKey(l.id)]])),
      today: todayIso(new Date(now())),
      pending,
      signedOut,
    });
  }

  const forMember = (roster, termYear, memberId) => entriesFor(roster, termYear).filter((e) => e.memberId === memberId);

  async function handle(msg, origin) {
    switch (msg.type) {
      case "loadDistrict": {
        const parsed = parseDistrictLodges(msg.html);
        if (!parsed.ok) return { error: "layout" };
        await signedIn();
        await storage.set({ lodges: parsed.data });
        await refreshStale(origin, false);
        return view();
      }
      case "view":
        return view();
      case "setTermYear": {
        const termYear = Number(msg.termYear);
        if (!validYear(termYear)) return { error: "bad-request" };
        await serial(async () => {
          const { settings } = await load();
          await storage.set({ settings: { ...settings, termYear } });
        });
        await refreshStale(origin, false);
        return view();
      }
      case "refresh":
        await refreshStale(origin, true, msg.scope ?? "all");
        return view();
      case "addCandidate": {
        if (!OFFICES.includes(msg.office) || !Number.isInteger(msg.memberId) || !Number.isInteger(msg.lodgeId) || !validYear(msg.termYear)) return { error: "bad-request" };
        const { next, settings } = await serial(async () => {
          const { roster, settings } = await load();
          const entry = { lodgeId: msg.lodgeId, office: msg.office, memberId: msg.memberId, name: String(msg.name ?? ""), addedAt: now() };
          const next = addEntry(roster, msg.termYear, entry);
          await storage.set({ roster: next });
          return { next, settings };
        });
        const { [memberKey(msg.memberId)]: cached } = await storage.get(memberKey(msg.memberId));
        if (!isFresh(cached, now(), settings.ttlDays)) schedule(refreshMember(origin, msg.memberId));
        return { entries: forMember(next, msg.termYear, msg.memberId) };
      }
      case "removeCandidate": {
        await serial(async () => {
          const { roster } = await load();
          await storage.set({ roster: removeEntry(roster, msg.termYear, msg) });
        });
        return view();
      }
      case "memberInfo": {
        const { lodges, roster, termYear } = await load();
        const page = await fetchPage(origin, `/mems/${msg.memberId}/sidebar_memberships`);
        const mine = page.text ? parseMemberLodges(page.text).data : [];
        const matches = lodges.filter((l) => mine.some((m) => m.id === l.id));
        return { termYear, lodges: matches.length ? matches : lodges, entries: forMember(roster, termYear, msg.memberId) };
      }
      case "listRows": {
        const parsed = parseMembersList(msg.html);
        if (!parsed.ok) return { error: "layout" };
        await signedIn();
        const { lodges, roster, termYear } = await load();
        const rows = parsed.data.map((r) => {
          if (!r) return null;
          const matches = lodges.filter((l) => l.number === r.lodgeNumber);
          return { memberId: r.memberId, name: r.name, lodges: matches.length === 1 ? matches : lodges, entries: forMember(roster, termYear, r.memberId) };
        });
        return { termYear, rows };
      }
      case "ping":
        return { pending: pending.size };
      default:
        return { error: "unknown-message" };
    }
  }

  async function idle() {
    while (running.size) await Promise.all([...running]);
  }

  return { handle, idle };
}
