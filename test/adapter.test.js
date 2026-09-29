import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTtml } from "../extension/src/subtitles.js";

// page-hook.js runs in the MAIN world as a classic script; publishManifest is the only code
// that knows Prime's GetVodPlaybackResources response shape. If Amazon renames
// timedTextUrls.result.subtitleUrls, this is the test that must fail first — and the fix is
// publishManifest (plus these fixtures), nowhere else.
const source = await readFile(new URL("../extension/page-hook.js", import.meta.url), "utf8");

function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n {2}\\}`));
  assert.ok(match, `could not find ${name}() in page-hook.js — if it was renamed or removed, update this adapter test`);
  return new Function(`return (${match[0]})`)();
}

// The extracted closures resolve free identifiers at call time; provide exactly what the real
// IIFE scope would.
globalThis.MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
globalThis.MAX_TRACKS = 32;
globalThis.CHANNEL = "glossline-page-v1";
globalThis.location = { href: "https://www.primevideo.com/detail/EXAMPLE/?ie=UTF8" };
globalThis.playbackIdFromUrl = extractFunction("playbackIdFromUrl");
const publishManifest = extractFunction("publishManifest");

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

function manifestResponse(subtitleUrls, extra = {}) {
  return JSON.stringify({
    // Unknown sibling fields Amazon ships alongside the tracks; extraction must survive them.
    metadata: { hasDrmStreams: true, protocol: "DVH1" },
    ...extra,
    timedTextUrls: {
      // "result" is itself wrapped by envelope fields in the real response.
      requestId: "req-123",
      result: { subtitleUrls, forceDownloadable: false }
    }
  });
}

test("extracts {label, language, url} tracks from a normal GetVodPlaybackResources response", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    manifestResponse([
      { displayName: "Deutsch [SSA]", languageCode: "de", url: "https://pv-cdn.net/a/de.ttml2", selected: false },
      { displayName: "English", languageCode: "en", url: "https://pv-cdn.net/a/en.ttml2" }
    ]),
    "page-key"
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "subtitle-manifest");
  assert.deepEqual(
    posted[0].tracks,
    [
      { label: "Deutsch [SSA]", language: "de", url: "https://pv-cdn.net/a/de.ttml2" },
      { label: "English", language: "en", url: "https://pv-cdn.net/a/en.ttml2" }
    ],
    "extraction must yield exactly label/language/url, dropping unknown per-track fields"
  );
  assert.ok(posted[0].playbackId.length > 0);
});

test("survives unknown sibling fields on every nesting level", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    manifestResponse(
      [{ displayName: "日本語", languageCode: "ja", url: "https://pv-cdn.net/ja.dfxp.zip", newField: { nested: true } }],
      { playbackAssets: { someNewStructure: [1, 2, 3] }, featureFlags: { subtitleServiceV2: true } }
    ),
    "page-key"
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].tracks.length, 1);
  assert.equal(posted[0].tracks[0].language, "ja");
});

test("non-https track URLs are dropped, and a manifest of only those publishes nothing", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    manifestResponse([
      { displayName: "Insecure", languageCode: "de", url: "http://pv-cdn.net/a/de.ttml2" },
      { displayName: "Relative", languageCode: "en", url: "/a/en.ttml2" }
    ]),
    "page-key"
  );
  assert.equal(posted.length, 0, "tracks without https: URLs must not reach the content script");
});

test("an empty subtitleUrls array publishes nothing", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    manifestResponse([]),
    "page-key"
  );
  assert.equal(posted.length, 0);
});

test("a renamed subtitleUrls field publishes nothing — this failing is the adapter's smoke alarm", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    JSON.stringify({ timedTextUrls: { result: { subtitleLinkList: [{ url: "https://pv-cdn.net/a/de.ttml2" }] } } }),
    "page-key"
  );
  assert.equal(posted.length, 0);
  // Sanity-check the negative: a manifest with the real field DOES publish, so the assertion
  // above is meaningful.
  publishManifest(
    "https://www.primevideo.com/action/GetVodPlaybackResources?asin=X",
    manifestResponse([{ languageCode: "de", url: "https://pv-cdn.net/a/de.ttml2" }]),
    "page-key"
  );
  assert.equal(posted.length, 1);
});

test("URLs without the GetVodPlaybackResources marker are ignored", () => {
  const posted = capturePostMessage();
  publishManifest(
    "https://www.primevideo.com/action/SomeOtherEndpoint",
    manifestResponse([{ languageCode: "de", url: "https://pv-cdn.net/a/de.ttml2" }]),
    "page-key"
  );
  assert.equal(posted.length, 0);
});

test("non-JSON or oversized bodies are swallowed, not thrown", () => {
  const posted = capturePostMessage();
  assert.doesNotThrow(() => publishManifest("https://www.primevideo.com/action/GetVodPlaybackResources", "<html>gateway timeout</html>", "page-key"));
  assert.doesNotThrow(() => publishManifest("https://www.primevideo.com/action/GetVodPlaybackResources", "x".repeat(4 * 1024 * 1024 + 1), "page-key"));
  assert.equal(posted.length, 0);
});

// End-to-end cue extraction: the shape a captured .ttml2 track body actually has when
// parseSubtitle (background) runs parseTtml on it. TTML2 timing attributes and nested spans
// must survive.
test("a TTML2 track body yields timed cues with merged span text", () => {
  const ttml2 = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="de" tts:frameRate="25">
  <head><metadata ttm:role="caption"/></head>
  <body>
    <div>
      <p begin="00:00:01.000" end="00:00:03.500"><span>Diese Blumen</span> wachsen hier.</p>
      <p begin="00:00:04.000" end="00:00:06.250">Ein zweiter Satz.</p>
    </div>
  </body>
</tt>`;
  const cues = parseTtml(ttml2);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].text, "Diese Blumen wachsen hier.");
  assert.equal(cues[1].start, 4);
  assert.equal(cues[1].end, 6.25);
});
