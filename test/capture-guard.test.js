import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Guards the cold-start capture budget: page-hook.js must not treat DASH manifests
// or other generic-XML sidecars as subtitles. Each junk capture fails parsing
// downstream and burns capturedBodyCount in content.js before the real tracks
// arrive, which is the cold-start-no-subtitles failure.
const source = await readFile(new URL("../extension/page-hook.js", import.meta.url), "utf8");

function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n {2}\\}`));
  assert.ok(match, `could not find ${name}() in page-hook.js — if it was renamed or removed, update this test`);
  return new Function(`return (${match[0]})`)();
}

// looksLikeSubtitle closes over the IIFE's subtitlePattern; extract the live value
// rather than hard-coding a copy that could drift from page-hook.js.
const patternMatch = source.match(/const subtitlePattern = (\/.*?\/i);/);
assert.ok(patternMatch, "could not find subtitlePattern in page-hook.js");
globalThis.subtitlePattern = eval(patternMatch[1].replace(/;$/, ""));
globalThis.MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
globalThis.CHANNEL = "lingodeck-page-v1";

const looksLikeSubtitle = extractFunction("looksLikeSubtitle");
const publish = extractFunction("publish");

function capturePostMessage() {
  const posted = [];
  globalThis.window = {
    location: { origin: "https://www.primevideo.com" },
    postMessage(message) {
      posted.push(message);
    }
  };
  return posted;
}

test("subtitle file URLs and subtitle media types are captured", () => {
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/de.ttml2?sig=x", ""), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/de.dfxp", "application/octet-stream"), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/en.vtt", ""), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/en.srt?x=1", "text/plain"), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/track", "text/vtt; charset=utf-8"), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/track", "application/ttml+xml"), true);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/track", "application/ttml"), true);
});

test("DASH manifests are never treated as subtitles", () => {
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/manifest.mpd", "application/dash+xml"), false);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/manifest.mpd?x=1", "application/xml"), false);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/track", "application/dash+xml"), false);
});

test("generic XML without a subtitle extension is not captured", () => {
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/mpd-data", "application/xml"), false);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/mpd-data", "text/xml"), false);
  assert.equal(looksLikeSubtitle("https://pv-cdn.net/a/api", "text/html"), false);
  assert.equal(looksLikeSubtitle("", ""), false);
});

test("publish drops bodies without subtitle timing markers", () => {
  const posted = capturePostMessage();
  publish("https://pv-cdn.net/a/x.vtt", '<?xml version="1.0"?>\n<MPD></MPD>', "application/xml", "k");
  publish("https://pv-cdn.net/a/x.vtt", '{"timedTextUrls":{}}', "application/json", "k");
  publish("https://pv-cdn.net/a/x.vtt", "   ", "text/vtt", "k");
  assert.equal(posted.length, 0);
});

test("publish keeps bodies with timing markers", () => {
  const posted = capturePostMessage();
  publish("https://pv-cdn.net/a/x.srt", "1\n00:00:01,000 --> 00:00:02,000\nHi", "text/plain", "k");
  publish("https://pv-cdn.net/a/x.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi", "text/vtt", "k");
  publish(
    "https://pv-cdn.net/a/x.ttml",
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">Hi</p></div></body></tt>',
    "application/xml",
    "k"
  );
  assert.equal(posted.length, 3);
  assert.equal(posted[0].type, "subtitle-resource");
});
