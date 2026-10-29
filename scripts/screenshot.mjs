// Renders the extension against the synthetic site and saves the README
// images in docs/: the district panel and the committee email controls. Every name, lodge and date comes from
// test/fixtures/site.mjs, so the images hold no member data. The fixture pages
// have none of the site's own CSS; small stand-in stylesheets approximate it.
import { rm } from "node:fs/promises";
import path from "node:path";
import { makeSite } from "../test/fixtures/site.mjs";
import { launchFirefox, prepareExtension, serveSite } from "../test/helpers/harness.mjs";

const DOCS = path.resolve(import.meta.dirname, "../docs");
const SITE_CSS = `
  body { margin: 0; padding: 16px; font: 15px/1.4 "Helvetica Neue", Arial, sans-serif; color: #222; }
  nav { display: none; }
  #summary { max-width: 1040px; }
  #ie-panel { background: #fff; padding: 12px 16px; margin: 0; }
  #ie-panel h5 { font-size: 1.15em; }
  #ie-panel .ie-lodge h6 { font-size: 1em; text-align: center; }
  #ie-panel .ie-current { text-align: center; }
  #ie-panel table { width: 100%; border-collapse: collapse; }
  #ie-panel th { text-align: left; background: #ececec; padding: 6px 8px; }
  #ie-panel td { padding: 6px 8px; border-top: 1px solid #e3e3e3; }
  #ie-panel tbody tr:nth-child(even) { background: #f7f7f7; }
  #ie-panel a { color: #7a1f24; text-decoration: none; }
  #ie-panel button { background: #7a1f24; color: #fff; border: 0; border-radius: 3px; padding: 3px 8px; margin-left: 6px; }
  #ie-panel select { padding: 2px 6px; }
`;
const PUBLIC_CSS = `
  body { margin: 0; padding: 16px; font: 15px/1.4 "Helvetica Neue", Arial, sans-serif; color: #222; background: #f4f4f4; }
  nav { display: none; }
  .cont-card-section { max-width: 900px; border: 1px solid #ddd; margin-bottom: 10px; background: #fff; }
  .cont-card-section:first-child { display: none; }
  .async-accordian-title { margin: 0; padding: 10px 12px; background: #e3e3e3; font-size: 1.1em; }
  .async-accordian-content { padding: 8px 12px; }
  .async-accordian-content > table { width: 100%; margin-bottom: 12px; }
  table { border-collapse: collapse; }
  h4 { margin: 4px 0; }
  table table { width: 100%; font-size: 0.9em; }
  table table th { text-align: left; background: #ececec; padding: 4px 8px; }
  table table td { padding: 4px 8px; border-top: 1px solid #e3e3e3; }
  a { color: #7a1f24; text-decoration: none; }
  .ie-mail-bar button { background: #7a1f24; color: #fff; border: 0; border-radius: 3px; padding: 4px 10px; }
`;

const shot = async (page, selector, file) => {
  const box = await page.$eval(selector, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const out = path.join(DOCS, file);
  await page.screenshot({ path: out, clip: box });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
};

const { dir, id } = await prepareExtension();
const site = makeSite();
const server = await serveSite(site);
const browser = await launchFirefox(id);
try {
  await browser.installExtension(dir);
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${server.base}/districts/${site.district}`);
  await page.waitForSelector("#ie-panel .ie-term", { timeout: 15000 });

  const termYear = Number(await page.$eval("#ie-panel .ie-term", (e) => e.value));
  const name = (memberId) => `${site.members[memberId].first} ${site.members[memberId].last}`;
  const roster = [[11, "WM", 1001], [11, "SW", 1002], [11, "SW", 1003], [22, "JW", 1004]];
  for (const [lodgeId, office, memberId] of roster) {
    await page.evaluate((m) => window.postMessage({ ieTest: m }, "*"), { type: "addCandidate", termYear, lodgeId, office, memberId, name: name(memberId) });
  }
  await page.waitForFunction(
    (n) => document.querySelectorAll("#ie-panel tr.ie-candidate").length === n && !document.querySelector("#ie-panel .ie-loading") && !document.querySelector("#ie-panel .ie-current")?.textContent.includes("loading"),
    { timeout: 30000 }, roster.length);
  await page.addStyleTag({ content: SITE_CSS });

  await shot(page, "#ie-panel", "screenshot.png");

  await page.goto(`${server.base}/public_members/memberships/${site.lodges[0].id}`);
  await page.waitForSelector(".ie-mail-bar", { timeout: 15000 });
  await page.addStyleTag({ content: PUBLIC_CSS });
  await shot(page, ".cont-card-section:has(.ie-mail-bar)", "screenshot-committees.png");
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
