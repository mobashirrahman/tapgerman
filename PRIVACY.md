# Privacy policy

GlossLine is an open-source browser extension. It has no accounts, no analytics, no telemetry, and no server operated by the project.

Last updated: 2026-08-09.

## What GlossLine stores

All of the following stays in your browser's extension storage on your own machine:

- **Settings** — language and track choices, overlay size and position, and feature toggles.
- **Saved vocabulary** — only words you explicitly save. Each entry keeps the word, the subtitle sentence it came from, the native-language line, the title, a deep link back to the scene, and a timestamp.
- **A bounded translation cache** — SHA-256-keyed, size-limited, and expiring. It exists only when translation fallback is enabled.
- **Optional API keys** — a LibreTranslate key and an AnkiConnect key, if you enter them. These are stored in extension-**local** storage, are excluded from browser sync, and are never included in the settings sent to a Prime Video content tab.

Subtitle tracks are held in tab memory only and are discarded when you change title or episode. No full subtitle track is ever persisted.

## What leaves your browser

Nothing leaves your browser unless a feature you used requires it:

| Destination | What is sent | When |
| --- | --- | --- |
| `kaikki.org` | The single word you clicked | Every dictionary lookup |
| `127.0.0.1:8765` (AnkiConnect) | The card you chose to send, and your AnkiConnect key if set | Only when you test the connection or send a card |
| `api.mymemory.translated.net` | One subtitle sentence | Only if you enable translation fallback and no lower subtitle track is available |
| LibreTranslate (hosted or self-hosted) | One subtitle sentence | Same as above, if you select LibreTranslate |

Translation is **off by default**. AnkiConnect traffic goes to your own machine over loopback and never to a third party.

## What GlossLine never does

- It does not read or inspect video or audio bytes, Widevine/CDM traffic, or licence requests.
- It does not read cookies, authentication tokens, or account details.
- It does not bulk-export Prime Video subtitles or transcripts.
- It does not track which titles you watch, send usage data anywhere, or contain advertising or third-party trackers.
- It does not sell or share data, because it does not collect any.

## Your control over the data

Everything is local, so you hold it: use **Words → Export TSV** to take your vocabulary with you, delete individual entries in the Words tab, or remove the extension to delete all stored data.

## Third-party services

Requests you trigger are subject to the privacy practices of the service that receives them — [Kaikki/Wiktionary](https://kaikki.org/), [MyMemory](https://mymemory.translated.net/doc/), or the LibreTranslate instance you point at. AnkiConnect runs locally on your own computer.

## Questions

Open an issue at https://github.com/mobashirrahman/glossline/issues.
