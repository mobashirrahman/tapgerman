import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const extensionRoot = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", extensionRoot), "utf8"));
const referenced = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])])
]);

for (const file of [...referenced].filter(Boolean)) {
  await access(new URL(file, extensionRoot), constants.R_OK);
}

if (manifest.manifest_version !== 3) throw new Error("The extension must use Manifest V3.");
if (Number.parseInt(manifest.minimum_chrome_version, 10) < 111) {
  throw new Error("MAIN-world static content scripts require Chromium 111 or newer.");
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Use a three-part extension version.");
if (manifest.permissions?.includes("<all_urls>")) throw new Error("<all_urls> must not be requested as an API permission.");
if (manifest.host_permissions?.includes("<all_urls>")) throw new Error("LingoDeck must keep host permissions narrow.");
for (const entry of manifest.content_scripts || []) {
  if ((entry.matches || []).some((pattern) => /amazon\.[^/]+\/\*$/.test(pattern))) {
    throw new Error("Content scripts must be scoped to Prime Video player routes, not every Amazon page.");
  }
}

// The Chrome Web Store requires a 128px icon, and the toolbar renders badly without a 16px one.
for (const size of ["16", "48", "128"]) {
  if (!manifest.icons?.[size]) throw new Error(`manifest.icons is missing the ${size}px icon.`);
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (packageJson.version !== manifest.version) {
  throw new Error(
    `package.json version ${packageJson.version} does not match manifest version ${manifest.version}.`
  );
}

console.log(
  `Extension check passed: ${referenced.size} referenced files, ${manifest.host_permissions.length} host patterns, version ${manifest.version}.`
);
