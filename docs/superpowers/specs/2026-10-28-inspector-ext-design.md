# inspector-ext: design spec

- **Date:** 2026-10-28
- **Status:** approved in brainstorming, awaiting spec review
- **Target:** Firefox (addons.mozilla.org), Manifest V3
- **Site:** `https://member.freemason.org` (Grand Lodge of California member site, iMember)

## 1. Purpose

A Masonic Inspector oversees the lodges of one district. On the member site, the inspector has to go through many pages to answer two questions:

1. **Who are the current officers of each lodge?**
2. **Are next year's presumptive officers qualified to serve?** This means checking each candidate's proficiency, the ritual qualification the inspector records, and the Lodge Management Certification Program (LMCP) courses, against what each office requires.

The extension answers both in one panel on the district dashboard.

### Non-goals

- Writing to the site. The extension never submits forms or records events; it only reads.
- Inferring presumptive officers from progression or election results. The inspector builds the roster by hand.
- Offices other than WM, SW, JW and SD; districts other than the one being viewed; AMO signing and submission (deferred).

## 2. Requirements

### 2.1 Qualification rules

These rules were confirmed by the user on 2026-10-28.

Sources:
- The Leader, October and November 2026, "Officers' Checklist" under Senior Warden + Executive Committee.
- Grand Lecturer, "Qualifications for Master and Wardens", 2019-06-25.
- The user: the 5-year window, and the rule that a completion counts.
- California Masonic Code §805.510–.560 (Certificates of Qualification).

| Requirement | WM | SW | JW | SD | Site record |
|---|---|---|---|---|---|
| Master Mason's proficiency | ✓ | ✓ | ✓ | shown, not required | History tab: event "Proficiency - MM" |
| Ritual qualification with the inspector, dated within the last 24 months | WM | SW | JW | SD | Proficiency tab: "WM Officer Qualification" / "SW …" / "JW …" / "SD …" (the office being stood for) |
| LMCP | all 4 courses | Hall Association Management + any 1 other | any 1 course | not required (count shown, gray) | Educational tab, Awards tab |

**The four LMCP courses** appear on the Educational tab as these event types: "Hall Association Management Exam", "Lodge Administration Exam", "Member Experience Exam", "Finance Exam".

**The LMCP 5-year window** is measured back from **today**. *Term start* is 1 January of the term year, and the status uses it to flag a qualification that will lapse before installation (§2.2).

1. If the member has a program completion dated within 5 years before today, LMCP is **met** for every office. A program completion is an Educational event "Lodge Management Certification Program" or an Awards event "Lodge Management Certification Completion Award". Its expiry is the completion date plus 5 years.
2. Otherwise, a course counts only if its most recent exam is dated within 5 years before today. The office's tier is checked against the courses that count. Courses are cumulative: one taken in an earlier year still counts while inside the window.
3. **Expiry** = the earliest date at which the set of counting courses would stop meeting the tier.

**MM proficiency never expires.** The most recent matching event counts. For SD it is shown (gray, date only) but not required; with no date the cell reads n/a.

**Ritual qualification must be within the last 24 months.** The most recent matching event counts only if its date plus 2 years is after today; a date exactly 24 months ago is out (same convention as the LMCP window). An older date is **expired** (red); no event is **missing**. Like LMCP, it is **expiring** (amber) while still valid if it lapses before the term start or within 90 days of today. This applies to every office, SD included.

### 2.2 Statuses

Each requirement cell resolves to one of these:
- **met** (✓, with date);
- **expiring** (!): met today, but the expiry date falls before the term start or within 90 days of today;
- **missing** (✗);
- **expired** (✗, red, with date): ritual qualification older than 24 months (ritual also uses **expiring**, as above);
- **info** (gray, no mark): shown for SD only, where the item is not required;
- **n/a**;
- **loading**;
- **error** (⚠, with reason).

The LMCP cell always shows `count/4`, the number of the four courses within the 5-year window (a live program completion counts as 4/4), plus the expiry year when there is one. Its mark and colour come from the office requirement (WM all 4, SW Hall Association Management + 1 other, JW 1). For SD it is gray `count/4`, with no mark, expiry or expiring logic.

### 2.3 Presumptive roster

- The inspector adds a member as presumptive **WM, SW, JW or SD** of a lodge, for a **term year**. The term year defaults to the next calendar year and can be changed in the panel.
- An office can have **any number of candidates**, for contested elections.
- Entries persist until the inspector removes them. They are never inferred, changed or expired automatically.

## 3. Site structure (from the 2026-09-10 capture)

All pages are server-rendered Rails HTML. Some blocks load as async HTML fragments. There is no JSON API. IDs are preserved across redirects: `/lodges/{id}` → `/ous/{id}` and `/members/{id}` → `/mems/{id}`.

| Page | Used for | Key markup |
|---|---|---|
| `/districts/{id}` | Panel host; list of the district's lodges | "Lodges" block: `.district-sidebar-link a[href^="/lodges/"]`, text "Name No. 999" |
| `/ous/{lodgeId}/ou_officers` | Current officers (feature 1) | `table.info-table` rows: `td` office name, `td a[href^="/members/"]` member |
| `/districts/district_members` | Add control on each row | Paginated `table.list-table`: name `a[href^="/members/"]`, member #, status, lodge text "… No. 999" |
| `/mems/{memberId}` | Add control | Sidebar fragment `/mems/{id}/sidebar_memberships`: lodge links `a[href^="/lodges/"]` |
| `/members/{id}/proficiency_events`, `/educational_events`, `/awards`, `/history` | Events for the rules | `.div-table-body .div-table-row`: event type in `.table-col-lg`, date (mm/dd/yyyy) in `.table-col-med` |

## 4. Architecture

```
member.freemason.org tabs                         background event page
┌──────────────────────────────┐   messages   ┌──────────────────────────────┐
│ panel.js     (/districts/{n})│ ───────────▶ │ roster store                 │
│ add-member.js (/mems/{n})    │ ◀─────────── │ cache (stale-while-revalidate│
│ add-list.js  (district_      │  push update │ fetch queue (≤2, timeout,    │
│               members)       │              │   1 retry)                   │
└──────────────────────────────┘              │ parsers ─▶ rules             │
        display + input only                  └──────────────────────────────┘
                                                      │ fetch, with cookies
                                                      ▼
                                                member.freemason.org
```

### 4.1 Units

Each unit has one job. Units marked *pure* use no `browser.*` and are unit-tested in isolation.

| Unit | Job | Depends on |
|---|---|---|
| `parse/*.js` (pure) | Turn HTML into data. One module per page type: `lodgeOfficers`, `memberEvents` (shared by the four event tabs), `districtLodges`, `memberLodges`, `memberListRows`. Each returns `{ok:true, data}` or `{ok:false, error:'layout'}` when the expected anchors are absent. | `DOMParser` (injected) |
| `rules.js` (pure) | `evaluate(office, events, { termYear, today })` returns per-requirement status, dates, course counts and expiry. | none |
| `cache.js` (pure core) | Time-to-live and freshness decisions over an injected storage adapter. | storage adapter |
| `queue.js` (pure core) | Concurrency-limited fetch queue with timeout and retry, over an injected `fetch`. | fetch adapter |
| `roster.js` | CRUD on roster entries in `storage.local`. | storage adapter |
| `background.js` | Wires everything together: message handlers, fetch → parse → cache → push. | all of the above |
| `panel.js` | Renders the panel and handles remove and refresh. | messages |
| `add-member.js`, `add-list.js` | Inject the "Add as presumptive…" controls. | messages |

### 4.2 Storage (`storage.local`)

```js
roster:            { "<termYear>": [{ lodgeId, office: "WM"|"SW"|"JW"|"SD", memberId, name, addedAt }] }
member:<memberId>: { fetchedAt, events: { proficiency: [...], educational: [...], awards: [...], history: [...] }, error? }
officers:<lodgeId>:{ fetchedAt, officers: [{ office, memberId, name }], error? }
settings:          { termYear?, ttlDays: 7 }
// event: { type: string, date: "YYYY-MM-DD" }
```

The cache stores only what the rules and the panel need: event types and dates, member names and IDs. It does not store comments, emails or the "submitted by" fields.

### 4.3 Messages

All messages go from a content script to the background script. The background builds the whole view model, including the rule results, so the panel only draws it.

| Message | From | Payload → reply |
|---|---|---|
| `loadDistrict` | panel | `{ html }` of the dashboard. The background parses and stores the lodges and schedules stale fetches. → View |
| `view` | panel | → View |
| `setTermYear` | panel | `{ termYear }` → View |
| `refresh` | panel | `{ scope: "all" \| {lodgeId} \| {memberId} }`, which forces a refetch. → View |
| `removeCandidate` | panel | `{ termYear, lodgeId, office, memberId }` → View |
| `addCandidate` | add controls | `{ termYear, lodgeId, office, memberId, name }` → `{ entries }` for that member |
| `memberInfo` | member page | `{ memberId }`. The background reads the membership sidebar. → `{ termYear, lodges, entries }` |
| `listRows` | members list | `{ html }` of the table → `{ termYear, rows }` with lodges matched by number |
| `ping` | panel | Keeps the event page alive while fetches are pending. |

**Updates reach open tabs through `storage.onChanged`.** The background writes each cache entry, the roster, and a `status` key (`{ pending, signedOut }`) to `storage.local`. Content scripts listen, debounce, and ask for `view` again, so no tab tracking is needed.

### 4.4 Data flow

1. The panel loads and sends `loadDistrict` with the page HTML.
2. The background script stores the lodges and replies at once with a View built from the roster and the cache. The panel renders it, showing "loading" in cells with no data yet.
3. The background script queues fetches for missing or stale entries (older than `ttlDays`, default 7). It fetches the four event tabs for each rostered member and `ou_officers` for each lodge.
4. Each completed entry is parsed and written to `storage.local`. The resulting `storage.onChanged` makes the panel request a new View and redraw.
5. `addCandidate` saves the entry and, unless the cache is fresh, fetches that member at once. Every open dashboard tab updates through `storage.onChanged`.

### 4.5 Manifest

- `host_permissions: ["https://member.freemason.org/*"]`, `permissions: ["storage"]`.
- Content scripts match `https://member.freemason.org/districts/*` and `https://member.freemason.org/mems/*`. Each script checks the path at runtime: `^/districts/\d+$` for the panel, `^/districts/district_members` for the list, and `^/mems/\d+$` for the member page.
- `data_collection_permissions: {"required":["none"]}`, since nothing leaves the browser except requests to the site itself. The `gecko` and `gecko_android` minimum versions follow `CLAUDE.md`.
- A test-only manifest variant adds `http://localhost/*` to the matches and host permissions.

## 5. UI

The panel is a block at the top of the district dashboard's main column. It uses the site's `info-table` styling and sets no global styles.

```
┌ Inspector: Presumptive Officers · Term 2027 ▾ ── updated 2 d ago · ⟳ ┐
│ Example Lodge No. 999                                         ⟳     │
│   Current: WM A. A · SW B. B · JW C. C · Treas vacant · Sec D. D    │
│   Office  Candidate     MM prof.     Ritual qual.   LMCP            │
│   WM      B. Bbbb ↗     ✓ 03/2019    ✓ 10/2026      ✓ 4/4 · 2029 ✕  │
│   SW      C. Cccc ↗     ✓ 05/2021    ✗ missing      ✗ 1/4         ✕  │
│   SW      E. Eeee ↗     ✓ 01/2020    ✗ 08/2023      ! 2/4 · 2027 ✕  │
│   JW      (none yet: add from a member's page or the members list)  │
│   SD      F. Ffff ↗     03/2019      ✓ 09/2026      2/4          ✕  │
└─────────────────────────────────────────────────────────────────────┘
```

- Every office row is shown, even with no candidates.
- Hovering over a cell shows its dates and course names; an expired ritual shows `Expired <date>`, and LMCP lists each live course, any program completion, and the office requirement. ↗ opens the member's record.
- ✕ asks "Remove?" inline. The extension never uses `alert`, `confirm` or `prompt`.
- **"Add as presumptive…" control:** a select listing WM/SW/JW/SD and an Add button. The term year comes from the settings and is changed in the panel.
  - On the member page, the lodge comes from the sidebar. If the member has several memberships in the district, the inspector picks one.
  - On a members-list row, the lodge number is matched against the district lodges cached from the last dashboard visit. If none is cached, or the match is ambiguous, the inspector picks the lodge.
  - The control shows "Already presumptive SW for 2027" when it applies.

## 6. Error handling

| Condition | Detection | Behaviour |
|---|---|---|
| Signed out or session expired | Redirect to, or response body of, the sign-in page | Banner: "Sign in to member.freemason.org to refresh". Cached data stays shown, marked stale. No retry loop. |
| Slow site or timeout | 60-second timeout per request | One retry after 5 s. Then that row shows "⚠ couldn't refresh · retry" and its cached data stays. |
| Markup changed | Parser anchors absent, so `{ok:false, error:'layout'}` | "Site layout changed: data may be wrong". This is never treated as "no events". |
| Unknown event type | No match in the rules' vocabulary | Ignored. A rule never passes on a guess. |
| Ambiguous lodge on add | Zero or more than one district lodge matches | The inspector chooses. |

Every log line is prefixed `[inspector-ext]`. Logs never include member names or IDs, only counts and request kinds.

## 7. Testing

- **Unit (Vitest):**
  - parsers against synthetic HTML fixtures that copy the captured markup with made-up data, including empty and layout-changed cases;
  - a table-driven `rules.evaluate` covering every tier, cumulative courses, a completion versus individual courses, the 5-year boundary, expiry before the term, and missing MM proficiency;
  - `cache` freshness and stale-while-revalidate;
  - `queue` concurrency cap, timeout and retry, with fake timers.
- **End-to-end (Puppeteer over BiDi, existing `test/e2e.mjs` patterns):**
  - A localhost fixture server copies the site's paths with synthetic data, plus a sign-in redirect. Timeouts and retries are covered by the unit tests.
  - Scenarios: add a candidate from the members list and from the member page; the panel renders statuses; a contested office shows two rows; remove works; cached data renders after a reload before any fetch completes; the signed-out banner appears.
- **Fixtures are synthetic.** Nothing from `research/site-capture/` is committed.

## 8. Risks and the first spike

1. **Cookies on background requests.** A manual check, before the build, that a background-page `fetch` to `member.freemason.org` with `credentials: 'include'` is authenticated in a normal Firefox profile. `SameSite` handling and cookie partitioning for extension requests are the unknowns. **Fallback:** the content script makes the requests (same-origin) at the background script's request, and the background script keeps the queue, cache and roster.
2. **Members-list lodge text and member-page sidebar markup** have each been seen in only one capture. The parsers fail loudly with `layout`, as in §6.
3. **Term start is assumed to be 1 January.** It only affects the "expiring" warning. If installation day should be used instead, only `rules.js` changes.
4. The `/members/{id}/…` event tabs were seen through redirects from `/mems/{id}`. If direct fetches to them fail, the spike also checks that.
