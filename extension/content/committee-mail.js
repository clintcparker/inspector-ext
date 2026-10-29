// Adds "Email committee" and "Copy emails" to each committee on a lodge's
// public page (/public_members/memberships/{id}), and the same for all
// committees at the top of the "… Committees" section.
(() => {
  if (!/^\/public_members\/memberships\/\d+$/.test(location.pathname)) return;
  const { el, log } = globalThis.ie;
  const title = [...document.querySelectorAll(".async-accordian-title")].find((h) => /committees/i.test(h.textContent));
  const content = title?.parentElement.querySelector(".async-accordian-content");
  if (!content) {
    log("committee-mail: committees section not found");
    return;
  }

  const EMAIL = /^[^\s@,;?&]+@[^\s@,;?&]+\.[^\s@,;?&]+$/;
  // Addresses in the members' Email cells, deduplicated ignoring case. The
  // committee-level "Email:" line (usually an empty mailto) is not a member.
  const addresses = (root) => {
    const seen = new Map();
    let missing = 0;
    for (const cell of root.querySelectorAll('td[data-title="Email"]')) {
      const href = cell.querySelector('a[href^="mailto:"]')?.getAttribute("href") ?? "";
      const addr = decodeURIComponent(href.slice("mailto:".length)).trim();
      if (!EMAIL.test(addr)) missing++;
      else if (!seen.has(addr.toLowerCase())) seen.set(addr.toLowerCase(), addr);
    }
    return { list: [...seen.values()], missing };
  };

  const bar = ({ list, missing }, label) => {
    const copy = el("button", { type: "button", class: "ie-mail-copy", onclick: async () => {
      try {
        await navigator.clipboard.writeText(list.join(", "));
        copy.textContent = `Copied ${list.length}`;
      } catch (e) {
        log(`committee-mail: copy ${e?.name ?? "error"}`);
        copy.textContent = "Copy failed";
      }
      setTimeout(() => (copy.textContent = "Copy emails"), 2000);
    } }, "Copy emails");
    return el("div", { class: "ie-mail-bar" },
      list.length ? el("a", { class: "ie-mail-link", href: `mailto:${list.join(",")}` }, label) : el("span", { class: "ie-note" }, "No emails"),
      list.length ? copy : null,
      missing ? el("span", { class: "ie-note" }, `${missing} without email`) : null);
  };

  for (const table of content.querySelectorAll(":scope > table.info-table")) {
    const name = table.querySelector("h4");
    if (name) name.after(bar(addresses(table), "Email committee"));
  }
  // Inside the content, not after the title: the site's accordion toggles the
  // title's next sibling, so anything between them hides the committees.
  content.prepend(bar(addresses(content), "Email all committees"));
})();
