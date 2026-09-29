# Feature research: where GlossLine goes after the MVP

**Research date:** 2026-08-09
**Companion to:** [PRODUCT_RESEARCH.md](PRODUCT_RESEARCH.md) (2026-08-08), which established positioning and the competitive field. This document does not repeat that analysis. It answers a narrower question: *given what is now built, which features are worth building next?*

Claims about competitors reflect public documentation and store listings at the research date and change frequently.

## Executive conclusion

One technical finding reshapes the roadmap: **media-rich cards containing video screenshots or show audio are not achievable on Prime Video**, and no amount of engineering changes that (see [The DRM ceiling](#the-drm-ceiling)). That is the single most prominent feature of the benchmark card-builders, and it is permanently out of reach for any DRM streaming source.

This is clarifying rather than limiting. It means GlossLine cannot win by imitating Migaku, and should instead compete on three axes that DRM does not touch:

1. **Anki as a live data source, not just a destination.** Every competitor treats Anki as an export target. GlossLine already holds an authenticated loopback bridge to the user's collection, and can *read* it to drive a known-word model, i+1 sentence detection, and comprehension stats. This is the strongest available differentiator and it reuses infrastructure that already exists.
2. **Reliability as a feature.** The dominant user complaint in this category is breakage, not missing features. A visible health report and a fixture-tested adapter address the thing users actually abandon products over.
3. **German-first linguistic depth.** Separable verbs, compounds, and phrase selection are areas where the market leader is explicitly weak.

## The DRM ceiling

Prime Video is protected by Widevine through Encrypted Media Extensions. EME-protected frames live in a separate buffer that the Canvas API cannot read; `drawImage` on such a video yields a black frame, and the same protection applies to `chrome.tabCapture` and OS-level capture. This is [documented behaviour in the W3C canvas discussions](https://lists.w3.org/Archives/Public/public-canvas-api/2014JanMar/0045.html) and [consistent across every browser and DRM system](https://www.screenify.studio/blog/2026-04-23-record-drm-protected-content).

Consequences, which should be treated as settled rather than revisited:

- **Screenshots on cards: not possible.** Any technique that produced one would be a DRM circumvention, violating the project's stated boundary, the Chrome Web Store policy, and likely the DMCA.
- **Show audio on cards: not possible**, for the same reason.
- **The legitimate substitute already shipped.** Cards now carry Wiktionary pronunciation audio and IPA fetched from Kaikki. That is real pronunciation media, sourced legally, and it closes most of the practical gap for a *comprehension* card.

Competitors that do ship screenshots are doing so on sources where they can, and their Prime support is correspondingly weak or absent. Do not benchmark against that capability.

## Where the MVP actually stands

Verified against the current source, not the roadmap text.

| Roadmap item | Status |
| --- | --- |
| P0 dual subtitles, tokenization, dictionary, save, Anki, TSV, active-watching controls | Built |
| Pronunciation audio + IPA on cards | Built (2026-08-09, beyond the original P0) |
| Sense capping, word highlighting, night-mode-safe card | Built (2026-08-09) |
| Transcript sidebar | Not started |
| Known / learning / unknown colouring | Not started |
| Frequency and CEFR metadata | Not started |
| Phrase and separable-verb selection | Not started |
| Sense selection before saving | Not started |
| Health/diagnostic report | Not started |
| Multi-anchor drift correction | Not started (linear offset only) |
| Shadowing and pronunciation practice | Not started |

## Recommended features

Ordered by expected value per unit of effort. Effort is relative to this codebase, which is dependency-free and already owns tokenization, cue arrays, and the Anki bridge.

### Tier 1 — build these next

**1. Known-word model sourced from Anki.** *(Medium effort, highest differentiation.)*
Query the user's collection over the existing bridge and classify every subtitle token as unknown, learning, or known. `findNotes` and `notesInfo` retrieve the lemmas already captured; `findCards` with `getIntervals` gives maturity, and Anki's own convention treats an interval of 21 days or more as mature. Cache the result per title and refresh on demand, since a collection scan is too slow for per-cue work.

This inverts the usual relationship with Anki and is only cheap because the loopback bridge, the permission flow, and the lemma field already exist. asbplayer does something similar; no Prime-first tool does.

**2. i+1 sentence detection.** *(Small effort once #1 exists, very high learning value.)*
Sentence mining's core principle is to mine lines containing exactly one unknown item — [capture the full sentence, pause only when it has one useful unknown word](https://subsmith.app/blog/sentence-mining-guide). With a known-word model and the existing tokenizer, GlossLine can mark those cues in the overlay and let the user jump between them. This converts passive watching into targeted mining and is the feature most likely to make the product feel materially smarter than a dictionary overlay.

**3. Health and diagnostics report.** *(Small effort, addresses the top abandonment cause.)*
Store reviews across this category describe extensions that work on one title and not the next, with duplicated or missing subtitle layers; one user summarised a leading Prime tool as buggy but still better than the alternatives. A copyable, non-sensitive report — adapter version, domain, video found, track count and formats, last parser error — turns an unreproducible complaint into a fixable bug. Pair it with captured JSON/TTML fixtures and a canary test, per P1.

**4. Sense selection before saving.** *(Small effort, large card-quality gain.)*
Cards currently carry up to four glosses because the correct one is unknown at save time. Letting the user pick the sense that matches the sentence produces atomic cards, which is [the consensus guidance for language cards](https://www.lingomoto.com/posts/best-anki-settings-language-learning). This is a popover interaction change plus a narrowing of the `definitions` array.

### Tier 2 — strong, once the foundation is in

**5. Condensed playback and auto-pause at cue boundaries.** *(Medium effort, no legal exposure.)*
Skip or fast-forward unsubtitled stretches, and optionally pause at the end of each cue. asbplayer ships all three and they are among its most-cited features; no Prime-first competitor has them. Pure client-side video control over cue arrays already held in memory.

**6. Transcript sidebar with click-to-seek.** *(Medium effort.)*
Built only from in-memory tracks, with no bulk export, this stays inside the stated product boundary while delivering a heavily requested navigation feature.

**7. Phrase and separable-verb selection.** *(Medium effort, targets a named competitor weakness.)*
Language Reactor [cannot select multi-word units](https://lingokeep.com/blog/language-reactor-vs-trancy-vs-migaku), only single words or whole sentences. German makes this especially costly: `spricht … an` is one lexical item split across a clause. Drag-selection across existing tokens is straightforward; the real work is multi-word lookup against Kaikki.

**8. A cloze/production card template.** *(Small effort.)*
A second template on the existing note type, offered as a setting. Cloze is the standard recommendation for isolating a target item within a sentence.

**9. Comprehension statistics per title.** *(Small effort once #1 exists.)*
"You know 94% of the words in this episode" helps users choose content at the right level — the hardest problem in immersion learning, and one that follows almost free from the known-word model.

### Tier 3 — worthwhile later

**10. Frequency and CEFR metadata.** Migaku's dictionaries are frequency-aware; frequency answers "is this word worth a card?" and sharpens i+1 scoring. Requires shipping or fetching a compact per-language list — a real data-size decision, not just code.

**11. Multi-anchor drift correction.** Currently linear ±5s. Two-anchor correction fixes edition and ad-break mismatches that linear offset cannot.

**12. Shadowing with user-recorded audio.** Trancy ships pronunciation scoring. Recording the *user's* microphone carries none of the DRM problems above. Treat scoring as a later, possibly paid, layer.

**13. Offline dictionary pack.** A compact indexed local Kaikki subset would serve the privacy-first positioning and the sub-250ms latency target, at the cost of a large download.

## Deliberately not recommended

- **Screenshots or show audio on cards.** See [The DRM ceiling](#the-drm-ceiling). Settled.
- **Subtitle downloading or transcript export.** Several competitors offer it; it sits outside the stated boundary and invites exactly the store and terms review the project is trying to avoid.
- **Broad multi-service expansion (Netflix, Disney+, YouTube).** Tempting, but the entire thesis is Prime-first reliability, and the field is full of tools that support many services badly. Revisit only once the Prime adapter is demonstrably stable across the 30-title/3-region matrix.
- **A built-in SRS.** Migaku and Trancy both ship one; Trancy's is [criticised as a shallow loop without real scheduling](https://lingokeep.com/blog/language-reactor-vs-trancy-vs-migaku). Anki with FSRS is better than anything worth building here, and "best Anki citizen in the category" is a clearer position than "another mediocre SRS".

## Open questions

1. **Word-level or context-level cards?** Still unresolved from the card work. It determines whether `StableId` or `Surface` leads the note type, and whether a repeated word appends a sentence or creates a second card.
2. **How much dictionary data ships locally?** Gates the frequency, CEFR, and offline items.
3. **Does the known-word model read the whole collection or only the GlossLine deck?** Whole-collection is far more accurate and is what makes i+1 trustworthy, but it means reading notes the extension did not create — a privacy posture worth stating explicitly in the README before shipping.

## Sources

- [Language Reactor vs Trancy vs Migaku (2026), LingoKeep](https://lingokeep.com/blog/language-reactor-vs-trancy-vs-migaku)
- [asbplayer repository](https://github.com/asbplayer/asbplayer)
- [Sentence mining guide, SubSmith](https://subsmith.app/blog/sentence-mining-guide)
- [Best Anki settings for language learning (FSRS, 2026), Lingomoto](https://www.lingomoto.com/posts/best-anki-settings-language-learning)
- [Recording DRM-protected content, Screenify](https://www.screenify.studio/blog/2026-04-23-record-drm-protected-content)
- [W3C public-canvas-api: EME-protected video and drawImage](https://lists.w3.org/Archives/Public/public-canvas-api/2014JanMar/0045.html)
- [Subtitles for Language Learning (Prime Video), Chrome Web Store](https://chromewebstore.google.com/detail/subtitles-for-language-le/hlofmmmlhfelbfhcpapoackkglljfcnb)
