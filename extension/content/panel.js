// Presumptive-officer panel on the district dashboard (/districts/{id}).
(() => {
  if (!/^\/districts\/\d+$/.test(location.pathname)) return;
  const { el, send, log, onDataChanged } = globalThis.ie;
  const host = document.querySelector("#summary");
  if (!host) {
    log("panel: #summary not found");
    return;
  }
  const root = el("div", { id: "ie-panel", class: "ou-stat-block" });
  const heading = host.querySelector(".ou-heading");
  if (heading) heading.after(root);
  else host.prepend(root);

  const MARK = { met: "✓", expiring: "!", missing: "✗", expired: "✗", info: "", na: "" };
  const monthYear = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const ago = (ts) => {
    if (!ts) return "never";
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    return days < 1 ? "today" : `${days} d ago`;
  };

  function cellText(kind, c) {
    if (c.status === "na") return "n/a";
    const mark = MARK[c.status] ? `${MARK[c.status]} ` : "";
    if (kind === "lmcp") return `${mark}${c.count}/4${c.expires ? ` · ${c.expires.slice(0, 4)}` : ""}`;
    return c.status === "missing" ? "✗ missing" : `${mark}${monthYear(c.date)}`;
  }

  function cellTitle(kind, c, office) {
    if (c.status === "na" || (kind !== "lmcp" && c.status === "missing")) return "";
    if (kind !== "lmcp") return c.status === "expired" ? `${c.date}\nExpired ${c.expires}` : c.status === "expiring" ? `${c.date}\nExpires ${c.expires}` : c.date;
    const lines = c.courses.map((x) => `${x.type}: ${x.date}`);
    if (c.completion) lines.push(`Program completion: ${c.completion}, counts as 4/4`);
    lines.push(c.needed ? `Required for ${office}: ${c.needed}` : "Not required for SD");
    if (c.expires) lines.push(`Expires ${c.expires}`);
    return lines.join("\n");
  }

  const KINDS = ["mm", "ritual", "lmcp"];
  const ERRORS = { layout: "⚠ Site layout changed: data may be wrong", fetch: "⚠ couldn't refresh" };

  function cells(c, office) {
    if (c.cells) {
      return KINDS.map((k) => el("td", { class: `ie-cell ie-${c.cells[k].status}`, title: cellTitle(k, c.cells[k], office), dataset: { kind: k } }, cellText(k, c.cells[k])));
    }
    const text = c.error ? ERRORS[c.error] : "… loading";
    return KINDS.map((k) => el("td", { class: `ie-cell ${c.error ? "ie-error" : "ie-loading"}`, dataset: { kind: k } }, k === "mm" ? text : ""));
  }

  // Which candidate has its "Remove? Yes / No" open; survives redraws.
  let confirming = null;

  function removeControl(termYear, lodgeId, office, memberId) {
    const key = `${termYear}/${lodgeId}/${office}/${memberId}`;
    const box = el("span", { class: "ie-remove" });
    const ask = () => {
      confirming = key;
      box.replaceChildren(
        "Remove? ",
        el("button", { type: "button", class: "ie-remove-yes", onclick: () => { confirming = null; call({ type: "removeCandidate", termYear, lodgeId, office, memberId }); } }, "Yes"),
        el("button", { type: "button", class: "ie-remove-no", onclick: reset }, "No"),
      );
    };
    const reset = () => {
      if (confirming === key) confirming = null;
      box.replaceChildren(el("button", { type: "button", class: "ie-remove-btn", title: "Remove candidate", onclick: ask }, "✕"));
    };
    if (confirming === key) ask();
    else reset();
    return box;
  }

  function candidateRow(view, lodge, office, c, first) {
    return el("tr", { class: "ie-candidate", dataset: { office, memberId: c.memberId } },
      el("td", {}, first ? office : ""),
      el("td", {},
        el("a", { href: `/mems/${c.memberId}` }, c.name),
        el("button", { type: "button", class: c.error ? "ie-retry" : "ie-refresh-member", title: c.error ? "Retry" : "Refresh this member", onclick: () => call({ type: "refresh", scope: { memberId: c.memberId } }) }, "⟳")),
      ...cells(c, office),
      el("td", {}, removeControl(view.termYear, lodge.id, office, c.memberId)));
  }

  function currentLine(lodge) {
    if (!lodge.current) return [lodge.currentError ? ERRORS[lodge.currentError] : "… loading"];
    return lodge.current.flatMap((o, i) => [i ? " · " : "", `${o.label} `, o.memberId ? el("a", { href: `/mems/${o.memberId}` }, o.name) : "vacant"]);
  }

  function lodgeSection(view, lodge) {
    const body = lodge.rows.flatMap((row) =>
      row.candidates.length
        ? row.candidates.map((c, i) => candidateRow(view, lodge, row.office, c, i === 0))
        : [el("tr", { class: "ie-empty", dataset: { office: row.office } }, el("td", {}, row.office), el("td", { colspan: "5" }, "(none yet: add from a member's page or the members list)"))]);
    return el("section", { class: "ie-lodge", dataset: { lodgeId: lodge.id } },
      el("h6", {},
        el("span", { class: "ie-lodge-name" }, `${lodge.name} No. ${lodge.number}`),
        el("button", { type: "button", class: "ie-refresh-lodge", title: "Refresh this lodge", onclick: () => call({ type: "refresh", scope: { lodgeId: lodge.id } }) }, "⟳")),
      el("p", { class: "ie-current" }, "Current: ", ...currentLine(lodge)),
      el("table", { class: "info-table ie-table" },
        el("thead", {}, el("tr", {}, ...["Office", "Candidate", "MM prof.", "Ritual qual.", "LMCP", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...body)));
  }

  function termSelect(termYear) {
    const y = new Date().getFullYear();
    const years = [...new Set([y, y + 1, y + 2, termYear])].sort();
    const select = el("select", { class: "ie-term", "aria-label": "Term year", onchange: (e) => call({ type: "setTermYear", termYear: Number(e.target.value) }) },
      ...years.map((v) => el("option", { value: v }, v)));
    select.value = String(termYear);
    return select;
  }

  // One path for every message that yields a view: catches rejections and
  // {error} replies, logs the kind only, and shows a banner.
  let lastView = null;
  let errorKind = null;
  const BANNER = { layout: "Inspector panel: site layout changed, can't find the district's lodges." };
  function call(msg) {
    return send(msg).then(
      (view) => (!view || view.error ? fail(view?.error ?? "empty-reply") : render(view)),
      (e) => fail(e?.name ?? "error"));
  }
  function fail(kind) {
    log(`panel: ${kind}`);
    errorKind = kind;
    if (lastView) draw(lastView);
    else root.replaceChildren(errorBanner());
  }
  const errorBanner = () => el("p", { class: "ie-banner ie-error-banner" }, BANNER[errorKind] ?? `Inspector panel: something went wrong (${errorKind}).`);

  // Skip the rebuild when only the timestamp or pending count changed: a full
  // redraw would close an open <select>, drop tooltips and lose focus.
  const sig = ({ updatedAt, pending, ...rest }) => JSON.stringify(rest);
  const headText = (view) => (view.pending ? `updating… (${view.pending})` : `updated ${ago(view.updatedAt)}`);
  let keepAlive;
  function render(view) {
    const same = !errorKind && lastView && sig(lastView) === sig(view);
    errorKind = null;
    lastView = view;
    if (same) {
      const head = root.querySelector(".ie-updated");
      if (head) head.textContent = headText(view);
      watch(view);
    } else draw(view);
  }
  // Firefox unloads idle event pages; a message every 20 s keeps the
  // background alive while it is still fetching.
  function watch(view) {
    clearInterval(keepAlive);
    if (view.pending) keepAlive = setInterval(() => send({ type: "ping" }).catch((e) => log(`panel: ping ${e?.name ?? "error"}`)), 20_000);
  }
  function draw(view) {
    root.replaceChildren(el("div", {},
      el("div", { class: "ie-head" },
        el("h5", {}, "Inspector: Presumptive Officers · Term"),
        termSelect(view.termYear),
        el("span", { class: "ie-updated" }, headText(view)),
        el("button", { type: "button", class: "ie-refresh", onclick: () => call({ type: "refresh", scope: "all" }) }, "⟳ Refresh")),
      errorKind ? errorBanner() : null,
      view.signedOut ? el("p", { class: "ie-banner" }, "Sign in to member.freemason.org to refresh. Showing saved data.") : null,
      ...view.lodges.map((lodge) => lodgeSection(view, lodge))));
    watch(view);
  }

  call({ type: "loadDistrict", html: document.documentElement.outerHTML });
  onDataChanged(() => call({ type: "view" }));
})();
