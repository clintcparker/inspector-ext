// End-to-end: installs the extension (with http://localhost added to its
// matches and host permissions) into a throwaway headless Firefox over
// WebDriver BiDi, serves a synthetic copy of member.freemason.org, and
// drives the panel and add controls. Background logs come from stdout.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { makeSite } from "./fixtures/site.mjs";
import { EXT_UUID, HEADLESS, launchFirefox, prepareExtension, serveSite } from "./helpers/harness.mjs";

const { dir: EXT_DIR, id: EXT_ID } = await prepareExtension();
const site = makeSite();
const { base: BASE, state, close: closeServer } = await serveSite(site);
const browser = await launchFirefox(EXT_ID);

let stdout = "";
browser.process()?.stdout?.on("data", (d) => (stdout += d));
browser.process()?.stderr?.on("data", (d) => (stdout += d));
const waitForLog = async (needle, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stdout.includes(needle)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`log not seen: ${needle}\n--- stdout ---\n${stdout.split("\n").filter((l) => l.includes("inspector-ext")).join("\n")}`);
};

const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met");
};

// Kept for when the extension gains its own pages (options, popup).
// Puppeteer never sees BiDi navigation to moz-extension:// complete, so fire
// the navigation without awaiting it and re-query until the selector appears.
// eslint-disable-next-line no-unused-vars
const openExtensionPage = async (page, file, readySelector, ms = 10000) => {
  page.goto(`moz-extension://${EXT_UUID}/${file}`).catch(() => {});
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.$(readySelector).catch(() => null)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${file}: selector ${readySelector} not found within ${ms}ms`);
};

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};

try {
  const id = await browser.installExtension(EXT_DIR);
  await check("installExtension returns gecko id", () => assert.equal(id, EXT_ID));

  const page = await browser.newPage();
  page.on("console", (m) => (stdout += `[page-console] ${m.text()}\n`));
  await check("background log reaches stdout", () => waitForLog("[inspector-ext] background started"));

  const cell = (memberId, kind) => page.$eval(`#ie-panel tr.ie-candidate[data-member-id="${memberId}"] td[data-kind="${kind}"]`, (e) => e.textContent);

  await page.goto(`${BASE}/districts/123`);
  await check("panel lists the district's lodges with every office", async () => {
    await page.waitForSelector("#ie-panel .ie-lodge", { timeout: 10000 });
    const names = await page.$$eval("#ie-panel .ie-lodge-name", (els) => els.map((e) => e.textContent));
    assert.deepEqual(names, ["Example Lodge No. 101", "Sample Lodge No. 202"]);
    assert.equal(await page.$$eval('#ie-panel .ie-lodge[data-lodge-id="11"] tr.ie-empty', (els) => els.length), 4);
  });
  await check("current officers load from ou_officers", () =>
    page.waitForFunction(() => document.querySelector('#ie-panel .ie-lodge[data-lodge-id="11"] .ie-current')?.textContent.includes("WM Zed Zero"), { timeout: 15000 }));
  await check("current line shows the vacant Treasurer between JW and Sec", async () => {
    const line = await page.$eval('#ie-panel .ie-lodge[data-lodge-id="11"] .ie-current', (e) => e.textContent);
    assert.ok(line.includes("Treas vacant"), line);
    assert.ok(line.indexOf("JW ") < line.indexOf("Treas vacant") && line.indexOf("Treas vacant") < line.indexOf("Sec "), line);
  });

  const seed = (msg) => page.evaluate((m) => window.postMessage({ ieTest: m }, "*"), msg);
  await check("status-only storage writes don't rebuild the panel", async () => {
    await page.$eval("#ie-panel .ie-term", (e) => { e.ieTag = "same-node"; });
    const fetches = () => state.requests.filter((p) => p.endsWith("/ou_officers")).length;
    const before = fetches();
    await seed({ type: "refresh", scope: "all" });
    await waitFor(() => fetches() >= before + 2, 10000);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$eval("#ie-panel .ie-term", (e) => e.ieTag), "same-node", "panel was rebuilt");
  });
  const rowSel = (id) => `#ie-panel tr.ie-candidate[data-member-id="${id}"]`;
  await check("open remove confirmation survives a redraw", async () => {
    const termYear = Number(await page.$eval("#ie-panel .ie-term", (e) => e.value));
    await seed({ type: "addCandidate", termYear, lodgeId: 11, office: "SW", memberId: 1001, name: "Seed One" });
    await page.waitForSelector(`${rowSel(1001)} .ie-remove-btn`, { timeout: 10000 });
    await page.click(`${rowSel(1001)} .ie-remove-btn`);
    await page.waitForSelector(`${rowSel(1001)} .ie-remove-yes`);
    await seed({ type: "addCandidate", termYear, lodgeId: 11, office: "JW", memberId: 1002, name: "Seed Two" });
    await page.waitForSelector(rowSel(1002), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(await page.$(`${rowSel(1001)} .ie-remove-yes`), "Yes button gone after redraw");
    await page.click(`${rowSel(1001)} .ie-remove-no`);
    assert.ok(await page.$(`${rowSel(1001)} .ie-remove-btn`), "No did not reset");
    await page.click(`${rowSel(1001)} .ie-remove-btn`);
    await page.click(`${rowSel(1001)} .ie-remove-yes`);
    await page.waitForFunction((s) => !document.querySelector(s), { timeout: 10000 }, rowSel(1001));
    // Leave no candidates behind for the add scenarios below.
    await seed({ type: "removeCandidate", termYear, lodgeId: 11, office: "JW", memberId: 1002 });
    await page.waitForFunction((s) => !document.querySelector(s), { timeout: 10000 }, rowSel(1002));
  });

  state.override.set("/districts/999", `<!DOCTYPE html><html><body><div id="summary"><div class="ou-heading">District No. 999</div></div></body></html>`);
  await page.goto(`${BASE}/districts/999`);
  await check("background error shows a banner and logs the kind only", async () => {
    await page.waitForSelector("#ie-panel .ie-banner", { timeout: 10000 });
    await waitForLog("[inspector-ext] panel: layout");
  });

  await page.goto(`${BASE}/districts/district_members`);
  const addFromList = async (memberId, office) => {
    const row = `tr:has(a[href="/members/${memberId}"])`;
    await page.select(`${row} select.ie-office`, office);
    await page.click(`${row} button.ie-add-btn`);
    await page.waitForFunction((sel, o) => document.querySelector(`${sel} .ie-already`)?.textContent.includes(o), { timeout: 5000 }, row, office);
  };
  await check("members list gets an add control per row", () => page.waitForSelector("tr .ie-add select.ie-office", { timeout: 10000 }));
  await check("a failed add shows a note, re-enables the button and logs the kind only", async () => {
    const row = 'tr:has(a[href="/members/1004"])';
    await page.$eval(`${row} select.ie-office`, (sel) => {
      const o = document.createElement("option");
      o.value = "XX";
      o.textContent = "Invalid";
      sel.append(o);
    });
    await page.select(`${row} select.ie-office`, "XX");
    await page.click(`${row} button.ie-add-btn`);
    await page.waitForSelector(`${row} .ie-note`, { timeout: 5000 });
    assert.match(await page.$eval(`${row} .ie-note`, (e) => e.textContent), /Could not add/);
    assert.equal(await page.$eval(`${row} button.ie-add-btn`, (b) => b.disabled), false);
    await waitForLog("[inspector-ext] add: bad-request");
  });
  await check("adds WM and two contested SWs from the members list", async () => {
    await addFromList(1001, "WM");
    await addFromList(1002, "SW");
    await addFromList(1003, "SW");
  });

  await page.goto(`${BASE}/mems/1004`);
  await check("adds JW from the member page (lodge from the sidebar)", async () => {
    await page.waitForSelector(".ie-add-member select.ie-office", { timeout: 15000 });
    assert.equal(await page.$(".ie-add-member select.ie-lodge"), null);
    await page.select(".ie-add-member select.ie-office", "JW");
    await page.click(".ie-add-member button.ie-add-btn");
    await page.waitForFunction(() => document.querySelector(".ie-add-member .ie-already")?.textContent.includes("JW"), { timeout: 5000 });
  });

  await page.goto(`${BASE}/districts/123`);
  await check("candidates render with requirement statuses", async () => {
    await page.waitForFunction(() => document.querySelectorAll("#ie-panel tr.ie-candidate").length === 4 && !document.querySelector("#ie-panel .ie-loading"), { timeout: 30000 });
    assert.match(await cell(1001, "lmcp"), /^✓ 4\/4 · \d{4}$/);
    assert.match(await cell(1001, "ritual"), /^✓ \d{2}\/\d{4}$/);
    assert.equal(await page.$eval('#ie-panel tr.ie-candidate[data-member-id="1002"] a', (e) => e.textContent), "Ben Baker");
    assert.equal(await cell(1002, "ritual"), "✗ missing");
    assert.equal(await cell(1002, "lmcp"), "✗ 1/4");
    assert.match(await cell(1003, "lmcp"), /^✓ 4\/4 · \d{4}$/);
    assert.match(await cell(1004, "lmcp"), /^! 1\/4 · \d{4}$/);
    // 1004's ritual is dated over 24 months ago: red "expired", not green.
    assert.match(await cell(1004, "ritual"), /^✗ \d{2}\/\d{4}$/);
    assert.equal(await page.$eval('#ie-panel tr.ie-candidate[data-member-id="1004"] td[data-kind="ritual"]', (e) => e.classList.contains("ie-expired")), true);
    assert.match(await page.$eval('#ie-panel tr.ie-candidate[data-member-id="1004"] td[data-kind="ritual"]', (e) => e.title), /Expired \d{4}-\d{2}-\d{2}/);
  });
  await check("a member refresh doesn't rebuild the panel", async () => {
    await page.$eval("#ie-panel .ie-term", (e) => { e.ieTag = "same-node"; });
    const fetches = () => state.requests.filter((p) => p.startsWith("/members/")).length;
    const before = fetches();
    await page.click('#ie-panel tr.ie-candidate[data-member-id="1001"] .ie-refresh-member');
    await waitFor(() => fetches() >= before + 4, 10000);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$eval("#ie-panel .ie-term", (e) => e.ieTag), "same-node", "panel was rebuilt");
  });
  await check("contested office shows both candidates", async () => {
    assert.equal(await page.$$eval('#ie-panel .ie-lodge[data-lodge-id="11"] tr.ie-candidate[data-office="SW"]', (els) => els.length), 2);
  });
  await check("reload renders from cache without refetching members", async () => {
    const memberFetches = () => state.requests.filter((p) => p.startsWith("/members/")).length;
    const before = memberFetches();
    await page.reload();
    await page.waitForSelector('#ie-panel tr.ie-candidate[data-member-id="1001"] td.ie-met[data-kind="lmcp"]', { timeout: 5000 });
    assert.equal(memberFetches(), before);
  });
  await check("remove asks inline, then drops the candidate", async () => {
    await page.click('#ie-panel tr.ie-candidate[data-member-id="1002"] .ie-remove-btn');
    await page.click('#ie-panel tr.ie-candidate[data-member-id="1002"] .ie-remove-yes');
    await page.waitForFunction(() => !document.querySelector('#ie-panel tr.ie-candidate[data-member-id="1002"]'), { timeout: 5000 });
  });
  await check("signed out shows a banner and keeps cached data", async () => {
    // Node may resolve "localhost" to ::1; the server listens on 127.0.0.1.
    await fetch(`${BASE.replace("localhost", "127.0.0.1")}/__test/signout`);
    await page.click("#ie-panel .ie-refresh");
    await page.waitForSelector("#ie-panel .ie-banner", { timeout: 15000 });
    assert.match(await cell(1001, "lmcp"), /^✓ 4\/4/);
  });
  await check("background logs carry no member ids", () => {
    const lines = stdout.split("\n").filter((l) => l.includes("[inspector-ext]"));
    assert.ok(lines.length > 0, "no [inspector-ext] log lines captured");
    assert.doesNotMatch(lines.join("\n"), /100[1-4]|200[12]/);
  });
} finally {
  await browser.close();
  closeServer();
  await rm(EXT_DIR, { recursive: true, force: true });
}

for (const [status, name, err] of results) console.log(`${status}  ${name}${err ? `\n      ${err.split("\n").join("\n      ")}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed (headless=${HEADLESS})`);
process.exit(failed ? 1 : 0);
