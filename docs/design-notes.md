# inspector-ext design notes

**Status (2026-10-29):** v0.2.0 adds a "Public page" link on lodge dashboards (`/ous/{n}` → `/public_members/memberships/{n}`, same ID) and committee email controls on that public page. v0.1.0 was built and checked on the live site on 2026-10-28. The spec and plan are the source of truth; this file is history.

These are working notes for the design: status, decisions, site structure and the HAR rules. Once the spec is written in `docs/superpowers/specs/`, the spec supersedes the decisions recorded here.

## Where things stand

1. **Toolchain: done and verified.** It was built in `~/claude-code-work-dirs/ff-extension` and moved here, and `npm test` passes.
   - The pieces are web-ext lint, Vitest unit tests, a Puppeteer-over-BiDi e2e test, and the `firefox-devtools` MCP.
   - Details and gotchas are in `CLAUDE.md`. The background research with sources is in `research/firefox-extension-dev-with-claude.md`. The Brain vault page is `skills/firefox-extension-agent-workflow`.
2. **v0.1.0 is implemented** in `extension/` (dashboard panel plus "Add as presumptive…" controls), replacing the `hello-ff` proof-of-concept. It was checked on the live site on 2026-10-28.
3. **Signed on AMO, unlisted channel (2026-10-28):** v0.1.0. Run `npm run sign` (reads `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` from the gitignored `.env`) after bumping `version` in the manifest; the signed `.xpi` lands in `web-ext-artifacts/`.
4. **Committed on `main`**, one commit per plan task plus review fixes.

## The extension to build

A Firefox extension (target: addons.mozilla.org) that improves the **Inspector's dashboard** on member.freemason.org (Grand Lodge of California). The user is a Masonic Inspector. The site makes the user navigate a lot to gather information that should be on one screen, and it is missing direct links.

The user listed these features:

1. **District officers at a glance:** the Master, Wardens and Secretary of every lodge in the district, on one screen.
2. **Qualification status for next year's presumptive officers:**
   - qualifications the inspector has recorded, with dates;
   - LMCP courses completed or missing, with dates;
   - all of it mapped to what each office requires.
   - Context: California Masonic Code §805.510–.560 requires Certificates of Qualification for the Master-elect, Wardens-elect and Senior Deacon. The vault page `projects/freemasonry/freemasonry` has more.

## Brainstorming progress (superpowers:brainstorming)

- [x] Explored context: the user's other extensions. `fastmail-ext` is plain JS with no dependencies, a `src/` layout, Diátaxis docs and spec-kit specs; `kindleext` is a minimal extension.
- [x] Q1: how to study the logged-in site. **Answer: the user exports pages.**
- [x] Analysed the HAR (2026-10-28). Scripts are in the session scratchpad and print masked skeletons only. Findings:
  - The host is `member.freemason.org`. Pages are server-rendered Rails HTML with async HTML fragments (`render_async`). There is no JSON API, so the extension will be a scraper using `fetch` with the session cookie plus `DOMParser`.
  - `/districts/{n}` has a "Lodges" block of `/lodges/{n}` links (2 lodges in the user's district). Each link redirects (302) to `/ous/{n}`. The district page also has a "Lodge Officers" report form with a term-end filter that could serve as an alternative source.
  - `/ous/{n}/ou_officers` is a fragment with a `table.info-table` whose rows are the office name (Worshipful Master … Junior Steward …) and a link to `/members/{n}`. It lists current officers only.
  - `/members/{n}/proficiency_events` holds the inspector-recorded qualifications: "WM/SW/JW/SD Officer Qualification", "Funeral Master", "Officers Coach". Rows are `div.div-table-row` with the type in `.table-col-lg` and the date (mm/dd/yyyy) in `.table-col-med`.
  - `/members/{n}/educational_events` uses the same markup and holds the LMCP pieces: "Lodge Management Certification Program", "Lodge Administration Exam", "Finance Exam", "Member Experience Exam", "Hall Association Management Exam", and others. `/members/{n}/awards` has "Lodge Management Certification Completion Award".
  - `/members/{n}/offices` has the office history with term start and end.
  - `/ou_settings/elections/{n}` lists elections that link to `/lodge_elections/{n}/{n}`. That detail page (the officers-elect) was **not captured**.
- [x] Spike results (2026-10-28), run by the user in their signed-in Firefox on two members:
  - **Background fetches are authenticated.** Every background `fetch(..., {credentials:"include"})` to `/districts/district_members` and `/members/{n}/{proficiency_events,educational_events,awards,history}` returned 200 on the requested path, with no sign-in form. Each took 250–1030 ms. A content-script fetch of `/members/{n}/awards` also returned 200. The §8.1 fallback is not needed.
  - **Empty tabs have no `.member-hist-events`.** For a member with no events, Proficiency, Educational and Awards return only `<div class="cont-child"><h6 class="text-center highlight">~No … Found~</h6></div>` (18–30 characters of body text; the capture shows `~No Awards Found~`). History always has the table. Task 3's `parseMemberEvents` and fixtures were amended to treat that heading as an empty list.
- [x] Q2: how to identify next year's presumptive officers. **Answer: C.** The inspector picks or corrects the presumptive officer for each office, and the extension saves that choice. Not chosen: assuming each officer advances one chair, or reading the election page.
- [x] Requirement from the user: **LMCP must be current within the last 5 years.** 
- [x] Q3: where the view lives. **Answer: A.** A panel injected into the district dashboard `/districts/{n}`, with the presumptive-officer pickers inline in it.
- [x] Q4: how the LMCP 5-year rule is measured. **Answer: C.** A program completion within 5 years qualifies the member: the "Lodge Management Certification Program" educational event or the Completion Award. Without one, each required exam is checked individually for a date within 5 years.
- [x] Q5: which offices require LMCP. The user says Masters and Wardens have different requirements, and The Leader newsletter (monthly, from communications@freemason.org) carries the current officer requirements. The only source read so far is the Grand Lecturer's email "Qualifications for Master and Wardens" (2019-06-25). It defines 4 courses (Hall Association Management, Lodge Administration, Member Experience, Lodge Finance) and these tiers:
  - **JW-elect:** any 1 course;
  - **SW-elect:** Hall Association Management + any 2 others;
  - **WM-elect:** all 4.

  Courses are cumulative. SD has no LMCP requirement. In 2019 there was no expiry. The user's 5-year rule is newer, so the current Leader may have changed the tiers. That isn't confirmed: Leader issues are HTML-only in FMail (the plain text is just a MailerLite "view in browser" tracking link).
- The Leader, October and November 2026 issues (read through the web version). The "Officers' Checklist", under Senior Warden + Executive Committee, lists three requirements for the **presumptive master, wardens and senior deacon**:
  1. Master Mason's proficiency (history event "Proficiency - MM");
  2. qualifying with the inspector in their office's ritual (proficiency events "WM/SW/JW/SD Officer Qualification");
  3. answering "the master, senior warden, and junior warden questions". Since 2019 these are LMCP courses, and they apply to WM/SW/JW only.

  Neither issue states the LMCP tiers or the 5-year window.
- [x] **Rule set confirmed by the user (2026-10-28):** MM proficiency + ritual Officer Qualification for WM/SW/JW/SD; LMCP tiers for JW/SW/WM with the 5-year window as defined in Q4.
- [x] **Correction from the user (2026-10-28):** SW needs Hall Association Management + any 1 other (2 courses), not + 2 others. WM all four and JW any one are unchanged.
- [x] **Display and rule changes from the user (2026-10-28):** ritual Officer Qualification counts only if dated within the last 24 months; MM proficiency is shown but not required for SD (gray); LMCP always shows "#/4" current courses (a live program completion counts as 4/4) with green/red/gray by office requirement; ritual shows the same amber warning as LMCP when it lapses before term start or within 90 days.
- [x] Approach: **2, background fetches and caches; the panel only displays.** The user chose it because member.freemason.org is very slow. Data is cached in `storage.local`, since it changes rarely but is slow to fetch. Scope is the lodges listed on the district page being viewed.
- [x] **Correction from the user:** there is no pre-fill and no assumed progression. The inspector **builds the presumptive roster manually**, adding members as "presumptive WM/SW/JW/SD" from:
  - the member record page (`/mems/{n}`): its sidebar links each membership as `/lodges/{n}`;
  - or the district members list (`/districts/district_members`): a paginated `table.list-table` whose columns are a name linking to `/members/{n}`, the member number, a status, and the lodge as text "… No. 999".

  An office can have **several candidates** (a contested election).
- [x] Design §1 Architecture approved (revised version: manual roster grouped by term year; content scripts only display; the background script owns the roster, the queue of at most 2 concurrent requests, and the 7-day stale-while-revalidate cache; pure parsers and rules; current officers come from the `ou_officers` fragment; the background-cookie spike comes first).
- [x] Design §2 Panel and data flow approved. The panel sits at the top of the district dashboard's main column with one section per lodge and every office always shown. The LMCP cell shows "met/needed · expiry year" (superseded 2026-10-28: it now shows "#/4"), with "!" if it expires before the term or within 90 days. Removing a candidate uses an inline confirm, not a dialog. Messages: `getDistrictView` and `memberUpdated`. Term start is assumed to be 1 January of the term year.
- [x] Design §3 Error handling and §4 Testing approved.
- [x] Spec written: `docs/superpowers/specs/2026-10-28-inspector-ext-design.md`. The self-review fixed one contradiction: the 5-year window is measured from today, and the term start only drives the "expiring" (!) flag.
- [x] User approved the spec (2026-10-28).
- [x] Plan written: `docs/superpowers/plans/2026-10-28-inspector-ext.md` (9 tasks). Task 1 is a user-assisted spike in their real Firefox: background-fetch cookies and empty-tab markup. Spec §4.3–4.4 was refined so updates go through `storage.onChanged`.
- [x] **Executed** subagent-driven on `main` (user's choice), 2026-10-28. Older open topics, now resolved in the spec:
  - which screens to inject into, versus a separate extension page;
  - where office requirements come from (hard-coded rules or read from the site);
  - which district and lodges are in scope;
  - any caching.
- [x] Propose 2–3 approaches, present the design, then write the spec to `docs/superpowers/specs/2026-10-28-inspector-ext-design.md`. After the user approves it, move on to writing-plans.

## The HAR capture: handle with care

- File: `research/site-capture/member.freemason.org_Archive [26-09-10 16-04-44].har` (342 MB). Git ignores it (`research/site-capture/`, `*.har`).
- **Never `Read` or `cat` it whole.** Summarise it with a script, for example `python3 -I` or `jq` run from outside the capture folder:
  - list each entry's method, URL path (with IDs stripped), status, MIME type and response size;
  - then look only at the JSON or HTML responses you need.
- The host in the filename is `member.freemason.org`, singular. Check which hostname the site actually uses before writing `host_permissions` or `matches`.
- The timestamp suggests the capture is from 2026-09-10. Confirm with the user that it is current and covers the screens requested:
  - the dashboard;
  - a lodge's officers;
  - qualification records;
  - a member's LMCP history;
  - the officers-elect list;
  - the office requirements.
- **It contains members' personal data and very likely auth cookies or tokens.**
  - Don't echo names, emails, member numbers or cookies into the chat, commits or fixtures.
  - Build test fixtures from it with **made-up data** before committing.
  - Don't send any of it to external services.
