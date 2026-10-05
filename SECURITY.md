# Security policy

## Supported versions

TapGerman is pre-1.0. Only the latest tagged release receives fixes.

## Reporting a vulnerability

Please report security issues privately through GitHub's [private vulnerability reporting](https://github.com/mobashirrahman/tapgerman/security/advisories/new) rather than in a public issue.

Include the extension version from `extension/manifest.json`, the browser and version, and the steps or page state needed to reproduce. A proof-of-concept page or a captured message payload is especially useful.

Expect an initial response within seven days. Because this is a volunteer-maintained project, a fix may take longer; you will be told where things stand.

## What is in scope

The extension's trust boundaries are the interesting surface:

- **`extension/page-hook.js`** runs in the page's MAIN world and shares an origin with Prime Video. Anything that makes it emit request bodies, cookies, tokens, video URLs, or DRM data is a vulnerability.
- **`extension/content.js`** treats every page-bridge message as untrusted. Bypasses of its validation, rate limits, or Shadow DOM isolation are in scope.
- **`extension/background.js`** revalidates sender, host, redirect, response type, byte and cue limits, and card shape. Anything that reaches the network, storage, or AnkiConnect without passing those checks is in scope.
- **Secret handling.** The LibreTranslate and AnkiConnect keys live in extension-local storage and must never reach a content tab, browser sync, or any host other than the configured endpoint.
- **Injection.** HTML injection into the overlay, the popup, or generated Anki cards, and TSV/CSV formula injection in exported files.

## What is out of scope

- Amazon's own site, player, or infrastructure. Report those to Amazon.
- Vulnerabilities in Anki, AnkiConnect, Kaikki, MyMemory, or LibreTranslate. Report those to their maintainers.
- Behaviour that requires the user to install a malicious extension or run attacker-supplied code in their own browser profile.
- The fact that a user's own machine can read data the user chose to save locally.
