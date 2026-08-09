# Product research: Prime Video dual-subtitle language learning

**Research date:** 2026-08-08  
**Initial user:** an English speaker learning German on desktop Chromium  
**Recommended positioning:** the dependable, open-source, Prime-first path from a subtitle word to a high-quality Anki card.

Store counts, ratings, prices, and supported services can change after the research date. Product claims below come from official sites, current Chrome Web Store listings, official documentation, and public source repositories unless stated otherwise.

## Executive conclusion

The category is active, so dual subtitles alone are not a defensible product. The best opening is the intersection that existing tools do not clearly own:

1. **Prime-first reliability** across Prime/Amazon regions, fullscreen, SPA navigation, and player updates.
2. **A structured German dictionary**, not a one-word machine translation: clicked surface form, lemma, POS, gender/plural or verb morphology, IPA, concise English senses, and examples.
3. **Excellent Anki capture** with editable, contextual cards and a universal TSV fallback.
4. **Trustworthy open-source behavior** with narrow permissions, explicit data flows, and no DRM/license interaction or inspection of video/audio bytes.

Two major reference products, [Language Reactor](https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm) and [Migaku](https://migaku.com/download), set the interaction benchmark but their current official support does not center Prime Video. That creates room for a focused product, but only if it is materially more reliable than today's Prime-specific extensions.

## Current market

| Product | Prime Video | Notable features | Anki / review | Source posture | Takeaway |
| --- | --- | --- | --- | --- | --- |
| [Subtitles for Language Learning (Prime Video)](https://chromewebstore.google.com/detail/subtitles-for-language-le/hlofmmmlhfelbfhcpapoackkglljfcnb) | Prime-first | Multiple subtitles, dictionary, custom/OpenSubtitles files, translation, transcript and playback controls | Learning workflow, but recurring review/changelog signals of breakage after Prime changes | Closed | Largest direct validation of demand; reliability is the main opening. |
| [Funlingo](https://www.getfunlingo.com/) | Yes | Dual subtitles, contextual inline meanings, hover-to-pause, pronunciation, vocabulary/SRS | Built-in learning loop | Closed; free at research time | A clean free experience raises the baseline; core dual subtitles should be free. |
| [InterSub](https://chromewebstore.google.com/detail/subtitle-translator-ai-di/hhbnckjhjihjangdepdebbnooibiphge) | Yes | Lemmatization, POS, collocations, frequency, pronunciation, AI translation/chat, wordbook | Export/sync features | Closed, freemium | Strongest dictionary reference; structured non-AI lookup can be our open core. |
| [SubText](https://subtext.site/) | Yes | Official/machine/AI subtitle modes, phrases/collocations, follow-along, saved library, quizzes | Built-in study, no clear Anki-first positioning | Closed, freemium | Broad feature benchmark; avoid trying to match every service in v1. |
| [Shadowing Master](https://shadowingmaster.net/) | Prime-first | Dual subtitles, SRT import/edit, IPA/context vocabulary, title-language badges, voice A/B shadowing, AI coach | Saved vocabulary | Closed, subscription | Track-availability discovery and shadowing are good later differentiators. |
| [Prime Video Dual Subtitles](https://chromewebstore.google.com/detail/prime-video-dual-subtitle/cabhpipjdhilidbmghclbffddaddicfh) | Prime-first | Bilingual overlay, translation, style/position and subtitle download | No deep dictionary/Anki path | Closed | Confirms demand for styling and customization; downloading is outside our product boundary. |
| [Amazon Prime Subtitles & Dictionary](https://chromewebstore.google.com/detail/amazon-prime-subtitles-di/ipnohkolmjlocedopkiiebabnfjnkjeb) | Prime-first | Dual/third line, hover dictionary, pause, saved words/transcript, claimed Anki path | Current rating/reviews show reliability issues | Closed/beta | The desired bundle is validated, but execution quality matters more than feature count. |
| [GlotDojo](https://chromewebstore.google.com/detail/glot-extension/dbnjpielondlkmdjbembloegkaabfakc) | Yes | Dual subtitles, instant definitions, auto-pause, blur mode, playback controls and shortcuts | Broad learning toolkit | Closed/freemium | An established multi-service Prime competitor; matching its basic active-watching controls is table stakes. |
| [Double Subtitles](https://chromewebstore.google.com/detail/double-subtitles/cpnlpffdpcpoabpahdgfnecgngapjibn) | Yes | Dual subtitles with direct Anki/Quizlet export | Direct export, but very small current adoption | Closed | The exact dual-subtitle/export bundle exists, but no mature product clearly owns it. |
| [Language Reactor](https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm) | Not currently advertised | Dual subtitles, popup dictionary, transcript and precise playback controls | Mature study experience | Closed/freemium | Interaction benchmark, not a Prime implementation base. |
| [Migaku](https://chromewebstore.google.com/detail/migaku-really-learn-langu/lkhiljgmbeecmljiogckofcalncmfnfo) | Not in current official service list | Known-word model, subtitle browser, one-click media-rich cards | Strong Anki/export workflow | Closed/subscription | Best card-building benchmark; rich media needs a careful Prime policy boundary. |

Other and newly launched products such as [DualView](https://dualview.app/en), [Sabi](https://www.joinsabi.com/), [Dual Subs](https://dualsub.dev/), and [PrimeVocab](https://addons.mozilla.org/en-US/firefox/addon/primevocab-dual-subtitle/) show continued activity in 2026. Their convergence on clickable words, saved vocabulary, quizzes, pause/replay, and multiple streaming services confirms that these are expected category features rather than unique differentiators.

## Open-source products and components

### Suitable references

- [asbplayer](https://github.com/asbplayer/asbplayer) (MIT) is the strongest open reference for subtitle navigation, external subtitle files, known-word annotations, AnkiConnect, and media-rich cards over HTML video. Its current Prime adapter also demonstrates that the browser's playback response exposes a `timedTextUrls.result.subtitleUrls` list. Reuse requires normal MIT attribution and a careful dependency/architecture review.
- [EasySubs](https://github.com/Nitrino/easysubs) (MIT) is a useful reference for hover lookup, full-line translation, SRT/VTT loading, transcript navigation, offset controls, and Anki export.
- [Yomitan](https://github.com/yomidevs/yomitan) and [AnkiConnect](https://github.com/FooSoft/anki-connect) prove that a fast popup dictionary and local Anki bridge are familiar, durable language-learning patterns.
- [Subtitles Anywhere](https://github.com/PaulRosset/subtitles-anywhere-web) (MIT) demonstrates a service-agnostic local SRT/VTT/SAMI/TTML overlay.

### Inspect, but do not copy

- [Traditou](https://github.com/chuyunshen/traditou) is a small source-visible Prime dual-subtitle implementation that observes TTML2 resources. It has no visible repository license, so its code should not be copied. It is useful only as evidence that Prime timed-text capture is feasible.
- Small 2026 prototypes often claim broad streaming/local-AI coverage without a license, test matrix, or established maintenance record. Treat these as product signals, not foundations.

### Open data/services

- [Kaikki](https://kaikki.org/dictionary/German/) publishes machine-readable Wiktionary extracts. Its German dataset has English glosses and includes forms, lemma relations, POS, morphology, examples, IPA, and audio metadata—the right shape for this product. The full dataset is around 1 GB, so a production system should build a compact indexed service or an optional downloaded local pack rather than bundle the raw archive.
- [Wiktextract](https://github.com/tatuylonen/wiktextract) is the extraction software. Its code license and the extracted Wiktionary content license are separate; [Wiktionary text is CC BY-SA/GFDL](https://en.wiktionary.org/wiki/Wiktionary:Copyrights), so runtime attribution and data licensing must remain explicit.
- [LibreTranslate](https://docs.libretranslate.com/) is an AGPL, self-hostable machine-translation service powered by Argos Translate. It is a sensible fallback for full subtitle lines, not a substitute for structured dictionary senses.
- [MyMemory's API](https://mymemory.translated.net/doc/spec.php) provides a ready-to-use translation-memory/machine-translation fallback with published request limits and terms. It gives the MVP an easy path, but self-hosted LibreTranslate is the privacy-first choice.

## Product requirements

### P0: dependable learning loop

1. Detect the video, title changes, fullscreen changes, and Prime playback-resource responses without breaking page behavior.
2. Sanitize playback responses immediately: retain only track label, language, timed-text URL, and cue data. Never retain request bodies or authentication material.
3. Normalize SRT, WebVTT, and TTML into independent cue arrays. Select active cues by media time; never align translations by array index.
4. Render the target line above and native line below. Preserve punctuation; make only word-like segments interactive.
5. Provide DOM-visible subtitle and file-import fallbacks when the private Prime integration changes.
6. On word click, show surface form, lemma, POS/morphology, 2–4 short English senses, examples, pronunciation, context, attribution, and confidence/source.
7. Save a word locally, send it through AnkiConnect, and export selected vocabulary as UTF-8 TSV.
8. Add active-watching controls: optional pause on hover, conceal/reveal native line, replay and previous/next cue, font size, and position.

### P1: reliability moat

- Extract the Prime-specific logic into an adapter with captured JSON/TTML fixtures and schema diagnostics.
- Test films, episodic autoplay, ads, seeks, fullscreen, profile changes, and at least the US, UK, and German regional domains.
- Add per-track offset controls (±0.1 s and ±0.5 s), then two-anchor drift correction for mismatched subtitle editions.
- Add a non-sensitive health report users can copy into bug reports: adapter version, page domain, video found, number/language/format of tracks, and last parser error—never title history, URLs with signatures, or cookies.
- Add a canary test and rapid adapter release process because Prime UI/private schemas will change.

### P2: learning depth

- Sense selection before saving; disambiguate with the current sentence.
- Phrase selection, separable German verbs, compounds, collocations/idioms, frequency, and optional CEFR metadata.
- Transcript sidebar built only from the user's active in-memory tracks; no Prime subtitle download/export.
- Known / learning / unknown word coloring and a simple comprehension history.
- Track-availability badges on Prime title pages after validating the metadata and policy implications.
- Pronunciation/shadowing practice using user-recorded audio. Any capture of Prime audio or screenshots requires separate legal/store review.

### P3: optional paid services

- On-device or server ASR when the requested subtitle track is absent.
- Context-aware AI grammar explanations and sense ranking.
- Cross-device vocabulary sync, mobile review, and advanced pronunciation feedback.

Keep the open-source core—dual tracks, imports, structured dictionary, local vocabulary, AnkiConnect, and TSV—free. The category already has strong free competitors. A plausible paid layer is optional AI/ASR, sync, and pronunciation coaching at roughly €3–5/month, validated with users before implementation.

## Technical decision record

### Chromium extension model

Use Manifest V3 with bundled code only. Chrome documents that [content scripts run in isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), while an explicitly declared MAIN-world hook can observe page-owned APIs. The service worker performs narrowly scoped cross-origin fetches because [extension service workers can use hosts declared in `host_permissions`](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). Avoid a generic URL-fetch message: every provider and subtitle hostname must be validated.

Do not depend on `webRequest` response bodies; Chrome's [webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest) exposes request lifecycle metadata, not a general response-body stream. The safer adapter clones only the already-returned playback response and extracts subtitle metadata.

### Subtitle synchronization

Prime commonly supplies TTML/TTML2. Parsing must support clock, offset, frame, and tick time expressions plus nested spans and line breaks; the normative basis is the [W3C TTML2 Recommendation](https://www.w3.org/TR/2018/REC-ttml2-20181108/). Each track should be time-selected independently at the current media time. When an explicit pair is needed, align by greatest time-interval overlap, not cue index.

### Anki

[AnkiConnect](https://github.com/FooSoft/anki-connect) exposes a local JSON API at `127.0.0.1:8765` while Anki Desktop runs. The robust flow is popup-initiated `requestPermission` → `version` → deck/model discovery or schema validation → `canAddNotes` → `addNote`, with the configured API key only when required. [Chrome's Local Network Access guidance](https://developer.chrome.com/blog/local-network-access) means the first request must come from an explicit foreground popup action before service-worker requests. The fallback is a user-downloaded UTF-8 text file; Anki officially supports [tab/comma/semicolon-separated text imports, headers, decks, note types, tags, and HTML fields](https://docs.ankiweb.net/importing/text-files.html).

Recommended card fields:

`StableId`, `Surface`, `Lemma`, `PartOfSpeech`, `Morphology`, `Definition`, `TargetSentence`, `NativeSubtitle`, `Title`, `Timestamp`, `SourceAttribution`, `Tags`.

Use language + lemma + sense + sentence hash for duplicate detection. Do not store or attach signed subtitle URLs, cookies, full subtitle tracks, or video bytes.

## Risks and boundaries

- **Platform fragility:** Prime's playback response is private and unsupported. The adapter will need maintenance; manual subtitle import must remain first-class.
- **Catalog variability:** Prime states that subtitle/audio availability varies by title, device, and region; see [Prime Video help](https://www.primevideo.com/help?nodeId=GTWNZUHHV9WJREGX).
- **Terms/copyright/store review:** Prime's [usage rules/terms](https://www.primevideo.com/help/?csTools=p1dhvld&nodeId=G202095490) and the Chrome Web Store's [prohibited-products policy](https://developer.chrome.com/docs/webstore/program-policies/malicious-and-prohibited/) argue for a narrow learning overlay, no DRM interaction, no bulk downloading, and retention of only user-selected vocabulary context. Obtain legal review or Amazon permission before commercial distribution.
- **Dictionary licensing:** keep Kaikki/Wiktionary attribution visible on every word card and in exported data where definitions are included.
- **Privacy:** default to two native tracks or self-hosted translation. If an external translator/AI is enabled, disclose exactly what short text is sent and never send a full transcript silently.
- **Anki availability:** there is no dependable public AnkiWeb card-creation API for this use. Desktop AnkiConnect plus TSV is the realistic design.

## Success criteria for a private beta

- ≥95% successful subtitle detection across a documented 30-title/3-region test matrix.
- <100 ms overlay timing error from the selected track after seeking.
- Dictionary panel visible within 250 ms from cache and within 1.5 s from network at p95.
- ≥70% of clicked German surface forms resolve to a useful lemma + English sense.
- ≥90% successful Anki sends while AnkiConnect is running; 100% of saved cards export to valid TSV.
- Fewer than 1% of sessions report duplicate/overlapping subtitle layers.
- A user can install, start a Prime title, click a word, and create a card in under five minutes without documentation.
