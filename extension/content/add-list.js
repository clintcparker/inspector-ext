// Adds a "Presumptive" column to the district members list.
(() => {
  if (!location.pathname.startsWith("/districts/district_members")) return;
  const { el, send, addControl, log } = globalThis.ie;
  const table = document.querySelector("table.list-table");
  if (!table) {
    log("add-list: table.list-table not found");
    return;
  }
  const rows = [...table.querySelectorAll("tbody tr")];
  const header = el("th", {}, "Presumptive");
  send({ type: "listRows", html: table.outerHTML }).then((res) => {
    if (!res || res.error) {
      log(`add-list: ${res?.error ?? "no-reply"}`);
      return;
    }
    table.querySelector("thead tr")?.append(header);
    res.rows.forEach((r, i) => {
      rows[i]?.append(el("td", { class: "ie-add-cell" }, r ? addControl({ ...r, termYear: res.termYear }) : null));
    });
  }).catch((e) => log(`add-list: ${e?.name ?? "error"}`));
})();
