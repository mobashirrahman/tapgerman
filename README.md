<div align="center">

<img src="extension/icons/icon-128.png" width="96" height="96" alt="">

# GlossLine Dual Subtitles

**Learn a language from what you are already watching on Prime Video.**

A clickable learning-language subtitle above your native one, structured dictionary entries in place, and one-click Anki cards that keep the sentence they came from.

[![CI](https://github.com/mobashirrahman/glossline/actions/workflows/ci.yml/badge.svg)](https://github.com/mobashirrahman/glossline/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mobashirrahman/glossline?sort=semver)](https://github.com/mobashirrahman/glossline/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-6f42c1.svg)](extension/manifest.json)
[![Dependencies: none](https://img.shields.io/badge/dependencies-none-success.svg)](package.json)

[Website](https://mobashirrahman.github.io/glossline/) · [Install](#install) · [Features](#what-works-in-this-mvp) · [Privacy](PRIVACY.md) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Brand status:** "GlossLine" replaced the earlier development codename because it collided with two existing flashcard apps ("LingoDeck: Language Flashcards" and LinguaDeck). A *gloss* is the linguistic term for an explanatory note attached to a word, which is what clicking a subtitle word produces. No trademark clearance has been performed yet, so treat the name as provisional until that search is done before any commercial launch.

GlossLine is an open-source Chromium Manifest V3 extension for language learning on Amazon Prime Video. It renders a clickable learning-language subtitle above a native-language subtitle, supplies structured dictionary entries, saves vocabulary with sentence context, and sends cards to Anki.

The initial product focus is **German → English on Prime Video**. The current UI fixes the native/lower language to English because structured dictionary glosses are English, while the subtitle, language, and dictionary adapters are intentionally general.

## What works in this MVP

- Discovers Prime Video timed-text tracks from the playback-resource response, then parses TTML/TTML2 in memory.
- Falls back to the currently visible Prime subtitle if automatic track discovery changes or is unavailable.
- Imports user-provided SRT, WebVTT, TTML, DFXP, and TTML2 files for either subtitle line.
- Renders upper/lower subtitles in a fullscreen-aware Shadow DOM overlay.
- Tokenizes the upper subtitle with `Intl.Segmenter`; every word is keyboard-focusable and clickable.
- Looks up structured, English-language definitions, lemma/form information, part of speech, noun/verb morphology, IPA, and examples from Kaikki's English Wiktionary extraction.
- Saves a local vocabulary list with the exact target sentence, native line, title, deep-linkable URL, and timestamp.
- Creates a versioned `GlossLine Context v2` note type and deck through AnkiConnect, with pronunciation audio and IPA. Saving the same word in the same sense again appends the new sentence onto the existing card instead of creating a duplicate; a genuinely different sense (a homonym) creates its own card.
- Exports all explicitly saved words as Anki-ready UTF-8 TSV.
- Supports pause-on-hover, hide/reveal native subtitles, size/position controls, replay, and previous/next cue shortcuts.
- **Lapse rescue:** the Words tab surfaces Anki cards rated "Again" recently, with a one-click jump back to the Prime Video scene each card came from.
- **Adaptive playback speed** (opt-in): eases video speed on lines containing a word you've previously saved as hard, and leaves everything else at normal speed.
- **Dictation mode** (opt-in, `Alt`+`D`): conceals each line after it plays, lets you type what you heard, then reveals a word-by-word diff.
- Offers opt-in MyMemory translation without an API key and self-hosted/hosted LibreTranslate as an open-source option; translation is off by default.

## Install

GlossLine is not on the Chrome Web Store yet, so it loads unpacked.

1. Download the zip from the [latest release](https://github.com/mobashirrahman/glossline/releases) and unzip it, or clone this repository.
2. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium 111+ browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped folder — or this repository's **`extension/`** directory.
5. Open a Prime Video title and start playback. If the page was already open when you installed the extension, refresh it once.
6. Turn on the subtitle language you want to learn. Open GlossLine from the toolbar and choose upper/lower tracks if multiple tracks were discovered.

To test without signing in to Prime Video, open the extension popup and choose **Setup → Open the built-in demo**.

### Anki setup

1. Install [Anki Desktop](https://apps.ankiweb.net/).
2. In Anki, open **Tools → Add-ons → Get Add-ons** and install AnkiConnect with code `2055492159`.
3. Restart Anki and keep it running.
4. In GlossLine, open **Setup** and choose a deck name. If you enabled `apiKey` in the AnkiConnect add-on configuration, enter the same key in GlossLine; otherwise leave the field blank.
5. Click **Test Anki connection** and approve GlossLine in the permission dialog shown by Anki. Testing is the explicit action that asks AnkiConnect to trust the extension origin.
6. Click a subtitle word and choose **Send to Anki**, or send a previously saved word from the Words tab.

The optional AnkiConnect API key is kept in local extension storage, is never synchronized, and is never returned to Prime Video content tabs. It is sent only from the extension service worker to the loopback AnkiConnect endpoint. Changing AnkiConnect's API key or trusted-origin configuration requires testing the connection again.

If AnkiConnect is unavailable, use **Words → Export TSV** and import the text file through Anki's standard import dialog.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| `Alt` + `R` | Replay the current learning-language cue |
| `Alt` + `←` / `Alt` + `→` | Previous / next captured cue |
| `Alt` + `N` | Hide or reveal the native-language line |
| `Alt` + `D` | Toggle dictation mode |
| `Esc` | Close the dictionary card |

Letter shortcuts match the physical key rather than the character it produces, so they work on macOS (where `Option`+`D` types `∂`) and on non-QWERTY layouts. A faded **Replay line** button under the subtitles does the same job as `Alt`+`R` for anyone who prefers clicking, and dictation mode adds **Listen again** and **Skip & reveal** next to its input.

## Development

The project is dependency-free and uses browser-native APIs. Node 20 or newer is the only requirement, and there is nothing to `npm install`.

```bash
npm run verify    # manifest/permission checks plus the full test suite
npm test          # node:test suites only
npm run check     # manifest, icon, and version-sync checks only
npm run icons     # regenerate extension/icons/*.png from scripts/generate-icons.js
npm run icons:check  # confirm the committed PNGs still match the generator (pixel comparison)
npm run package   # build dist/glossline-<version>.zip for the store
```

The test suite covers SRT, WebVTT, TTML timing (including frame/tick expressions), overlap alignment, dictionary parsing, URL construction, Anki authorization payloads, note identity and card-growing/merge logic, lapse queries, the dictation word-diff, and TSV/HTML safety.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the invariants a change should not break, and how releases are cut.

### Repository layout

```
extension/        Everything that ships to the browser — load unpacked from here
  src/            Dependency-free core logic (subtitles, dictionary, anki, validation)
  icons/          Generated PNGs, verified in CI against their generator
test/             node:test suites importing directly from extension/src/
scripts/          Manifest checks, icon generation, zip packaging
site/             The GitHub Pages landing page
docs/             Product and feature research notes
.github/          CI, release, and Pages workflows; issue and PR templates
```

### Architecture

- `extension/page-hook.js` runs in the page's MAIN world at `document_start`. It observes playback responses and emits only sanitized subtitle metadata or bounded timed-text bodies. It never emits request bodies, cookies, tokens, video URLs, or DRM data, and stays inert outside player routes.
- `extension/content.js` runs in Chrome's isolated world. It owns SPA/title lifecycle, the video clock, DOM fallback, two-language track selection, a closed Shadow DOM overlay, trusted user interactions, and fullscreen behavior. Page-bridge messages are treated as untrusted and rate-limited.
- `extension/background.js` is the MV3 service worker. It revalidates sender, host, redirect, response type, byte/cue limits, and card shape before parsing, networking, persistence, or Anki operations.
- `extension/src/subtitles.js`, `dictionary.js`, `anki.js`, and `validation.js` hold dependency-free core logic.
- `extension/popup.html` is the settings, status, vocabulary, import, export, and Anki UI.

### Continuous integration

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | Push and PR to `main` | Runs `npm run check` and `npm test` on Node 20/22/24, confirms the committed icons still match their generator, and uploads a packaged zip artifact |
| [`release.yml`](.github/workflows/release.yml) | Tag `v*.*.*` | Verifies the tag matches the manifest version, re-runs the checks, and publishes a GitHub release with the store zip attached |
| [`pages.yml`](.github/workflows/pages.yml) | Changes under `site/` | Deploys the landing page to GitHub Pages |

The Pages workflow needs Pages switched on once, under **Settings → Pages → Build and deployment → Source: GitHub Actions**. GitHub only offers Pages for a private repository on a paid plan, so on a free account the repository has to be public first. Until then the workflow fails with `Get Pages site failed`, and the rest of CI is unaffected.

## Privacy and product boundaries

- GlossLine does **not** inspect video/audio bytes, Widevine/CDM traffic, license requests, cookies, or authentication tokens.
- It processes only timed-text subtitle data made available to the authorized browser session.
- Subtitle tracks remain in tab memory and are cleared on a title/episode change. Persisted data is limited to settings, explicitly saved vocabulary, and a bounded, expiring, SHA-256-keyed sentence-translation cache; no full subtitle track is persisted.
- LibreTranslate and AnkiConnect API keys are stored only in extension-local storage. They are excluded from browser sync and content-tab settings responses.
- Kaikki receives the clicked word. MyMemory or LibreTranslate receives a subtitle sentence only when translation fallback is enabled and no lower track is available.
- The extension does not bulk-export Prime subtitles or transcripts.

The full policy is in [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md) describes the trust boundaries and how to report a vulnerability.

Prime's player and private playback-response shape are unsupported integration surfaces and may change. Automatic Prime capture therefore lives behind a small replaceable adapter and has a DOM/import fallback. A commercial Chrome Web Store launch should receive a focused terms, copyright, privacy, and store-policy review.

## Current limitations

- This build has automated fixtures and a demo player, but it has not been validated against the user's signed-in Prime account or every regional catalog.
- The automatic adapter currently accepts Prime/`pv-cdn.net` timed-text URLs. New CDN hosts should be added only after validation.
- Timing offsets are currently linear (±5 seconds per track); multi-anchor drift correction for edition/ad differences is still planned.
- Kaikki offers the richest current experience for German and several other Wiktionary languages. Coverage and morphology vary by language.
- Anki Desktop and AnkiConnect must be running for one-click cards. TSV is the portable fallback.

See [the dated product research](docs/PRODUCT_RESEARCH.md) for the competitor analysis, roadmap, and sources, and [the feature research](docs/FEATURE_RESEARCH.md) for what to build after the MVP.

## License

GlossLine code is MIT licensed. Runtime dictionary content comes from Kaikki/English Wiktionary under its own attribution/share-alike terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with, endorsed by, or connected to Amazon. Amazon, Prime Video, and related marks belong to their respective owners.
