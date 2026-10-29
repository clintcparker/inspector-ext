# inspector-ext

A Firefox extension (target: addons.mozilla.org) that improves the Inspector's dashboard on the Grand Lodge of California member site (`member.freemason.org`). **Read `docs/design-notes.md` first:** it has the current status, design decisions, site structure, and rules for the private HAR capture.

`extension/` is the extension: `lib/` and `parse/` are pure modules (unit-tested), `background.js` wires them to `browser.*`, and `content/` holds thin classic content scripts. Synthetic site fixtures are in `test/fixtures/site.mjs`. Background research: `research/firefox-extension-dev-with-claude.md`. Never commit anything from `research/site-capture/` (member PII, auth tokens).

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | AMO's addons-linter via `web-ext lint`, warnings fail |
| `npm run test:unit` | Vitest on pure modules (no `browser.*`) |
| `npm run test:e2e` | Puppeteer over WebDriver BiDi: installs the extension into a throwaway headless profile and drives a synthetic copy of the site through the panel and add controls, and checks background logs. `FIREFOX_BIN=...` to switch Firefox, `HEADED=1` to watch |
| `npm test` | All three |
| `npm run build` | Zip into `web-ext-artifacts/` |
| `npm run screenshot` | Regenerate the `docs/screenshot*.png` README / AMO images from the synthetic site, so they hold no member data. Shares setup with the e2e test via `test/helpers/harness.mjs` |
| `npm run dev` | Live-reload loop. Run in background with `> web-ext.log 2>&1`, add `MOZ_HEADLESS=1` for headless; grep the log for `[inspector-ext]` |

`.mcp.json` registers Mozilla's `firefox-devtools` MCP (headless Dev Edition, Firefox stdout in `firefox-output.log`) for interactive poking: `install_extension`, `navigate_page`, `take_snapshot`, `evaluate_script`, `get_firefox_output`.

## Rules that are easy to get wrong

- Firefox binaries: Dev Edition `/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox`, release `/Applications/Firefox.app/Contents/MacOS/firefox`. Temporary installs work on both.
- Always use throwaway profiles; never point tooling at the user's real profiles.
- Background-script logs are only visible on Firefox **stdout** with pref `devtools.console.stdout.content=true`. WebDriver BiDi (Puppeteer `page.on('console')`, MCP `list_console_messages`) sees content-script logs only. Prefix every log with `[<ext-name>]` so it can be grepped.
- `moz-extension://` URLs: pin the UUID with pref `extensions.webextensions.uuids={"<gecko id>":"<uuid>"}`. BiDi refuses to open these privileged pages unless Firefox runs with env `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. In Puppeteer, don't await `page.goto()` to a moz-extension URL (it never resolves); fire it and `waitForSelector` (see `openExtensionPage` in `test/e2e.mjs`).
- Playwright (and Playwright MCP) cannot load Firefox extensions; don't try.
- MV3 background in Firefox is `background.scripts` (event page), not `service_worker`. `"type": "module"` works.
- AMO manifest requirements: `browser_specific_settings.gecko.id`, `gecko.data_collection_permissions` (`{"required":["none"]}` if nothing is collected), `gecko.strict_min_version` ≥ 140 and `gecko_android.strict_min_version` ≥ 142 or lint warns.
- Content-script test pages must be served over `http://localhost`, not `file://` (Firefox 153+ blocks file access by default).
- MV3 `host_permissions` were granted automatically on temporary install in both Puppeteer and web-ext runs (Firefox 158/160).
- Content scripts are classic scripts sharing `globalThis.ie` (`content/common.js` loads first). Logic lives in ES modules under `lib/` and `parse/`, used only by the background and the tests.
- The e2e test generates a localhost manifest variant in a temp dir; never add `localhost` to `extension/manifest.json`.
