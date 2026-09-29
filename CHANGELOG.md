# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html), and the version in `extension/manifest.json` is the release version.

## [Unreleased]

## [0.3.0] - 2026-09-29

### Added

- Repository packaging for publication: GitHub Actions CI (checks and tests on Node 20/22/24), a tag-driven release workflow that attaches the store zip, and a GitHub Pages landing page under `site/`.
- Generated toolbar and store icons at 16/32/48/128 px, produced by `scripts/generate-icons.js` and verified in CI.
- `npm run package`, which builds `dist/lingodeck-<version>.zip` with no third-party dependency.
- Contribution, security, and privacy documentation.

### Changed

- Everything that ships to the browser now lives in `extension/`. Load unpacked from that directory instead of the repository root.
- `npm run check` additionally verifies that the manifest declares the required icons and that `package.json` and the manifest carry the same version.
- Renamed the project from LexiCue to **LingoDeck**, including the GitHub repository (now `mobashirrahman/lingodeck`). If you tested an earlier LexiCue build against a real Anki collection, note that this changes several identifiers baked into Anki: the note type (`LexiCue Context v2` → `LingoDeck Context v2`), the default deck name (`LexiCue` → `LingoDeck`), the `lexicue` tag (→ `lingodeck`), and the `StableId` prefix (`lexicue-v1-` → `lingodeck-v1-`). Reinstalling will create new notes alongside any old ones rather than updating them in place; delete the old note type/deck manually if you don't want to keep both.

### Fixed

- Prime Video cold-start capture no longer treats DASH manifests and other generic-XML sidecars as subtitles. Each junk capture failed parsing downstream and burned the per-load capture budget before the real tracks arrived, so dual subtitles stayed missing until a reload. `page-hook.js` now excludes `.mpd`/DASH responses, only accepts XML media types with a subtitle extension or TTML type, and drops bodies without subtitle timing markers.

## [0.2.2] - 2026-08-09

### Added

- Dictation mode (`Alt`+`D`): conceals each line after it plays, accepts what you typed, and reveals a word-by-word diff.
- Adaptive playback speed that eases lines containing words you saved as hard.
- Lapse rescue in the Words tab, listing Anki cards rated "Again" with a jump back to the scene.

## [0.1.0]

### Added

- Initial MVP: Prime Video track discovery with TTML/TTML2 parsing, DOM and file-import fallbacks, the dual-subtitle Shadow DOM overlay, click-to-define lookups from Kaikki, local vocabulary with sentence context, AnkiConnect cards with merge-on-repeat, and TSV export.
