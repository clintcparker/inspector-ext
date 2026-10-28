// Shared by the content scripts. They are classic scripts loaded into one
// sandbox, so they share globalThis.
globalThis.ie = {
  log: (...a) => console.log("[inspector-ext]", ...a),
  send: (msg) => browser.runtime.sendMessage(msg),

  // el("td", { class: "x", dataset: { kind: "mm" }, onclick: fn }, "text", childNode, null)
  el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false).map((c) => (typeof c === "number" ? String(c) : c)));
    return node;
  },

  // Calls fn (debounced) whenever the background writes to storage.local.
  onDataChanged(fn) {
    let timer;
    browser.storage.onChanged.addListener((_changes, area) => {
      if (area !== "local") return;
      clearTimeout(timer);
      timer = setTimeout(fn, 150);
    });
  },

  // "Add as presumptive…" control for one member. `lodges` are the district
  // lodges the member could stand in: one means no lodge picker.
  addControl({ memberId, name, lodges, termYear, entries }) {
    const { el, send } = globalThis.ie;
    const wrap = el("span", { class: "ie-add" });
    if (!lodges.length) {
      wrap.append(el("span", { class: "ie-note" }, "Open your district dashboard once so the extension knows your lodges."));
      return wrap;
    }
    const render = (current) => {
      // Must match OFFICES in lib/rules.js (content scripts cannot import it).
      const office = el("select", { class: "ie-office", "aria-label": "Presumptive office" },
        ...["WM", "SW", "JW", "SD"].map((o) => el("option", { value: o }, `Presumptive ${o}`)));
      const lodge = lodges.length > 1
        ? el("select", { class: "ie-lodge", "aria-label": "Lodge" }, ...lodges.map((l) => el("option", { value: l.id }, `${l.name} No. ${l.number}`)))
        : null;
      const add = el("button", { type: "button", class: "ie-add-btn", onclick: async () => {
        add.disabled = true;
        let entries = current;
        let failed = null;
        try {
          const res = await send({ type: "addCandidate", termYear, lodgeId: lodge ? Number(lodge.value) : lodges[0].id, office: office.value, memberId, name });
          if (res && !res.error && res.entries) entries = res.entries;
          else failed = res?.error ?? "no-reply";
        } catch (e) {
          failed = e?.name ?? "error";
        } finally {
          if (failed) globalThis.ie.log(`add: ${failed}`);
          render(entries);
          if (failed) wrap.prepend(el("span", { class: "ie-note" }, "Could not add"));
        }
      } }, "Add");
      wrap.replaceChildren(...[
        current.length ? el("span", { class: "ie-already" }, `Already presumptive ${current.map((e) => e.office).join(", ")} for ${termYear}`) : null,
        office, lodge, add,
      ].filter(Boolean));
    };
    render(entries);
    return wrap;
  },
};
