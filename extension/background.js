// Binds the browser APIs to the pure service in lib/service.js.
import { allowedOrigin } from "./lib/origin.js";
import { createService } from "./lib/service.js";

const service = createService({
  storage: browser.storage.local,
  fetchImpl: (url, init) => fetch(url, init),
  log: (m) => console.log(`[inspector-ext] ${m}`),
});
const patterns = browser.runtime.getManifest().host_permissions;

browser.runtime.onMessage.addListener((msg, sender) => {
  const origin = allowedOrigin(sender.url, patterns);
  if (!origin || typeof msg?.type !== "string") return undefined;
  return service.handle(msg, origin);
});

console.log("[inspector-ext] background started");
