import test from "node:test";
import assert from "node:assert/strict";
import { buildKaikkiUrl, normalizeLookupWord, parseKaikkiJsonl } from "../extension/src/dictionary.js";

test("normalizes clicked punctuation without damaging German letters", () => {
  assert.equal(normalizeLookupWord("„Häusern!“"), "Häusern");
  assert.equal(normalizeLookupWord("  geht's  "), "geht's");
});

test("builds the Kaikki per-word JSONL URL", () => {
  assert.equal(
    buildKaikkiUrl("Haus", "de"),
    "https://kaikki.org/dictionary/German/meaning/H/Ha/Haus.jsonl"
  );
  assert.equal(buildKaikkiUrl("word", "xx"), null);
});

test("parses structured morphology, senses, examples, and audio", () => {
  const source = JSON.stringify({
    word: "Häusern",
    lang: "German",
    lang_code: "de",
    pos: "noun",
    head_templates: [{ expansion: "Häusern (dative plural)" }],
    sounds: [{ ipa: "[ˈhɔʏ̯zɐn]" }, { mp3_url: "https://example.test/haus.mp3" }],
    senses: [
      {
        glosses: ["dative plural of Haus"],
        tags: ["dative", "plural"],
        form_of: [{ word: "Haus" }],
        examples: [{ text: "In diesen Häusern.", english: "In these houses." }]
      }
    ]
  });
  const result = parseKaikkiJsonl(source, "Häusern", "de");
  assert.equal(result.word, "Häusern");
  assert.equal(result.entries[0].formOf, "Haus");
  assert.equal(result.entries[0].ipa, "[ˈhɔʏ̯zɐn]");
  assert.equal(result.entries[0].definitions[0].examples[0].translation, "In these houses.");
});
