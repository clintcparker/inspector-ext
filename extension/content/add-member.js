// Adds an "Add as presumptive…" control to a member record page (/mems/{id}).
(() => {
  const m = /^\/mems\/(\d+)$/.exec(location.pathname);
  if (!m) return;
  const { el, send, addControl, log } = globalThis.ie;
  const host = document.querySelector("#information .cont-card-section");
  if (!host) {
    log("add-member: #information not found");
    return;
  }
  const memberId = Number(m[1]);
  const field = (n) => document.querySelector(`input[name="member[${n}]"]`)?.value.trim() ?? "";
  const name = `${field("first_name")} ${field("last_name")}`.trim() || `Member ${memberId}`;
  send({ type: "memberInfo", memberId }).then((res) => {
    if (!res || res.error) {
      log(`add-member: ${res?.error ?? "no-reply"}`);
      return;
    }
    host.prepend(el("div", { class: "ie-add-member" }, "Inspector: ", addControl({ memberId, name, lodges: res.lodges, termYear: res.termYear, entries: res.entries })));
  }).catch((e) => log(`add-member: ${e?.name ?? "error"}`));
})();
