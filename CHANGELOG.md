# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html), and the version in `extension/manifest.json` is the release version.

## [Unreleased]

### Added

- Repository packaging for publication: GitHub Actions CI (checks and tests on Node 20/22/24), a tag-driven release workflow that attaches the store zip, and a GitHub Pages landing page under `site/`.
- Generated toolbar and store icons at 16/32/48/128 px, produced by `scripts/generate-icons.js` and verified in CI.
- `npm run package`, which builds `dist/lexicue-dual-subtitles-<version>.zip` with no third-party dependency.
- Contribution, security, and privacy documentation.

### Changed

- Everything that ships to the browser now lives in `extension/`. Load unpacked from that directory instead of the repository root.
- `npm run check` additionally verifies that the manifest declares the required icons and that `package.json` and the manifest carry the same version.

## [0.2.2] - 2026-08-09

### Added

- Dictation mode (`Alt`+`D`): conceals each line after it plays, accepts what you typed, and reveals a word-by-word diff.
- Adaptive playback speed that eases lines containing words you saved as hard.
- Lapse rescue in the Words tab, listing Anki cards rated "Again" with a jump back to the scene.

## [0.1.0]

### Added

- Initial MVP: Prime Video track discovery with TTML/TTML2 parsing, DOM and file-import fallbacks, the dual-subtitle Shadow DOM overlay, click-to-define lookups from Kaikki, local vocabulary with sentence context, AnkiConnect cards with merge-on-repeat, and TSV export.
