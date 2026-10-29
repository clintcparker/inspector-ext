// Adds a link from a lodge dashboard (/ous/{id}) to the lodge's public page
// (/public_members/memberships/{id}); both use the same id.
(() => {
  const m = /^\/ous\/(\d+)$/.exec(location.pathname);
  if (!m) return;
  const { el, log } = globalThis.ie;
  const heading = document.querySelector("#dashboard .ou-heading") ?? document.querySelector(".ou-heading");
  if (!heading) {
    log("lodge-link: .ou-heading not found");
    return;
  }
  heading.append(el("span", { class: "ou-heading-icon ie-public-icon" },
    el("a", { class: "ie-public-page", href: `/public_members/memberships/${m[1]}`, title: "Public lodge page (committees, officers)" }, "Public page")));
})();
