import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedSubtitleUrl,
  isPrimePlayerUrl,
  looksLikeSubtitleResponse,
  sanitizeCard
} from "../extension/src/validation.js";

test("recognizes only supported Prime player routes", () => {
  assert.equal(isPrimePlayerUrl("https://www.primevideo.com/detail/Example/0ABC"), true);
  assert.equal(isPrimePlayerUrl("https://www.primevideo.com/region/eu/detail/0ABC"), true);
  assert.equal(isPrimePlayerUrl("https://www.amazon.de/gp/video/detail/B000"), true);
  assert.equal(isPrimePlayerUrl("https://www.amazon.de/gp/cart/view.html"), false);
  assert.equal(isPrimePlayerUrl("https://amazon.de.evil.example/gp/video/detail/B000"), false);
});

test("allows only the expected HTTPS subtitle hosts", () => {
  assert.equal(isAllowedSubtitleUrl("https://cf-timedtext.aux.pv-cdn.net/a/title.ttml2"), true);
  assert.equal(isAllowedSubtitleUrl("http://cf-timedtext.aux.pv-cdn.net/a/title.ttml2"), false);
  assert.equal(isAllowedSubtitleUrl("https://pv-cdn.net.evil.example/title.ttml2"), false);
});

test("validates subtitle response shape", () => {
  assert.equal(looksLikeSubtitleResponse("https://example/title.ttml2", "application/octet-stream"), true);
  assert.equal(looksLikeSubtitleResponse("https://example/no-extension", "application/ttml+xml; charset=utf-8"), true);
  assert.equal(looksLikeSubtitleResponse("https://example/error", "text/html"), false);
});

test("sanitizes and size-limits vocabulary cards", () => {
  const card = sanitizeCard({
    word: " Häuser ",
    lemma: "Haus",
    definitions: ["plural or dative form", "building"],
    languageCode: "DE<script>",
    sentence: "Die Häuser sind alt."
  });
  assert.equal(card.word, "Häuser");
  assert.equal(card.languageCode, "und");
  assert.deepEqual(card.definitions, ["plural or dative form", "building"]);
  assert.throws(() => sanitizeCard({ word: "x".repeat(121) }), /too long/);
});

test("keeps a Prime deep link but drops anything a corrupted entry could abuse", () => {
  const primeUrl = "https://www.primevideo.com/detail/Example/0ABC";
  assert.equal(sanitizeCard({ word: "x", sourceUrl: primeUrl }).sourceUrl, primeUrl, "a real Prime title URL is preserved");
  assert.equal(
    sanitizeCard({ word: "x", sourceUrl: "https://evil.example/phish" }).sourceUrl,
    "",
    "a non-Prime https URL is dropped, since this drives chrome.tabs.create"
  );
  assert.equal(
    sanitizeCard({ word: "x", sourceUrl: "javascript:alert(1)" }).sourceUrl,
    "",
    "a non-https scheme is dropped"
  );
  assert.equal(
    sanitizeCard({ word: "x", sourceUrl: `${primeUrl}?${"a".repeat(2100)}` }).sourceUrl,
    "",
    "an overlong value is dropped rather than throwing and blocking the whole card"
  );
});

test("clamps sourceTimeSeconds instead of trusting an arbitrary stored number", () => {
  assert.equal(sanitizeCard({ word: "x", sourceTimeSeconds: 187.4 }).sourceTimeSeconds, 187.4);
  assert.equal(sanitizeCard({ word: "x", sourceTimeSeconds: -5 }).sourceTimeSeconds, 0);
  assert.equal(sanitizeCard({ word: "x", sourceTimeSeconds: 999999 }).sourceTimeSeconds, 36000);
  assert.equal(sanitizeCard({ word: "x", sourceTimeSeconds: "not-a-number" }).sourceTimeSeconds, 0);
  assert.equal(sanitizeCard({ word: "x" }).sourceTimeSeconds, 0, "absent defaults to 0");
});
