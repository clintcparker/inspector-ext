# Building, debugging and testing Firefox WebExtensions with an AI coding agent

Researched 2026-10-28. Primary sources only. Claims marked **UNVERIFIED** could not be confirmed from a primary source. Claims marked **(from source)** come from reading the code, not the docs, and have not been tested on a running browser. No browser was launched for this research.

**This machine (checked by reading Info.plist only, nothing launched):**
- `/Applications/Firefox.app` is **158.0**.
- `/Applications/Firefox Developer Edition.app` is **150.0**, which is several releases behind release. Update it before relying on it for features from Fx 151 and later, such as the private-browsing install flag (152), file-access opt-in (153) and `moz:listExtensions` (158).
- Node is v22.16.0. `web-ext` and `geckodriver` are not installed.

---

## TL;DR: recommended toolchain for an agent

| Loop step | Tool | Why |
|---|---|---|
| Build | `npx web-ext build --overwrite-dest` (or your bundler, then web-ext build) | Official packager. Respects `.web-extension-id` and ignore files. |
| Lint | `npx web-ext lint --output json --warnings-as-errors` (add `--self-hosted` if unlisted) | Runs addons-linter, the same linter AMO uses. Output is machine-readable JSON. |
| Run (interactive dev loop) | `npx web-ext run --firefox=deved --verbose --no-input --pref devtools.console.stdout.content=true --start-url http://localhost:PORT/test.html > web-ext.log 2>&1 &` | Temporary install with auto-reload. `--verbose` writes Firefox stdout to the log, and the pref makes extension and page `console.*` calls appear on stdout, so the agent can `grep` the log. |
| E2E test (scripted) | **Puppeteer over WebDriver BiDi**: `puppeteer.launch({browser:'firefox', executablePath:'/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', enableExtensions:['./dist'], dumpio:true, extraPrefsFirefox:{...}})`. Alternatively, Selenium + geckodriver. | Uses `webExtension.install`, so temporary or unsigned installs work on Fx ≥138. This works with stock Firefox and Dev Edition. |
| Interactive agent poking | **`@mozilla/firefox-devtools-mcp`** (Mozilla's official MCP). It has `install_extension` / `uninstall_extension`, `list_console_messages` and `get_firefox_output`. | It is the only MCP that can load an extension into Firefox. **Playwright MCP cannot.** |
| Unit tests | Vitest/Jest + an in-memory fake `browser` (`@webext-core/fake-browser` via WXT), or hand-rolled mocks | `webextension-polyfill` is archived, and `sinon-chrome` and `jest-webextension-mock` are stale. |
| Debug (human) | `web-ext run --devtools` (opens the about:debugging Inspect toolbox for the extension), `--browser-console` | Not scriptable. For the agent, use the stdout and BiDi paths above. |
| Sign | `web-ext sign --channel=unlisted --api-key=$WEB_EXT_API_KEY --api-secret=$WEB_EXT_API_SECRET` | AMO v5 API. Needed only for release/beta installs or for distribution. |

**Key facts:**
- Playwright **cannot** load extensions into Firefox. Maintainers say this is out of scope.
- Firefox has **no CDP**. It was removed in Firefox 141, and WebDriver BiDi replaced it.
- Firefox MV3 uses **event pages, not service workers**. `background.service_worker` is unsupported and off behind a pref.
- **WebDriver BiDi `log.entryAdded` deliberately does not report console calls from extension background contexts.** Background logs come out through stdout (`devtools.console.stdout.content`) or the about:debugging toolbox.

---

## 1. web-ext

### Install / versions
- Install with `npm install --global web-ext` or `npm install --save-dev web-ext`. Homebrew also has it (unofficial). [README](https://github.com/mozilla/web-ext/blob/master/README.md)
- The latest release is **10.8.0 (2026-10-15)**. [releases](https://github.com/mozilla/web-ext/releases/tag/10.8.0)
- `package.json` declares `engines.node >=20.0.0`. [package.json](https://github.com/mozilla/web-ext/blob/master/package.json)
- 10.0.0 (2026-03-13) says "we now use Node 22 by default", and 9.4.0 was "likely the last release officially supporting Node 20". [10.0.0](https://github.com/mozilla/web-ext/releases/tag/10.0.0), [9.4.0](https://github.com/mozilla/web-ext/releases/tag/9.4.0)
- 9.0.0 made a breaking change: `.js` config files are no longer accepted, so use `.cjs` or `.mjs`. [9.0.0](https://github.com/mozilla/web-ext/releases/tag/9.0.0)
- The package is ESM-only. CommonJS callers must use dynamic `import()`. [README](https://github.com/mozilla/web-ext/blob/master/README.md)
- Every CLI option can be set as an env var with the `WEB_EXT_` prefix, for example `WEB_EXT_SOURCE_DIR`, `WEB_EXT_API_KEY`, `WEB_EXT_FIREFOX`. [program.js](https://github.com/mozilla/web-ext/blob/master/src/program.js)

### `web-ext run`
All flags below come from the [command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) and [program.js](https://github.com/mozilla/web-ext/blob/master/src/program.js).

**Choosing the browser and profile:**
- `--firefox` / `-f`: an absolute path, or one of the aliases `firefox`, `beta`, `nightly`, `deved`, or `firefoxdeveloperedition`. Env var: `$WEB_EXT_FIREFOX`.
  - On macOS, `deved` resolves to `/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox` through fx-runner. [fx-runner utils.js](https://github.com/mozilla/node-fx-runner/blob/master/lib/utils.js)
  - Explicit form: `--firefox="/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"`.
- `--firefox-profile` / `-p`: a profile name or path. It is **copied** into a temporary profile unless you also pass `--keep-profile-changes`. That flag writes changes back and "makes the profile ... insecure for daily use". `--profile-create-if-missing` also exists. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

**Opening DevTools on startup:**
- `--devtools` opens DevTools for the extension on startup. It requires Fx 106+.
- `--browser-console` / `-bc` opens the Browser Console. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

**Prefs, URLs and browser args:**
- `--pref name=value` is repeatable and does not modify the profile.
- These prefs **cannot** be overridden: `devtools.debugger.remote-enabled`, `devtools.debugger.prompt-connection`, and `xpinstall.signatures.required`. [preferences.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/preferences.js)
- `--start-url` / `-u` / `--url` is repeatable, one tab per use.
- `--args` / `--arg` passes extra arguments to the Firefox binary. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

**Reloading:**
- `--reload` is on by default. `--no-reload` disables it.
- `--watch-file` / `--watch-files` watches only specific files, such as bundler output.
- `--watch-ignored` sets ignore globs.
- In interactive mode, pressing `R` in the terminal reloads the extension. `--no-input` disables stdin. [program.js](https://github.com/mozilla/web-ext/blob/master/src/program.js), [extension-runners/index.js](https://github.com/mozilla/web-ext/blob/master/src/extension-runners/index.js)

**Other:**
- `--target firefox-desktop|firefox-android|chromium`. `--verbose` / `-v` is a global option. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

**How it works (from source):**
- web-ext launches Firefox through fx-runner with `-no-remote`, `-foreground`, and a free port for the DevTools **Remote Debugging Protocol (RDP)** server.
- It then calls the RDP `installTemporaryAddon` request and uses `reloadAddon` for auto-reload. [firefox/index.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/index.js), [firefox/remote.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/remote.js)
- This RDP port is **not** CDP or BiDi, so Puppeteer and Playwright cannot attach to it. See [web-ext#1927](https://github.com/mozilla/web-ext/issues/1927), which is still open.

**Default prefs web-ext sets** ([preferences.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/preferences.js)):
- `xpinstall.signatures.required=false`
- `browser.dom.window.dump.enabled=true`, so `dump()` writes to stdout
- `devtools.browserconsole.contentMessages=true`
- `devtools.debugger.remote-enabled=true`
- `devtools.chrome.enabled=true`
- `devtools.debugger.show-content-scripts=true`
- Extension updates disabled, among others

10.2.0 also made content scripts visible in the debugger by default. [10.2.0](https://github.com/mozilla/web-ext/releases/tag/10.2.0)

**Reading console output headlessly (from source):**
- web-ext pipes Firefox's **stdout and stderr to its debug logger**. These lines appear only with `--verbose`, as `Firefox stdout: ...` and `Firefox stderr: ...`. [firefox/index.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/index.js)
- web-ext does **not** set `devtools.console.stdout.content`, so you must add it: `--pref devtools.console.stdout.content=true`.
  - In Gecko, a `console.*` call from a non-system caller is dumped to stdout when `devtools.console.stdout.content` is true. That covers web pages and, by inference, moz-extension background, popup and options pages and content scripts.
  - Chrome-privileged callers use `devtools.console.stdout.chrome` instead. [Console.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/console/Console.cpp), [StaticPrefList.yaml](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml)
  - Both prefs default to false in official builds (`@IS_NOT_MOZILLA_OFFICIAL@`).
  - *Not tested on a live browser*: whether every extension context hits the "content" branch.
- Alternative: `MOZ_LOG=console:5`. Console calls are also routed to the `console` MOZ_LOG module. [Console.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/console/Console.cpp)
- There is no structured API for this. Open issue [web-ext#2294](https://github.com/mozilla/web-ext/issues/2294) asks for processing extension console output externally.

**Headless:**
- `web-ext run` has **no `--headless` flag**. Maintainers closed [web-ext#1337](https://github.com/mozilla/web-ext/issues/1337) as out of scope and pointed to Selenium.
- Firefox itself honours `--headless` and `MOZ_HEADLESS=1`. [nsAppRunner.cpp](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/xre/nsAppRunner.cpp)
- web-ext passes `process.env` through to Firefox, and `--arg=--headless` passes the flag. [firefox/index.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/index.js)
- **UNVERIFIED** in practice: `MOZ_HEADLESS=1 web-ext run ...` should therefore work.

### `web-ext lint`
- Options: `--output json|text`, `--pretty`, `--metadata`, `--self-hosted`, `--boring`, `--warnings-as-errors` / `-w`. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
- `--enterprise` was added in 10.5.0. [10.5.0](https://github.com/mozilla/web-ext/releases/tag/10.5.0)
- 10.8.0 bundles Firefox 158 schemas. [10.8.0](https://github.com/mozilla/web-ext/releases/tag/10.8.0)
- Since 9.1.0, lint warns `MISSING_ADDON_ID` when there is no gecko id. [9.1.0](https://github.com/mozilla/web-ext/releases/tag/9.1.0)
- addons-linter (latest 10.15.0) emits `MISSING_DATA_COLLECTION_PERMISSIONS` as a **warning**, `NONE_DATA_COLLECTION_IS_EXCLUSIVE`, and others. [addons-linter messages](https://github.com/mozilla/addons-linter/blob/master/src/messages/manifestjson.js)

### `web-ext build`
- Options: `--overwrite-dest` / `-o`, `--filename` / `-n` (default `{name}-{version}.zip`, with manifest substitutions), `--as-needed` (rebuild on change), and global `--artifacts-dir` (default `./web-ext-artifacts`). [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

### `web-ext sign`
- Required: `--api-key` (the JWT issuer), `--api-secret`, and `--channel listed|unlisted`. [program.js](https://github.com/mozilla/web-ext/blob/master/src/program.js)
- Optional: `--amo-metadata <json>` (required for the first **listed** version), `--upload-source-code <archive>`, `--approval-timeout <ms>` (0 means don't wait; the default is 15 min), `--timeout`, `--api-proxy`, and `--amo-base-url` (default `https://addons.mozilla.org/api/v5/`). [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/), [constants.js](https://github.com/mozilla/web-ext/blob/master/src/util/constants.js)
- It uses the AMO **v5 add-on submission API**, through the `addon/` and `addon/{id}/versions/` endpoints. [submit-addon.js](https://github.com/mozilla/web-ext/blob/master/src/util/submit-addon.js)
- web-ext 8+ can handle the first submission and updates for both listed and unlisted channels. [Signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- Updates must have the extension ID in the manifest. [cmd ref](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
- 10.8.0 fixed the default `amoBaseUrl` when signing from the Node API. [10.8.0](https://github.com/mozilla/web-ext/releases/tag/10.8.0)

### Programmatic Node API
From the [README](https://github.com/mozilla/web-ext/blob/master/README.md). Support is limited, and breaking changes are possible in minor releases.

```js
import webExt from 'web-ext';
const runner = await webExt.cmd.run(
  { sourceDir: './dist', firefox: 'deved', noInput: true, pref: { 'devtools.console.stdout.content': true } },
  { shouldExitProgram: false },
);
await runner.reloadAllExtensions();
await runner.exit();
// also: webExt.cmd.build / lint / sign ({ apiKey, apiSecret, channel: 'unlisted', sourceDir })
```

The README documents `noInput`, `shouldExitProgram`, `getValidatedManifest`, `extensionRunner.reloadAllExtensions()` / `.exit()`, and `web-ext/util/adb`. The exact shape of `pref` in the API call above is **UNVERIFIED**. The CLI form `--pref` is documented.

---

## 2. Loading unsigned / temporary extensions

**Temporary install through the UI:**
1. Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
2. Select any file in the extension directory, or a `.zip`.

The extension stays installed until it is removed or Firefox restarts. **Reload** re-parses the manifest and restarts the background page. Storage persists after removal. [Temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)

The about:debugging card shows the Extension ID, **Internal UUID** and Manifest URL. [about:debugging docs](https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html)

**`xpinstall.signatures.required`:**
- Unsigned extensions can be installed in **Developer Edition, Nightly and ESR** after setting this pref to false. Release and Beta require signing. [Signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- The restart-testing guide also lists "unbranded Beta or Release builds". [Testing persistent features](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/)
- In code, builds compiled with `MOZ_REQUIRE_SIGNING` hard-code `REQUIRE_SIGNING=true` and ignore the pref, except when `Cu.isInAutomation`. [AddonSettings.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/internal/AddonSettings.sys.mjs)
- `browser/app/profile/firefox.js` defaults the pref to `true`. [firefox.js](https://github.com/mozilla-firefox/firefox/blob/main/browser/app/profile/firefox.js)
- **Temporary installs work on all builds, including release.**

**Permanent unsigned XPI in Developer Edition:**
1. Set `browser_specific_settings.gecko.id`. Without it you get "Cannot find id for addon".
2. Set `xpinstall.signatures.required=false` in `about:config`.
3. Run `web-ext build`.
4. In `about:addons`, use the gear menu → **Install Add-on From File**.

[Testing persistent features](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/)

**Gecko id (`browser_specific_settings.gecko.id`):**
- **MV3:** "Mandatory for signing", and AMO does not assign an ID.
- **MV2:** recommended. AMO assigns a GUID if it is missing.
- Format: either `^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$` with at most 80 chars, or `{GUID}`. [MDN browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

**`data_collection_permissions` (2025 requirement):**
- From **2025-11-03**, all **new** extensions must declare `browser_specific_settings.gecko.data_collection_permissions`.
  - Use `{"required":["none"]}` if the extension collects nothing.
  - Otherwise list `required` and `optional` categories. `technicalAndInteraction` is optional-only.
  - [Mozilla Add-ons blog 2025-10-23](https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/), [Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
- Built-in consent UI requires Firefox desktop 140+ and Android 142+. Otherwise set `strict_min_version` to those values or build your own consent UI. [Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- Mozilla said it would extend this to all extensions in H1 2026. As of the current addons-linter, the message still says it "will be required for new versions of existing extensions in the future". [addons-linter](https://github.com/mozilla/addons-linter/blob/master/src/messages/manifestjson.js)
- **UNVERIFIED:** whether enforcement for existing add-ons has started. No 2026 announcement was found on the [Add-ons blog index](https://blog.mozilla.org/addons/).

---

## 3. Automation / testing

### 3a. WebDriver BiDi `webExtension.install` / `uninstall`

**Spec:**
- `webExtension.install` takes `{extensionData}`, where `extensionData` is one of:
  - `{type:"path", path}` for an unpacked directory
  - `{type:"archivePath", path}` for a `.xpi` or `.zip`
  - `{type:"base64", value}`
- It returns `{extension: <id>}`.
- `webExtension.uninstall` takes `{extension: id}`.
- Errors: `invalid web extension` and `no such web extension`.
- The spec is still an Editor's Draft (dated 8 Oct 2026). [W3C WebDriver BiDi ED](https://w3c.github.io/webdriver-bidi/), [index.bs](https://github.com/w3c/webdriver-bidi/blob/main/index.bs)

**Firefox:**
- Shipped in **Firefox 137** ([Firefox WebDriver newsletter 137](https://fxdx.dev/firefox-webdriver-newsletter-137/)), with a meta tracker at [bug 1934549](https://bugzilla.mozilla.org/show_bug.cgi?id=1934549).
- Since **Firefox 138**, installs are **temporary by default**, so unsigned XPIs and directories work. Pass `moz:permanent: true` for a normal install, which requires signing. [newsletter 138](https://fxdx.dev/firefox-webdriver-newsletter-138/), [bug 1947678](https://bugzilla.mozilla.org/show_bug.cgi?id=1947678) (fixed in 138/139)
- Since **Firefox 152**, `moz:allowPrivateBrowsing: true` enables the extension in private windows. [bug 1947679](https://bugzilla.mozilla.org/show_bug.cgi?id=1947679), [Firefox BiDi extensions doc](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html)
- Firefox adds a non-standard command, **`webExtension.moz:listExtensions`** ([bug 2068045](https://bugzilla.mozilla.org/show_bug.cgi?id=2068045), fixed in 158). It returns id, `manifestVersion`, `temporarilyInstalled` and more.
  - The `policy` field, with `uuid`, `extensionURL` (`moz-extension://<uuid>/`) and `backgroundScripts`, is returned **only when `RemoteAgent.allowSystemAccess`** is true, which means `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. [Extensions.md](https://github.com/mozilla-firefox/firefox/blob/main/remote/doc/webdriver-bidi/Extensions.md)
- Start the Remote Agent with `firefox --remote-debugging-port [port]` (default **9222**), plus `--remote-allow-hosts` and `--remote-allow-origins`. [RemoteAgent.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/remote/components/RemoteAgent.sys.mjs)

### 3b. geckodriver / Marionette / Selenium

**geckodriver vendor endpoints:**
- `POST /session/{id}/moz/addon/install` takes a body of either `{addon: <base64>}` or `{path: <abs path>}`, each with optional `temporary: bool` and `allowPrivateBrowsing: bool`.
- `POST /session/{id}/moz/addon/uninstall` takes `{id}`.
- [geckodriver command.rs](https://github.com/mozilla-firefox/firefox/blob/main/testing/geckodriver/src/command.rs)
- Internally, `temporary` calls `AddonManager.installTemporaryAddon`, which does not need signing. [remote/shared/Addon.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/remote/shared/Addon.sys.mjs)
- The latest geckodriver is **0.37.1** (2026-07-20). [releases](https://github.com/mozilla/geckodriver/releases)

**Selenium:**
- Selenium **4.51.0** is the latest release. Python has `driver.install_addon(path, temporary=True)`, which zips directories automatically, and `driver.uninstall_addon(id)`. It also has BiDi `driver.webextension.install(path=...)`. [4.51 webdriver.py](https://github.com/SeleniumHQ/selenium/blob/selenium-4.51.0/py/selenium/webdriver/remote/webdriver.py)
- On trunk (4.52, unreleased), `install_addon` is **deprecated** in favour of a cross-browser `install_web_extension(path, permanent=..., allow_private_browsing=...)`. It uses BiDi when enabled and falls back to the geckodriver endpoint otherwise. [trunk firefox/webdriver.py](https://github.com/SeleniumHQ/selenium/blob/trunk/py/selenium/webdriver/firefox/webdriver.py), [trunk remote/webdriver.py](https://github.com/SeleniumHQ/selenium/blob/trunk/py/selenium/webdriver/remote/webdriver.py), [trunk firefox.js](https://github.com/SeleniumHQ/selenium/blob/trunk/javascript/selenium-webdriver/firefox.js)

### 3c. Puppeteer + Firefox (BiDi)
- WebDriver BiDi is the default protocol for Firefox in Puppeteer, and Chrome still defaults to CDP. Unsupported features throw `UnsupportedOperation`. [pptr.dev/webdriver-bidi](https://pptr.dev/webdriver-bidi)
- **`browser.installExtension(path)` / `browser.uninstallExtension(id)`** and the launch option **`enableExtensions`** were added in **puppeteer-core 24.8.0 (2025-05-02)**. [CHANGELOG](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/CHANGELOG.md)
- Over BiDi, `installExtension` sends `webExtension.install` with `{type:'path', path}`. Puppeteer's own install options, such as `enabledInIncognito`, are **not forwarded** on BiDi. [bidi/core/Browser.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/bidi/core/Browser.ts), [bidi/Browser.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/bidi/Browser.ts)
- `enableExtensions: ['path']` calls `browser.installExtension` for each path after launch. [BrowserLauncher.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/BrowserLauncher.ts)
- Unsigned or unpacked installs need Firefox **≥138**, because of the temporary-by-default change.
- The current Puppeteer is 25.16.0. Its [Chrome Extensions guide](https://pptr.dev/guides/chrome-extensions) is Chrome-only.
- These BiDi-mode methods are unsupported: `Page.extensionRealms()`, `triggerExtensionAction()`, `Frame.extensionRealms()` and `Realm.extension()`. So **Puppeteer cannot evaluate in a Firefox extension's background realm.** [pptr.dev/webdriver-bidi](https://pptr.dev/webdriver-bidi)
- Useful launch options: `browser:'firefox'`, `executablePath` (Dev Edition path), `extraPrefsFirefox`, `dumpio:true` (pipes browser stdout/stderr), and `headless`. [LaunchOptions.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/LaunchOptions.ts)
- Firefox is launched with `--remote-debugging-port`. [FirefoxLauncher.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/FirefoxLauncher.ts)

### 3d. Playwright: does not work for Firefox extensions
- The docs say extensions work **only in Chromium**, using `launchPersistentContext` plus `--load-extension`. [playwright.dev/docs/chrome-extensions](https://playwright.dev/docs/chrome-extensions)
- The Firefox extension feature request [#7297](https://github.com/microsoft/playwright/issues/7297) was closed on 2024-12-03 by a maintainer: "Support for Firefox extensions is outside of the scope for Playwright." [#36728](https://github.com/microsoft/playwright/issues/36728) (xpi install) was folded into it.
- Playwright's Firefox is a **patched build**: "Playwright doesn't work with the branded version of Firefox since it relies on patches". [playwright.dev/docs/browsers](https://playwright.dev/docs/browsers) That means it **cannot drive your installed Dev Edition**.
- The source has undocumented BiDi channels `moz-firefox`, `moz-firefox-beta` and `moz-firefox-nightly`, which point to stock Firefox paths. [registry/index.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/index.ts)
  - They are experimental. There is no public `webExtension.install` wrapper, and they are not in the docs.
  - **UNVERIFIED** whether they are usable for extension testing.
- **Playwright MCP** (the tool this agent already has) supports `--browser firefox` and `--executable-path`, but has no option to load an extension. Its `--extension` flag is about connecting to Chrome/Edge through the Playwright extension. [playwright-mcp README](https://github.com/microsoft/playwright-mcp/blob/main/README.md)
- Community workarounds exist but are not primary sources. One opens the DevTools RDP port and calls `installTemporaryAddon`, for example `ueokande/playwright-webextext`. Another uses an enterprise policy. Both are mentioned in #7297.
- **Use Playwright MCP only for testing plain web pages or a Chromium build of the extension.**

### 3e. Interacting with extension pages, content scripts and logs

**Finding the `moz-extension://` UUID (random per profile):**
- **Pin it.** Firefox reads the JSON pref `extensions.webextensions.uuids`, which maps `{addonId: uuid}`, when assigning UUIDs. (from source: [Extension.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/extensions/Extension.sys.mjs) `UUIDMap`)
  - Pre-seed it at launch with `--pref 'extensions.webextensions.uuids={"my@ext":"11111111-2222-3333-4444-555555555555"}'` or `extraPrefsFirefox`.
  - Then open `moz-extension://1111.../popup.html`. Not tested live.
- Alternatively, `webExtension.moz:listExtensions` returns it, but only with `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. [Extensions.md](https://github.com/mozilla-firefox/firefox/blob/main/remote/doc/webdriver-bidi/Extensions.md)
- Or read the Internal UUID on about:debugging.

**Popups and options pages:**
- Open `popup.html` or `options.html` as a normal tab and drive it like any page. Real toolbar popups are browser-chrome panels.
- Since Firefox 149, `action.openPopup()` no longer needs a user gesture on desktop. That helps when a test hook triggers the popup. [Add-ons blog Fx149–152](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/)
- **UNVERIFIED** whether BiDi can see or drive the real popup panel.

**Background / event pages:**
- These are **not exposed** as BiDi browsing contexts. [Bug 1755014](https://bugzilla.mozilla.org/show_bug.cgi?id=1755014), "MessageHandler: Support webextension contexts", is still NEW.
- The way to observe or drive the background page is message passing from an extension page opened in a tab, for example a test page `moz-extension://<uuid>/test.html` that calls `browser.runtime.sendMessage`. Another option is a debug hook in your own extension.

**Content scripts:**
- Serve test pages over `http://localhost`, **not `file://`**. From **Firefox 153**, file:// access is a separate opt-in permission that is **off by default for every extension**. [Add-ons blog Fx153](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/)
- Firefox's own BiDi tests cover content-script execution after a temporary install, in `content_script.py`. [bug 2046370](https://bugzilla.mozilla.org/show_bug.cgi?id=2046370)

**Console capture:**
- **BiDi `log.entryAdded` intentionally does not report Console API calls from webextension (background) contexts.** [Bug 1753939](https://bugzilla.mozilla.org/show_bug.cgi?id=1753939), fixed in Fx 99: events should be emitted only "for anything happening on the web page in the child process".
- **UNVERIFIED:** whether `log.entryAdded` reports `console.*` from a content script's sandbox, or from a moz-extension page loaded in a tab. Test this; don't assume it.
- **Reliable route:** `devtools.console.stdout.content=true`, then read Firefox stdout. Ways to read it:
  - `web-ext run --verbose`
  - Puppeteer `dumpio:true`
  - firefox-devtools-mcp `get_firefox_output`
  - Add `MOZ_LOG=console:5` if needed. (from source, see section 1)
- `dump("...\n")` also prints to stdout when `browser.dom.window.dump.enabled=true`, which web-ext sets. [preferences.js](https://github.com/mozilla/web-ext/blob/master/src/firefox/preferences.js)

### 3f. Unit testing (mocking `browser.*`)
- **`webextension-polyfill` is archived.** Its README says Chrome 148+ supports the `browser` namespace (all extensions from Chrome 152), "this polyfill has served its purpose, and will not receive any further updates". On Firefox it was always a no-op. [README](https://github.com/mozilla/webextension-polyfill)
- In MV3, Firefox supports promises on `chrome.*` too. [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- Mock libraries:
  - `sinon-chrome`: last release 2018, last push 2021. [repo](https://github.com/acvetkov/sinon-chrome)
  - `jest-webextension-mock`: last release 2020. [repo](https://github.com/clarkbw/jest-webextension-mock)
  - `webextensions-api-fake`: last release 2019. [repo](https://github.com/stoically/webextensions-api-fake)
  - All three still work as simple stubs but are **unmaintained**.
- The best-maintained option is **WXT's Vitest plugin** (`WxtVitest()`), which injects `@webext-core/fake-browser`, an in-memory implementation including storage. WXT is active, at v0.21.5 (2026-10-26). [WXT unit testing doc](https://github.com/wxt-dev/wxt/blob/main/docs/guide/essentials/unit-testing.md)
- If you don't use WXT: put browser access behind thin wrappers and inject fakes. **UNVERIFIED:** whether `@webext-core/fake-browser` works without WXT.

---

## 4. Debugging

**Built-in tools (human-facing):**
- **about:debugging → Inspect** opens a toolbox for the extension: console and debugger for the background/event page.
- While the toolbox is open, a non-persistent background page **won't go idle**. That is a gotcha when testing suspend and wake behaviour.
- Content scripts are debugged in the page's own DevTools (Sources → "Show content scripts").
- For popups, use **Disable Popup Auto-Hide**, which sets `ui.popup.disable_autohide`.
- For options pages, debug from about:addons.
- The **Browser Console** shows whole-browser messages, such as nativeMessaging stderr.
- [Debugging guide](https://extensionworkshop.com/documentation/develop/debugging/)

**Remote debugging (RDP):**
- `firefox --start-debugger-server [port | ws:port | /unix/socket]`. The default port is 6000 from `devtools.debugger.remote-port`. Sockets are TCP by default, or WebSocket with `ws:`.
- It requires **both** `devtools.debugger.remote-enabled` and `devtools.chrome.enabled` to be true.
- [DevToolsStartup.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/devtools/startup/DevToolsStartup.sys.mjs)
- `--jsdebugger` opens the Browser Toolbox, and `--wait-for-jsdebugger` blocks until a debugger attaches.
- RDP is Firefox's internal DevTools protocol, with no stable public client API. web-ext uses it only for install and reload.

**Can the agent script this?**
- Not the toolbox UI.
- An agent *can* use:
  - stdout logging (above)
  - BiDi through Puppeteer, Selenium or firefox-devtools-mcp
  - Firefox's vendor BiDi module **`moz:debugging`**: enable debugger, breakpoints, get scripts, step, and `paused`/`resumed` events. [Firefox BiDi extensions doc](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html)
- firefox-devtools-mcp exposes `moz:debugging` as `enable_debugger` / `list_scripts` / `set_logpoint`. These need Fx 153+ and target pages, not the extension background. [tools.md](https://github.com/mozilla/firefox-devtools-mcp/blob/main/docs/tools.md)

**CDP removal:**
- Mozilla deprecated Firefox's experimental CDP in May 2024, starting with Fx 129.
- It was **removed in Firefox 141** (release 2025-07-22). [Bug 1882096](https://bugzilla.mozilla.org/show_bug.cgi?id=1882096) was fixed in 141, and the `remote.active-protocols` pref was removed with it.
- **WebDriver BiDi** replaced it.
- Firefox 140 ESR is the last version with CDP. [CDP retirement post](https://fxdx.dev/cdp-retirement-in-firefox/), [deprecation post](https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/)

---

## 5. MV2 vs MV3 in Firefox

**Versions:**
- MV3 has been generally available since **Firefox 109**, after a developer preview from Fx 101. [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- Non-persistent background pages (event pages) work in MV2 from Fx 106.

**Background:**
- **Firefox does not support `background.service_worker`.** [MDN background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [meta bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659), still NEW
- The pref `extensions.backgroundServiceWorker.enabled` defaults to false. [StaticPrefList.yaml](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml)
- MV3 Firefox uses `background.scripts` or `page` as **event pages**. `persistent` defaults to false, and true is an error.
- For cross-browser MV3, declare both `"scripts":["bg.js"]` and `"service_worker":"bg.js"`. Firefox ignores `service_worker` and starts the page since Fx 121. Chrome ignores `scripts`.
- `background.type: "module"` is supported.
- [MDN background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)

**Host permissions:**
- In MV3 these go in `host_permissions` / `optional_host_permissions`, and users can grant or revoke them at any time.
- Before Fx 127 they were not shown at install. From Fx 127 they appear in the install prompt, but hosts newly added in an update are not.
- Code should check with `permissions.contains` and call `permissions.request` as needed. [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- File access is a separate opt-in from Fx 153. [Fx153 post](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/)

**Namespace:**
- `browser.*` with promises works everywhere in Firefox.
- In MV3, `chrome.*` also returns promises. [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

**Other MV3 changes:**
- `action` replaces `browser_action`.
- The `scripting` API replaces `tabs.executeScript`, and there is no `code` string.
- The CSP is stricter, with no remote code or `unsafe-eval`.
- Content-script cross-origin fetch is blocked.
- [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

**MV2 stance:**
- "Firefox has no plans to deprecate MV2", and Mozilla promised at least 12 months' notice if that changes. Mozilla continues to support **blocking webRequest**. [Add-ons blog Mar 2024](https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/)
- Reaffirmed in Feb 2025: Firefox "will continue supporting both" blocking webRequest and declarativeNetRequest. [Mozilla blog 2025-02-25](https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/)
- **UNVERIFIED:** any 2026 statement changing this. None was found on the Add-ons blog index.

**Recent Firefox-specific API changes:**
- Content-script injection into `moz-extension://` documents through `scripting`/`tabs` was deprecated in Fx 149 and **removed in Fx 152**. [Fx149–152 post](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/)
- Fx 153 added `runtime.getDocumentId()` / `documentId`, `userScripts.execute()` and `publicSuffix`. [Fx153 post](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/)

---

## 6. Signing and distribution

**Signing methods:**
- **AMO signing** goes through `web-ext sign`, the Developer Hub, or the v5 Add-on/Version Create APIs. The v4 Signing API is limited to unlisted first submissions. [Signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- **Listed** extensions are public on AMO with auto-updates. **Unlisted** extensions are self-distributed and not visible on AMO. Both can be manually reviewed at any time. [Signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

**API keys:**
- Get them from `https://addons.mozilla.org/en-US/developers/addon/api/key/`.
- Requests carry `Authorization: JWT <token>`, signed HS256 with the secret. Claims are `iss`=key, `jti`, `iat`, and `exp` at most 5 minutes after `iat`. [addons-server auth docs](https://mozilla.github.io/addons-server/topics/api/auth.html)
- web-ext builds the JWT for you.

**Self-distribution updates:**
- Set `browser_specific_settings.gecko.update_url`, which must be HTTPS.
- Host an update manifest shaped `{"addons":{"<id>":{"updates":[{"version","update_link","update_hash"?,"applications":{"gecko":{"strict_min_version"}}}]}}}`.
- `update_link` must be HTTPS, or carry an `update_hash`. [Updating your extension](https://extensionworkshop.com/documentation/manage/updating-your-extension/)
- Updates need Firefox ≥115 ESR / 128 because of the March 2025 root certificate expiry. [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

**Enterprise policy install (another automation path):**
- `policies.json` goes in `Firefox Developer Edition.app/Contents/Resources/distribution/` on macOS. Configuration profiles (plist) are also supported. [policy-templates](https://mozilla.github.io/policy-templates/)
- Example: `{"policies":{"ExtensionSettings":{"my@ext":{"installation_mode":"force_installed","install_url":"file:///abs/path/ext.xpi"}}}}`.
- `installation_mode` can be `allowed`, `blocked`, `force_installed` or `normal_installed`.
- `file:///` URLs are supported, and Firefox "will update or re-install the extension whenever the XPI file at that path changes". [ExtensionSettings](https://firefox-admin-docs.mozilla.org/reference/policies/extensionsettings/)
- **UNVERIFIED** from primary docs: whether policy-installed unsigned XPIs are accepted on Dev Edition with `xpinstall.signatures.required=false`. Assume a signed (unlisted) XPI is needed on release.
- Writing into the app bundle modifies the install, so prefer a dedicated test install.

---

## 7. MCP servers and agent tooling for Firefox

**`mozilla/firefox-devtools-mcp`: official and verified.**
- Repo: [github.com/mozilla/firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp). It describes itself as "Maintained by Mozilla".
- Latest release is **v0.10.7, 2026-10-28**. npm package: `@mozilla/firefox-devtools-mcp`.
- It is also documented in Firefox's tree: [AI agent tools docs](https://firefox-source-docs.mozilla.org/ai-agent-tools/firefox-devtools-mcp.html).
- It controls Firefox through WebDriver BiDi, via Selenium, and falls back to Marionette for chrome-context work.
- Requires Node ≥20.19 and Firefox 100+. [README](https://github.com/mozilla/firefox-devtools-mcp/blob/main/README.md)

Install and point it at Dev Edition:
```bash
claude mcp add firefox-devtools -- npx @mozilla/firefox-devtools-mcp@latest \
  --firefox-path "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox" \
  --tool-preset developer --pref devtools.console.stdout.content=true
```

Flags:
- `--headless`, `--profile-path`, `--firefox-arg`
- `--pref name=value`, passed through `moz:firefoxOptions`
- `--connect-existing` with `--marionette-port 2828`. The running Firefox must be started with `--marionette --remote-debugging-port`.
- `--log-file`

Tool presets: `slim`, `basic` (default), `developer`, `mozilla`, `all`. [README](https://github.com/mozilla/firefox-devtools-mcp/blob/main/README.md)

Extension-relevant tools ([tools.md](https://github.com/mozilla/firefox-devtools-mcp/blob/main/docs/tools.md)):
- **`install_extension`** (`type: archivePath|base64|path`, `permanent`) and **`uninstall_extension`**, through BiDi `webExtension.*`. These are in the `basic` preset.
- `list_console_messages` and `clear_console_messages` (`developer` preset). They cover page console only, per the BiDi limitation above.
- **`get_firefox_output`**: Firefox stdout/stderr including MOZ_LOG, with `grep`, `since` and `lines` filters. Combined with `devtools.console.stdout.content=true`, this is how the agent reads background-script logs. (from source, not tested live)
- `evaluate_script`, `take_snapshot`, `click_by_uid`, `screenshot_page`, `list_network_requests`, and `enable_debugger` / `set_logpoint` (Fx 153+).
- `list_extensions` (with UUIDs and background scripts) and privileged chrome-context tools need `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`.
  - The `prefs`, `privileged`, `launch` and `bidi` modules are **Mozilla-internal build only**. The public npm package drops them.
  - [Bug 2073093](https://bugzilla.mozilla.org/show_bug.cgi?id=2073093) tracks migrating `list_extensions` to `moz:listExtensions`.

**Other projects:**
- A similarly named third-party `freema/firefox-devtools-mcp` exists. The Mozilla repo is the canonical one. **UNVERIFIED** how the two are related.
- No separate "Remote Agent MCP" from Mozilla was found.

---

## What does NOT work / gotchas

1. **Playwright and Playwright MCP cannot load Firefox extensions.** This is officially out of scope ([#7297](https://github.com/microsoft/playwright/issues/7297)). Playwright also cannot drive branded Firefox or Dev Edition ([browsers](https://playwright.dev/docs/browsers)).
2. **No CDP in Firefox ≥141.** Any tool that uses `--remote-debugging-port` expecting CDP will fail. Use BiDi ([CDP retirement](https://fxdx.dev/cdp-retirement-in-firefox/)).
3. **The web-ext RDP port is not BiDi or CDP.** You can't attach Puppeteer or Playwright to it ([web-ext#1927](https://github.com/mozilla/web-ext/issues/1927)). To combine web-ext with BiDi, pass `--arg=--remote-debugging-port=9222`. That this works is **UNVERIFIED**.
4. **BiDi does not see extension background contexts.** `log.entryAdded` excludes their console ([bug 1753939](https://bugzilla.mozilla.org/show_bug.cgi?id=1753939)), and MessageHandler has no webextension-context support ([bug 1755014](https://bugzilla.mozilla.org/show_bug.cgi?id=1755014)). Puppeteer's extension-realm APIs are CDP-only ([pptr BiDi](https://pptr.dev/webdriver-bidi)). Use stdout plus `devtools.console.stdout.content`.
5. **`background.service_worker` doesn't run in Firefox.** Ship `background.scripts` as well ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)).
6. **An open Inspect toolbox keeps an event page alive**, which masks suspend and wake bugs ([Debugging](https://extensionworkshop.com/documentation/develop/debugging/)).
7. **`moz-extension://` UUIDs are random per profile.** Pin them with `extensions.webextensions.uuids` (from source) or discover them; don't hard-code.
8. **file:// test pages:** from Fx 153, content scripts need the user-granted file-access opt-in. Use a localhost HTTP server ([Fx153](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/)).
9. **No `scripting.executeScript` into moz-extension pages** since Fx 152 ([Fx149–152](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/)).
10. **MV3 host permissions can be ungranted.** Under automation, a content script may silently not run until permission is granted. Fx 127+ shows them at install, but temporary or automated installs may not grant them. **UNVERIFIED** how BiDi/web-ext temporary installs treat MV3 host permission grants. Test with `permissions.contains`.
11. **Permanent installs (`moz:permanent`, geckodriver `temporary:false`) require signing** on release/beta. Unpacked directories cannot be installed permanently over BiDi ([bug 1958723](https://bugzilla.mozilla.org/show_bug.cgi?id=1958723), [Extensions doc](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html)).
12. **`web-ext run` has no headless flag.** Use `MOZ_HEADLESS=1` or `--arg=--headless` (UNVERIFIED in practice), or use Puppeteer/Selenium/MCP headless.
13. **web-ext prints Firefox stdout only with `--verbose`.** Run it in the background, redirect to a file, and grep for `Firefox stdout:`.
14. **The local Dev Edition is 150.** It lacks `moz:allowPrivateBrowsing` (152), the file-access change (153), the `moz:debugging`-based MCP tools (153) and `moz:listExtensions` (158). Update it, or use release 158 for temporary-install tests (temporary installs work on release).
15. **New AMO submissions fail without `data_collection_permissions`.** Lint only warns ([addons-linter](https://github.com/mozilla/addons-linter/blob/master/src/messages/manifestjson.js)).
16. **`webextension-polyfill` is archived.** Don't add it for Firefox ([repo](https://github.com/mozilla/webextension-polyfill)).

---

## Sources

**Mozilla Extension Workshop / MDN**
- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
- https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/
- https://extensionworkshop.com/documentation/develop/debugging/
- https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/manage/updating-your-extension/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background

**web-ext / addons-linter / AMO**
- https://github.com/mozilla/web-ext (README, src/program.js, src/firefox/*.js, src/util/*.js)
- https://github.com/mozilla/web-ext/releases (9.0.0 – 10.8.0)
- https://github.com/mozilla/web-ext/issues/1337 , /1927 , /2294
- https://github.com/mozilla/node-fx-runner/blob/master/lib/utils.js
- https://github.com/mozilla/addons-linter/blob/master/src/messages/manifestjson.js
- https://mozilla.github.io/addons-server/topics/api/auth.html

**Firefox source / docs / Bugzilla**
- https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html
- https://github.com/mozilla-firefox/firefox/blob/main/remote/doc/webdriver-bidi/Extensions.md
- https://github.com/mozilla-firefox/firefox/blob/main/remote/components/RemoteAgent.sys.mjs
- https://github.com/mozilla-firefox/firefox/blob/main/remote/shared/Addon.sys.mjs
- https://github.com/mozilla-firefox/firefox/blob/main/testing/geckodriver/src/command.rs
- https://github.com/mozilla-firefox/firefox/blob/main/devtools/startup/DevToolsStartup.sys.mjs
- https://github.com/mozilla-firefox/firefox/blob/main/dom/console/Console.cpp
- https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml
- https://github.com/mozilla-firefox/firefox/blob/main/browser/app/profile/firefox.js
- https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/internal/AddonSettings.sys.mjs
- https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/extensions/Extension.sys.mjs
- https://github.com/mozilla-firefox/firefox/blob/main/toolkit/xre/nsAppRunner.cpp
- https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html
- https://firefox-source-docs.mozilla.org/ai-agent-tools/firefox-devtools-mcp.html
- Bugzilla: 1573659, 1753939, 1755014, 1882096, 1934549, 1947678, 1947679, 1958723, 2046370, 2068045, 2073093 (https://bugzilla.mozilla.org/show_bug.cgi?id=NNN)
- https://github.com/mozilla/geckodriver/releases
- https://firefox-admin-docs.mozilla.org/reference/policies/extensionsettings/
- https://mozilla.github.io/policy-templates/

**Mozilla blogs**
- https://blog.mozilla.org/addons/ (index)
- https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/
- https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/
- https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
- https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/
- Firefox DevTools / WebDriver team blog (fxdx.dev): https://fxdx.dev/firefox-webdriver-newsletter-137/ , https://fxdx.dev/firefox-webdriver-newsletter-138/ , https://fxdx.dev/firefox-webdriver-newsletter-152/ , https://fxdx.dev/cdp-retirement-in-firefox/ , https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/ . Posts are by Mozilla WebDriver engineers and link to Mozilla Bugzilla, but the site does not explicitly say it is Mozilla-run. Version claims are cross-checked against the Bugzilla target milestones above.

**W3C**
- https://w3c.github.io/webdriver-bidi/ and https://github.com/w3c/webdriver-bidi/blob/main/index.bs

**Puppeteer / Playwright / Selenium**
- https://pptr.dev/webdriver-bidi , https://pptr.dev/guides/chrome-extensions
- https://github.com/puppeteer/puppeteer (packages/puppeteer-core/CHANGELOG.md, src/bidi/*, src/node/*)
- https://playwright.dev/docs/chrome-extensions , https://playwright.dev/docs/browsers
- https://github.com/microsoft/playwright/issues/7297 , /36728 ; packages/playwright-core/src/server/registry/index.ts
- https://github.com/microsoft/playwright-mcp/blob/main/README.md
- https://github.com/SeleniumHQ/selenium (py/selenium/webdriver/{firefox,remote}/webdriver.py at selenium-4.51.0 and trunk; javascript/selenium-webdriver/firefox.js)

**MCP / testing libs**
- https://github.com/mozilla/firefox-devtools-mcp (README.md, docs/tools.md, releases)
- https://github.com/mozilla/webextension-polyfill
- https://github.com/wxt-dev/wxt/blob/main/docs/guide/essentials/unit-testing.md
- https://github.com/acvetkov/sinon-chrome , https://github.com/clarkbw/jest-webextension-mock , https://github.com/stoically/webextensions-api-fake
