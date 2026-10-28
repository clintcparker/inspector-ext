// Renders the panel against the synthetic site and saves docs/screenshot.png.
// Every name, lodge and date comes from test/fixtures/site.mjs, so the image
// holds no member data. The fixture page has none of the site's own CSS; a
// small stand-in stylesheet approximates it so the panel reads as it does live.
import { rm } from "node:fs/promises";
import path from "node:path";
import { makeSite } from "../test/fixtures/site.mjs";
import { launchFirefox, prepareExtension, serveSite } from "../test/helpers/harness.mjs";

const OUT = path.resolve(import.meta.dirname, "../docs/screenshot.png");
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

  const box = await page.$eval("#ie-panel", (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({ path: OUT, clip: box });
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
