// Synthetic copy of member.freemason.org. The markup copies the structure of
// the 2026-09-10 capture; every name, ID and date is made up. Used by the
// unit tests and by the e2e fixture server.
import { addDays, addYears, todayIso } from "../../extension/lib/dates.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const us = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
const shell = (title, body) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>` +
  `<nav><a href="/districts/district_members" title="Members">Members</a> <a href="/users/sign_out" title="Sign Out">Sign Out</a></nav>` +
  `<div class="app-cont"><div class="app-cont-body">${body}</div></div></body></html>`;

export function districtPage({ number, lodges }) {
  const links = lodges.map((l) => `<div class="district-sidebar-link"><a href="/lodges/${l.id}">${esc(l.name)} No. ${l.number}</a></div>`).join("");
  return shell(`District ${number}`,
    `<div id="ou-tab-cont-group"><div id="summary" class="ou-tab-content content full-tab-content">` +
    `<div class="ou-heading">District No. ${number}</div>` +
    `<div class="ou-stat-block"><div class="block-cont"><table class="info-table no-row-links"><thead><tr><th><h5>Lodges</h5></th></tr></thead>` +
    `<tbody><tr><td>${links}</td></tr></tbody></table></div></div></div></div>`);
}

export function officersFragment(officers) {
  const rows = officers.map((o) => `<tr><td>${esc(o.office)}</td><td>${o.memberId ? `<a href="/members/${o.memberId}">${esc(o.name)}</a>` : ""}</td></tr>`).join("");
  return `<div class="block-cont"><table class="info-table"><thead><tr><th><h5>Officers</h5></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function eventsTab(heading, events) {
  const rows = events.map((e) =>
    `<div class="div-table-row"><div class="accordian-wrap">` +
    `<div class="div-table-col table-col-lg">${esc(e.type)}</div>` +
    `<div class="div-table-col table-col-med">${us(e.date)}</div>` +
    `<div class="div-table-col table-col-sm"><a href="/members/1/member_events/1/edit">Edit</a></div>` +
    `<div class="async-accordian-title"></div><div class="async-accordian-content"><div class="cont-card-section"><div class="cont-child">` +
    `<strong>Comments:</strong> Example comment <strong>Submitted on:</strong> ${us(e.date)} <strong>Submitted by:</strong> someone@example.test` +
    `</div></div></div></div></div>`).join("");
  return `<div class="cont-child"><div class="lodge-mm-list member-hist-events table-div">` +
    `<div class="div-table-heading div-table-row"><div class="div-table-col table-col-lg">${esc(heading)}</div><div class="div-table-col table-col-med">Date</div><div class="div-table-col table-col-sm"></div></div>` +
    `<div class="div-table-body">${rows}</div></div></div>`;
}

// What the site serves for an empty Proficiency, Educational or Awards tab (Task 1 spike):
// no .member-hist-events, just a "~No … Found~" heading. History always has the table.
export const emptyEventsTab = (label) =>
  `<div class="cont-child"><h6 class="text-center highlight">~No ${esc(label)} Found~</h6></div>`;

export function membersList(rows) {
  const trs = rows.map((r) => `<tr><td><a href="/members/${r.memberId}">${esc(r.name)}</a></td><td>${r.memberNumber}</td><td>${esc(r.status)}</td><td>${esc(r.lodge)}</td></tr>`).join("");
  return shell("Members", `<table class="list-table"><thead><tr><th>Name</th><th>Member #</th><th>Status</th><th>Lodge Name</th></tr></thead><tbody>${trs}</tbody></table>`);
}

export function memberPage({ first, last }) {
  return shell("Member",
    `<div class="right_sidebar"><div class="cont"><div id="render_async_sidebar"></div></div></div>` +
    `<div id="ou-tab-cont-group"><div id="information" class="ou-tab-content content full-tab-content information first-tab"><div class="cont-card-section">` +
    `<h4 class="heading">${esc(first)} ${esc(last)}</h4>` +
    `<form><input type="text" name="member[first_name]" value="${esc(first)}"><input type="text" name="member[last_name]" value="${esc(last)}"></form>` +
    `</div></div></div>`);
}

export function sidebarMemberships(lodges) {
  return lodges.map((l) => `<div class="cont-card-section"><h4><a href="/lodges/${l.id}">${esc(l.name)} No.${l.number}</a></h4><p>Master Mason</p></div>`).join("");
}

// Lodge dashboard (/ous/{id}): the heading row of icon links the extension adds to.
export function lodgePage({ name, number }) {
  return shell(`${name} No. ${number}`,
    `<div id="ou-tab-cont-group"><div id="dashboard" class="ou-tab-content full-tab-content first-tab">` +
    `<div class="ou-heading">Dashboard <span class="ou-heading-icon"><a href="#members_list" title="Member Search">Search</a></span></div>` +
    `</div></div>`);
}

// Public lodge page (/public_members/memberships/{id}), copied from the
// 2026-10-29 capture: one table per committee, members in an inner table.
// The committee-level "Email:" line has an empty mailto, as on the site.
export function publicLodgePage({ name, number, committees }) {
  const committee = (c) =>
    `<table class="info-table no-row-links"><tr><td><h4>${esc(c.name)}</h4>` +
    `<strong>Charge:</strong> Example charge.<br /><strong>Email:</strong> &nbsp;&nbsp;<a href='mailto:'></a><br /></td></tr>` +
    `<tr><td><table class="info-table no-row-links no-responsive-col-title"><thead><tr><th>Role</th><th>Name</th><th>Phone</th><th>Email</th></tr></thead><tbody>` +
    c.members.map((m) =>
      `<tr><td data-title="Office"><strong>${esc(m.role)}</strong></td><td data-title="Officer">${esc(m.name)}</td><td data-title="Phone"></td>` +
      `<td data-title="Email">${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ""}</td></tr>`).join("") +
    `</tbody></table></td></tr></table>`;
  return shell(`${name} No. ${number}`,
    `<div class="cont-card-section default-accordian"><h4 class="heading async-accordian-title">Lodge Officers</h4>` +
    `<div class="cont-child async-accordian-content"><table class="info-table"><tr><td data-title="Email"><a href="mailto:officer@example.test">officer@example.test</a></td></tr></table></div></div>` +
    `<div class="cont-card-section default-accordian"><h4 class="heading async-accordian-title">Lodge Committees</h4>` +
    `<div class="cont-child async-accordian-content">${committees.map(committee).join("")}</div></div>`);
}

export const signInPage = () =>
  `<!DOCTYPE html><html><body><form action="/users/sign_in" method="post"><input name="user[email]"><input type="password" name="user[password]"></form></body></html>`;

const TAB_HEADINGS = { proficiency_events: "Award Type", educational_events: "Award Type", awards: "Award Type", history: "Event Type" };
const TAB_KEYS = { proficiency_events: "proficiency", educational_events: "educational", awards: "awards", history: "history" };

export function makeSite(today = todayIso()) {
  const ago = (days) => addDays(today, -days);
  const lodges = [{ id: 11, name: "Example Lodge", number: 101 }, { id: 22, name: "Sample Lodge", number: 202 }];
  const mm = (days) => [{ type: "Proficiency - MM", date: ago(days) }];
  const members = {
    // Presumptive WM, fully qualified.
    1001: { first: "Alan", last: "Able", lodgeId: 11, events: {
      history: mm(2000),
      proficiency: [{ type: "WM Officer Qualification", date: ago(30) }],
      educational: ["Hall Association Management Exam", "Lodge Administration Exam", "Member Experience Exam", "Finance Exam"].map((type) => ({ type, date: ago(400) })),
      awards: [] } },
    // Presumptive SW: no ritual qualification, 1 of 2 LMCP.
    1002: { first: "Ben", last: "Baker", lodgeId: 11, events: {
      history: mm(1500), proficiency: [],
      educational: [{ type: "Hall Association Management Exam", date: ago(800) }],
      awards: [] } },
    // Contested SW: LMCP met via program completion.
    1003: { first: "Carl", last: "Cole", lodgeId: 11, events: {
      history: mm(1200),
      proficiency: [{ type: "SW Officer Qualification", date: ago(60) }],
      educational: [{ type: "Lodge Management Certification Program", date: ago(1000) }, { type: "Annual Communication", date: ago(20) }],
      awards: [] } },
    // Presumptive JW in lodge 22: only course expires in 30 days; ritual qualified over 24 months ago.
    1004: { first: "Dan", last: "Dent", lodgeId: 22, events: {
      history: mm(900),
      proficiency: [{ type: "JW Officer Qualification", date: ago(800) }],
      educational: [{ type: "Lodge Administration Exam", date: addYears(addDays(today, 30), -5) }],
      awards: [] } },
    2001: { first: "Zed", last: "Zero", lodgeId: 11, events: { history: [], proficiency: [], educational: [], awards: [] } },
    2002: { first: "Yul", last: "Young", lodgeId: 22, events: { history: [], proficiency: [], educational: [], awards: [] } },
  };
  const name = (id) => `${members[id].first} ${members[id].last}`;
  const officers = {
    11: [
      { office: "Worshipful Master", memberId: 2001, name: name(2001) },
      { office: "Senior Warden", memberId: 1001, name: name(1001) },
      { office: "Junior Warden", memberId: 1002, name: name(1002) },
      { office: "Treasurer", memberId: null, name: null },
      { office: "Secretary", memberId: 1003, name: name(1003) },
    ],
    22: [{ office: "Worshipful Master", memberId: 2002, name: name(2002) }],
  };
  const committees = {
    11: [
      { name: "Audit Committee", members: [
        { role: "Chairman", name: "Alan Able", email: "alan@example.test" },
        { role: "Member", name: "Ben Baker", email: "ben@example.test" },
        { role: "Member", name: "Carl Cole", email: "" },
      ] },
      { name: "Charity Committee", members: [
        { role: "Chairman", name: "Ben Baker", email: "BEN@example.test" },
        { role: "Member", name: "Zed Zero", email: "zed@example.test" },
      ] },
    ],
  };
  return { district: 123, lodges, members, officers, committees };
}

export function route(site, path, state = {}) {
  if (state.signedOut && path !== "/users/sign_in") return { status: 302, location: "/users/sign_in" };
  if (state.override?.has(path)) return { status: 200, body: state.override.get(path) };
  const lodge = (id) => site.lodges.find((l) => l.id === id);
  let m;
  if (path === "/users/sign_in") return { status: 200, body: signInPage() };
  if ((m = /^\/districts\/(\d+)$/.exec(path)) && Number(m[1]) === site.district) return { status: 200, body: districtPage({ number: site.district, lodges: site.lodges }) };
  if (path === "/districts/district_members") {
    return { status: 200, body: membersList(Object.entries(site.members).map(([id, x]) => {
      const l = lodge(x.lodgeId);
      return { memberId: Number(id), name: `${x.last}, ${x.first}`, memberNumber: 900000 + Number(id), status: "Master Mason", lodge: `${l.name} No.${l.number}` };
    })) };
  }
  if ((m = /^\/ous\/(\d+)$/.exec(path)) && lodge(Number(m[1]))) return { status: 200, body: lodgePage(lodge(Number(m[1]))) };
  if ((m = /^\/public_members\/memberships\/(\d+)$/.exec(path)) && lodge(Number(m[1]))) {
    return { status: 200, body: publicLodgePage({ ...lodge(Number(m[1])), committees: site.committees?.[m[1]] ?? [] }) };
  }
  if ((m = /^\/ous\/(\d+)\/ou_officers$/.exec(path)) && site.officers[m[1]]) return { status: 200, body: officersFragment(site.officers[m[1]]) };
  if ((m = /^\/mems\/(\d+)$/.exec(path)) && site.members[m[1]]) return { status: 200, body: memberPage(site.members[m[1]]) };
  if ((m = /^\/mems\/(\d+)\/sidebar_memberships$/.exec(path)) && site.members[m[1]]) return { status: 200, body: sidebarMemberships([lodge(site.members[m[1]].lodgeId)]) };
  if ((m = /^\/members\/(\d+)\/(proficiency_events|educational_events|awards|history)$/.exec(path)) && site.members[m[1]]) {
    const events = site.members[m[1]].events[TAB_KEYS[m[2]]];
    if (!events.length && m[2] !== "history") return { status: 200, body: emptyEventsTab("Awards") };
    return { status: 200, body: eventsTab(TAB_HEADINGS[m[2]], events) };
  }
  return { status: 404, body: "<!DOCTYPE html><title>Not found</title>" };
}

// A fetch() stand-in for unit tests that follows redirects like the browser does.
export function siteFetch(site, origin = "https://member.freemason.org") {
  const state = { signedOut: false, requests: [], override: new Map() };
  const fetchImpl = async (url) => {
    let path = new URL(url).pathname;
    for (let hops = 0; hops < 5; hops++) {
      state.requests.push(path);
      const r = route(site, path, state);
      if (r.status === 302) { path = r.location; continue; }
      return { ok: r.status < 400, status: r.status, url: origin + path, text: async () => r.body };
    }
    throw new Error("redirect loop");
  };
  return { fetchImpl, state };
}
