# Contributing to LexiCue

Thanks for looking at the project. LexiCue is a dependency-free Manifest V3 extension, so the setup is short.

## Getting started

```bash
git clone https://github.com/mobashirrahman/lexicue-dual-subtitles.git
cd lexicue-dual-subtitles
npm run verify
```

There is nothing to install: the extension and its tooling use only Node's standard library and browser-native APIs. Node 20 or newer is required.

Load your working copy in the browser with `chrome://extensions` → **Developer mode** → **Load unpacked** → select the `extension/` directory. After changing `content.js` or `page-hook.js`, reload the extension and refresh the Prime Video tab.

You can exercise most of the UI without a Prime Video session: open the popup and choose **Setup → Open the built-in demo**.

## Repository layout

| Path | What lives there |
| --- | --- |
| `extension/` | Everything that ships to the browser. This directory is the unpacked extension. |
| `extension/src/` | Dependency-free core logic imported by the service worker and popup. |
| `test/` | `node:test` suites that import directly from `extension/src/`. |
| `scripts/` | Repository tooling: manifest checks, icon generation, zip packaging. |
| `site/` | The GitHub Pages landing page. |
| `docs/` | Product and feature research notes. |

## Before opening a pull request

```bash
npm run verify   # manifest/permission checks plus the full test suite
npm run package  # optional: confirm the store zip still builds
```

CI runs the same commands on Node 20, 22, and 24, and additionally regenerates the icons to confirm the committed PNGs still match `scripts/generate-icons.js`. If you change the artwork, run `npm run icons` and commit the result.

## Things to keep in mind

- **Keep host permissions narrow.** `scripts/check-extension.js` rejects `<all_urls>` and content scripts scoped to all of Amazon. New hosts should be added only after they have been validated against a real playback session.
- **Treat page-world messages as untrusted.** `page-hook.js` runs in the page's MAIN world; everything it sends is revalidated in `content.js` and again in `background.js`.
- **Do not widen what leaves the browser.** The extension must not touch video bytes, DRM traffic, cookies, or auth tokens, and must not bulk-export subtitles. See [PRIVACY.md](PRIVACY.md) for the boundaries a change should not cross.
- **`content.js` cannot import from `extension/src/`** because it is a classic content script. The word-diff logic is therefore duplicated there, and `test/dictation.test.js` asserts that the copy has not drifted. Update both sides together.
- **Bump versions in pairs.** `extension/manifest.json` and `package.json` must carry the same version; `npm run check` fails otherwise.

## Releasing

1. Bump the version in `extension/manifest.json` and `package.json`.
2. Add a `CHANGELOG.md` entry.
3. Merge to `main`, then tag: `git tag v0.2.3 && git push origin v0.2.3`.

The release workflow verifies that the tag matches the manifest version, runs the checks, builds `dist/lexicue-dual-subtitles-<version>.zip`, and attaches it to a generated GitHub release.
