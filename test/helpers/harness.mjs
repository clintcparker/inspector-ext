// Shared by the e2e test and the screenshot script: a localhost variant of the
// extension, a server for the synthetic site, and a throwaway Firefox over
// WebDriver BiDi.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { route } from "../fixtures/site.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const FIREFOX = process.env.FIREFOX_BIN ?? "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox";
export const HEADLESS = process.env.HEADED !== "1";
export const EXT_UUID = "11111111-2222-3333-4444-555555555555";

// Test-only manifest variant in a temp dir: the real extension plus
// http://localhost, and a content script that forwards
// window.postMessage({ ieTest: msg }) to the background.
export async function prepareExtension() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inspector-ext-"));
  await cp(path.join(ROOT, "extension"), dir, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  const toLocal = (p) => p.replace("https://member.freemason.org", "http://localhost");
  manifest.host_permissions.push(...manifest.host_permissions.map(toLocal));
  for (const cs of manifest.content_scripts) cs.matches.push(...cs.matches.map(toLocal));
  manifest.content_scripts.push({ matches: ["http://localhost/districts/*"], js: ["content/common.js", "test-hook.js"] });
  await writeFile(path.join(dir, "test-hook.js"), `window.addEventListener("message", (e) => { if (e.data?.ieTest) globalThis.ie.send(e.data.ieTest); });`);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, id: manifest.browser_specific_settings.gecko.id };
}

// Serves the synthetic site. GET /__test/signout makes every later request
// redirect to the sign-in page.
export async function serveSite(site) {
  const state = { signedOut: false, requests: [], override: new Map() };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/__test/signout") {
      state.signedOut = true;
      return res.writeHead(204).end();
    }
    state.requests.push(pathname);
    const r = route(site, pathname, state);
    if (r.status === 302) return res.writeHead(302, { location: r.location }).end();
    res.writeHead(r.status, { "content-type": "text/html; charset=utf-8" }).end(r.body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://localhost:${server.address().port}`, state, close: () => server.close() };
}

export const launchFirefox = (extId) =>
  puppeteer.launch({
    browser: "firefox",
    executablePath: FIREFOX,
    headless: HEADLESS,
    // moz-extension:// pages are privileged; BiDi refuses to navigate or act on
    // them unless system access is enabled (RemoteAgent.sys.mjs).
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
    extraPrefsFirefox: {
      "devtools.console.stdout.content": true,
      "extensions.webextensions.uuids": JSON.stringify({ [extId]: EXT_UUID }),
    },
  });
