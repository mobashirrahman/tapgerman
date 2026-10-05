import { parseSrt, parseTtml, parseWebVtt } from "./src/subtitles.js";
import { lookupWord } from "./src/dictionary.js";
import { addCardToAnki, buildAnkiStableId, getAnkiStatus, getLapsedWordStableIds } from "./src/anki.js";
import {
  isAllowedSubtitleUrl,
  isPrimePlayerUrl,
  looksLikeSubtitleResponse,
  sanitizeCard
} from "./src/validation.js";

const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
const MAX_SUBTITLE_CUES = 50_000;
const MAX_TRANSLATION_CACHE_ENTRIES = 200;
const MAX_TRANSLATION_CACHE_BYTES = 512 * 1024;
const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSLATION_CACHE_KEY = "translationCacheV2";
const NETWORK_TIMEOUT_MS = 10_000;

const DEFAULT_SETTINGS = {
  enabled: true,
  learningLanguage: "de",
  nativeLanguage: "en",
  learningTrackId: "",
  nativeTrackId: "",
  fontScale: 1,
  verticalOffset: 12,
  learningOffset: 0,
  nativeOffset: 0,
  pauseOnHover: true,
  hideNative: false,
  adaptiveSpeed: false,
  dictationMode: false,
  translationProvider: "none",
  libreTranslateEndpoint: "http://127.0.0.1:5000",
  libreTranslateApiKey: "",
  ankiDeck: "TapGerman",
  ankiApiKey: "",
  ankiApiKeyRequired: false
};
const {
  libreTranslateApiKey: _libreTranslateApiKey,
  ankiApiKey: _ankiApiKey,
  ankiApiKeyRequired: _ankiApiKeyRequired,
  ...SYNC_DEFAULT_SETTINGS
} = DEFAULT_SETTINGS;

function isSetupPage(sender) {
  try {
    return new URL(sender?.url).href === chrome.runtime.getURL("popup.html");
  } catch {
    return false;
  }
}

function isDemoPage(sender) {
  try {
    return new URL(sender?.url).href === chrome.runtime.getURL("demo.html");
  } catch {
    return false;
  }
}

function isPrimeContent(sender) {
  return Boolean(sender?.tab && (isPrimePlayerUrl(sender.tab.url) || isPrimePlayerUrl(sender.url)));
}

function isSubtitleContext(sender) {
  return isPrimeContent(sender) || isDemoPage(sender) || isSetupPage(sender);
}

function settingsForSender(settings, sender) {
  if (isSetupPage(sender)) return settings;
  const {
    libreTranslateApiKey: _libreTranslateApiKey,
    ankiApiKey: _ankiApiKey,
    ankiApiKeyRequired: _ankiApiKeyRequired,
    ...safeSettings
  } = settings;
  return safeSettings;
}

function ankiApiKeyFor(settings) {
  if (settings.ankiApiKeyRequired === null) {
    throw new Error("Test the Anki connection after changing its API key.");
  }
  if (settings.ankiApiKeyRequired && !settings.ankiApiKey) {
    throw new Error("AnkiConnect requires an API key. Enter it in Setup and test the connection again.");
  }
  return settings.ankiApiKeyRequired ? settings.ankiApiKey : "";
}

// Every read-modify-write of shared chrome.storage state (vocabulary, translation cache) runs
// through this mutex: service-worker message handlers interleave at every await, so a rapid
// Save + Send-to-Anki pair would otherwise both read the same list and one write would be lost.
let vocabMutex = Promise.resolve();
function withVocabMutex(fn) {
  const result = vocabMutex.then(fn, fn);
  vocabMutex = result.catch(() => {});
  return result;
}

// Shared by SAVE_WORD and ADD_TO_ANKI, so a card sent to Anki always has a local vocabulary
// record too — lapse rescue needs the sourceUrl/sourceTimeSeconds it carries, and the two buttons
// are independent (a card can be sent to Anki without ever clicking "Save word").
async function upsertVocabulary(card) {
  return withVocabMutex(async () => {
    const item = { ...card, id: card.id || buildAnkiStableId(card), savedAt: Date.now() };
    const stored = await chrome.storage.local.get("vocabulary");
    const vocabulary = Array.isArray(stored.vocabulary) ? stored.vocabulary : [];
    const duplicateIndex = vocabulary.findIndex((entry) => entry.id === item.id);
    if (duplicateIndex >= 0) vocabulary[duplicateIndex] = { ...vocabulary[duplicateIndex], ...item };
    else vocabulary.unshift(item);
    const bounded = vocabulary.slice(0, 2000);
    while (JSON.stringify(bounded).length > 4 * 1024 * 1024) bounded.pop();
    await chrome.storage.local.set({ vocabulary: bounded });
    return item;
  });
}

if (typeof chrome.storage.local.setAccessLevel === "function") {
  chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch((error) => console.warn("TapGerman could not restrict local storage access:", error));
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  if (value.length > maximum) throw new Error(`${label} is too long.`);
  return value;
}

function normalizeLanguageCode(value, fallback = "und") {
  const code = String(value || fallback).toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code : fallback;
}

// https://libretranslate.com is the only hosted endpoint; plain http loopback is allowed on any
// port (Docker defaults to :8000, not :5000) with an optional path for reverse proxies. Anything
// else — other hosts, https loopback, non-loopback http — stays rejected.
function isAllowedLibreTranslateEndpoint(endpoint) {
  if (endpoint === "https://libretranslate.com") return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/.test(endpoint);
}

function sanitizeSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings are invalid.");
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (["enabled", "pauseOnHover", "hideNative", "adaptiveSpeed", "dictationMode"].includes(key)) output[key] = Boolean(value);
    else if (key === "learningLanguage") output[key] = normalizeLanguageCode(value, "de");
    else if (key === "nativeLanguage") output[key] = "en";
    else if (["learningTrackId", "nativeTrackId"].includes(key)) output[key] = String(value || "").slice(0, 240);
    else if (key === "fontScale") output[key] = Math.max(0.65, Math.min(1.8, Number(value) || 1));
    else if (key === "verticalOffset") output[key] = Math.max(-80, Math.min(180, Number(value) || 0));
    else if (["learningOffset", "nativeOffset"].includes(key)) output[key] = Math.max(-5, Math.min(5, Number(value) || 0));
    else if (key === "translationProvider") {
      output[key] = ["none", "mymemory", "libretranslate"].includes(value) ? value : "none";
    } else if (key === "libreTranslateEndpoint") {
      const endpoint = String(value || "").replace(/\/$/, "");
      output[key] = isAllowedLibreTranslateEndpoint(endpoint) ? endpoint : DEFAULT_SETTINGS.libreTranslateEndpoint;
    } else if (key === "ankiDeck") {
      const deck = String(value || "").trim();
      if (!deck || deck.length > 120) throw new Error("The Anki deck name must be 1–120 characters.");
      output[key] = deck;
    } else if (["libreTranslateApiKey", "ankiApiKey"].includes(key)) {
      if (typeof value !== "string" || value.length > 500) throw new Error(`${key} must be 500 characters or fewer.`);
      output[key] = value;
    }
  }
  return output;
}

async function readResponseTextBounded(response, maximumBytes, label) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error(`${label} is unexpectedly large.`);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > maximumBytes) throw new Error(`${label} is unexpectedly large.`);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} is unexpectedly large.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchTextWithTimeout(
  url,
  options,
  maximumBytes,
  label,
  validateResponse = () => {},
  timeout = NETWORK_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    validateResponse(response);
    const text = await readResponseTextBounded(response, maximumBytes, label);
    return { response, text };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The network request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inferFormat({ filename = "", url = "", contentType = "", text = "" }) {
  const hint = `${filename} ${url} ${contentType}`.toLowerCase();
  if (/\.srt(?:\s|$|[?#])|subrip/.test(hint)) return "srt";
  if (/\.vtt(?:\s|$|[?#])|text\/vtt/.test(hint) || /^\s*WEBVTT/i.test(text)) return "vtt";
  if (/ttml|dfxp|\.xml|<tt[\s>]/i.test(`${hint} ${text.slice(0, 300)}`)) return "ttml";
  return "srt";
}

function inferLanguage(text, url = "") {
  const xmlLanguage = text.match(/(?:xml:lang|lang)=["']([a-z]{2,3}(?:-[A-Z]{2})?)["']/i)?.[1];
  if (xmlLanguage) return xmlLanguage;
  const urlLanguage = String(url).match(/(?:^|[\/_\-.])([a-z]{2}(?:-[A-Z]{2})?)(?:[\/_\-.]|$)/)?.[1];
  return urlLanguage || "und";
}

function parseSubtitle(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Subtitle payload is invalid.");
  const text = boundedText(payload.text, MAX_SUBTITLE_BYTES, "Subtitle data");
  const sanitized = {
    text,
    filename: String(payload.filename || "").slice(0, 240),
    url: String(payload.url || "").slice(0, 4096),
    contentType: String(payload.contentType || "").slice(0, 160)
  };
  const format = inferFormat(sanitized);
  const cues = format === "ttml" ? parseTtml(text) : format === "vtt" ? parseWebVtt(text) : parseSrt(text);
  if (!cues.length) throw new Error(`No timed cues were found in this ${format.toUpperCase()} file.`);
  if (cues.length > MAX_SUBTITLE_CUES) throw new Error("Subtitle file contains too many cues.");
  const language = normalizeLanguageCode(payload.language || inferLanguage(text, sanitized.url));
  const label = String(payload.label || `${language === "und" ? "Unknown language" : language} · ${format.toUpperCase()}`).slice(0, 120);
  return {
    id: String(payload.id || `${language}:${format}:${hashString(sanitized.url || sanitized.filename || text.slice(0, 200))}`).slice(0, 240),
    label,
    language,
    format,
    source: ["page", "import", "prime-manifest", "capture"].includes(payload.source) ? payload.source : "capture",
    url: sanitized.url,
    cues
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// MyMemory caps q at 500 bytes; a 450-character slice can split a surrogate pair or leave a
// partial word. Cut at a word boundary so the request text and the cache input are the same
// string — otherwise a sentence truncated two different ways would never share a cache key.
function truncateForMyMemory(value) {
  const sliced = String(value).slice(0, 450).replace(/[\uD800-\uDBFF]$/, "");
  const wordCut = sliced.slice(0, 400).replace(/\s+\S*$/, "");
  return (wordCut || sliced).slice(0, 450);
}

async function getSettings() {
  const [stored, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULT_SETTINGS),
    chrome.storage.local.get(["libreTranslateApiKey", "ankiApiKey", "ankiApiKeyRequired"])
  ]);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    libreTranslateApiKey: local.libreTranslateApiKey || "",
    ankiApiKey: local.ankiApiKey || "",
    ankiApiKeyRequired: local.ankiApiKeyRequired === null ? null : local.ankiApiKeyRequired === true
  };
}

async function translationCacheId(text, source, target, provider) {
  return sha256(JSON.stringify([source, target, provider, text]));
}

async function getCachedTranslation(id) {
  const stored = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
  const cache = stored[TRANSLATION_CACHE_KEY];
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return "";
  const entry = cache[id];
  if (!entry || typeof entry.translatedText !== "string" || entry.expiresAt <= Date.now()) return "";
  return entry.translatedText;
}

async function storeCachedTranslation(id, translatedText) {
  return withVocabMutex(async () => {
    const stored = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
    const cache =
      stored[TRANSLATION_CACHE_KEY] && typeof stored[TRANSLATION_CACHE_KEY] === "object"
        ? stored[TRANSLATION_CACHE_KEY]
        : {};
    const now = Date.now();
    for (const [key, entry] of Object.entries(cache)) {
      if (!entry || entry.expiresAt <= now) delete cache[key];
    }
    cache[id] = {
      translatedText: String(translatedText).slice(0, 4000),
      createdAt: now,
      expiresAt: now + TRANSLATION_CACHE_TTL_MS
    };
    const ordered = Object.entries(cache).sort((left, right) => (right[1].createdAt || 0) - (left[1].createdAt || 0));
    const bounded = Object.fromEntries(ordered.slice(0, MAX_TRANSLATION_CACHE_ENTRIES));
    while (JSON.stringify(bounded).length > MAX_TRANSLATION_CACHE_BYTES) {
      const oldest = Object.keys(bounded).at(-1);
      if (!oldest) break;
      delete bounded[oldest];
    }
    await chrome.storage.local.set({ [TRANSLATION_CACHE_KEY]: bounded });
  });
}

async function translateText(text, source, target, settings) {
  const input = boundedText(text, 1000, "Subtitle sentence").trim();
  const sourceLanguage = normalizeLanguageCode(source, "de");
  const targetLanguage = normalizeLanguageCode(target, "en");
  const provider = settings.translationProvider || "none";
  if (!input || sourceLanguage === targetLanguage) return input;
  // The provider belongs in the key: switching providers must never serve the other
  // provider's cached line.
  const cacheId = await translationCacheId(input, sourceLanguage, targetLanguage, provider);
  const cached = await getCachedTranslation(cacheId);
  if (cached) return cached;

  let translatedText;
  if (provider === "libretranslate") {
    const endpoint = String(settings.libreTranslateEndpoint || "").replace(/\/$/, "");
    if (!isAllowedLibreTranslateEndpoint(endpoint)) {
      throw new Error("Use the hosted LibreTranslate endpoint or the documented local endpoint.");
    }
    const { text: body } = await fetchTextWithTimeout(
      `${endpoint}/translate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        redirect: "error",
        body: JSON.stringify({
          q: input,
          source: sourceLanguage,
          target: targetLanguage,
          api_key: settings.libreTranslateApiKey || undefined
        })
      },
      256 * 1024,
      "Translation response",
      (response) => {
        if (!response.ok) throw new Error(`LibreTranslate returned HTTP ${response.status}.`);
      }
    );
    try {
      translatedText = JSON.parse(body).translatedText;
    } catch {
      translatedText = undefined;
    }
  } else if (provider === "mymemory") {
    const query = truncateForMyMemory(input);
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", query);
    url.searchParams.set("langpair", `${sourceLanguage}|${targetLanguage}`);
    const { text: body } = await fetchTextWithTimeout(
      url,
      { credentials: "omit", redirect: "error" },
      256 * 1024,
      "Translation response",
      (response) => {
        if (!response.ok) throw new Error(`MyMemory returned HTTP ${response.status}.`);
      }
    );
    try {
      translatedText = JSON.parse(body).responseData?.translatedText;
    } catch {
      translatedText = undefined;
    }
  } else {
    throw new Error("No automatic translation provider is enabled.");
  }

  if (typeof translatedText !== "string" || !translatedText.trim()) {
    throw new Error("The translation provider returned an unexpected response.");
  }
  const result = translatedText.trim().slice(0, 4000);
  await storeCachedTranslation(cacheId, result);
  return result;
}

chrome.runtime.onInstalled.addListener(async () => {
  const [current, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULT_SETTINGS),
    chrome.storage.local.get(null)
  ]);
  const legacyTranslationKeys = Object.keys(local).filter((key) => key.startsWith("translation:"));
  await Promise.all([
    chrome.storage.sync.set({ ...SYNC_DEFAULT_SETTINGS, ...current }),
    chrome.storage.sync.remove(["libreTranslateApiKey", "ankiApiKey", "ankiApiKeyRequired"]),
    legacyTranslationKeys.length ? chrome.storage.local.remove(legacyTranslationKeys) : Promise.resolve()
  ]);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_SETTINGS": {
        if (!isSubtitleContext(sender)) throw new Error("TapGerman rejected an unexpected settings request.");
        const settings = await getSettings();
        return { ok: true, settings: settingsForSender(settings, sender) };
      }
      case "SAVE_SETTINGS": {
        if (!isSetupPage(sender)) throw new Error("Settings can only be changed from the TapGerman popup.");
        const allowed = sanitizeSettings(message.settings || {});
        const {
          libreTranslateApiKey: libreTranslateApiKeyGiven,
          ankiApiKey: ankiApiKeyGiven,
          ankiApiKeyRequired: _ankiApiKeyRequired,
          ...syncSettings
        } = allowed;
        const writes = [chrome.storage.sync.set(syncSettings)];
        if (Object.hasOwn(allowed, "libreTranslateApiKey")) {
          writes.push(chrome.storage.local.set({ libreTranslateApiKey: libreTranslateApiKeyGiven }));
        }
        // Only the keys actually present in the save touch local storage. A slider-only save
        // must never clobber the stored Anki key (or flip its required flag back to unknown).
        if (Object.hasOwn(allowed, "ankiApiKey")) {
          const currentLocal = await chrome.storage.local.get(["ankiApiKey", "ankiApiKeyRequired"]);
          const stored = currentLocal.ankiApiKey || "";
          const next = ankiApiKeyGiven ?? "";
          const ankiWrites = { ankiApiKey: next };
          ankiWrites.ankiApiKeyRequired =
            next === stored
              ? Object.hasOwn(currentLocal, "ankiApiKeyRequired")
                ? currentLocal.ankiApiKeyRequired
                : false
              : null;
          writes.push(chrome.storage.local.set(ankiWrites));
        }
        await Promise.all(writes);
        return { ok: true, settings: settingsForSender(await getSettings(), sender) };
      }
      case "PARSE_SUBTITLE": {
        if (!isSubtitleContext(sender)) throw new Error("TapGerman rejected an unexpected subtitle parser request.");
        return {
          ok: true,
          track: parseSubtitle({ ...message.payload, source: isSetupPage(sender) ? "import" : "page" })
        };
      }
      case "FETCH_SUBTITLE_URL": {
        if (!isPrimeContent(sender)) throw new Error("Subtitle URLs can only be loaded from a Prime Video player.");
        const requestedUrl = String(message.url || "");
        if (!isAllowedSubtitleUrl(requestedUrl)) throw new Error("TapGerman rejected an unexpected subtitle host.");
        const { response, text } = await fetchTextWithTimeout(
          requestedUrl,
          // Follow redirects: signed CDN links (pv-cdn.net 302s) break under "error". The
          // validator below re-checks the final URL with the same allowlist, so no new hosts
          // are reachable — following only redirects between already-allowed origins.
          { credentials: "omit", redirect: "follow", cache: "no-store" },
          MAX_SUBTITLE_BYTES,
          "Subtitle resource",
          (candidate) => {
            if (!candidate.ok) throw new Error(`Subtitle server returned HTTP ${candidate.status}.`);
            const candidateUrl = candidate.url || requestedUrl;
            const candidateType = candidate.headers.get("content-type") || "";
            if (!isAllowedSubtitleUrl(candidateUrl) || !looksLikeSubtitleResponse(candidateUrl, candidateType)) {
              throw new Error("Subtitle server returned an unexpected resource.");
            }
          }
        );
        const finalUrl = response.url || requestedUrl;
        const contentType = response.headers.get("content-type") || "";
        return {
          ok: true,
          track: parseSubtitle({
            text,
            url: finalUrl,
            label: String(message.label || "Subtitle").slice(0, 120),
            language: normalizeLanguageCode(message.language),
            contentType,
            source: "prime-manifest"
          })
        };
      }
      case "LOOKUP_WORD": {
        if (!(isPrimeContent(sender) || isDemoPage(sender))) throw new Error("Dictionary lookup is only available in the subtitle overlay.");
        return {
          ok: true,
          result: await lookupWord(boundedText(message.word, 120, "Word"), normalizeLanguageCode(message.languageCode, "de"))
        };
      }
      case "TRANSLATE_TEXT": {
        if (!(isPrimeContent(sender) || isDemoPage(sender))) throw new Error("Translation is only available in the subtitle overlay.");
        return {
          ok: true,
          translatedText: await translateText(message.text, message.source, message.target, await getSettings())
        };
      }
      case "SAVE_WORD": {
        if (!(isPrimeContent(sender) || isDemoPage(sender))) throw new Error("Words can only be saved from the subtitle overlay.");
        const item = await upsertVocabulary(sanitizeCard(message.card));
        return { ok: true, item };
      }
      case "GET_FLAGGED_WORDS": {
        // The overlay cannot read chrome.storage.local itself — it is restricted to trusted
        // contexts above — so it asks for just the surface/lemma strings it needs to mark a cue,
        // never the sentences, sources or timestamps the full vocabulary entries carry.
        if (!(isPrimeContent(sender) || isDemoPage(sender))) throw new Error("Flagged words are only available in the subtitle overlay.");
        const stored = await chrome.storage.local.get("vocabulary");
        const vocabulary = Array.isArray(stored.vocabulary) ? stored.vocabulary : [];
        const words = [...new Set(vocabulary.flatMap((entry) => [entry?.word, entry?.lemma]).filter(Boolean))];
        return { ok: true, words };
      }
      case "GET_KNOWN_LEMMAS": {
        // Lemmas the learner has saved — i.e. words they once had to look up. Used by the
        // overlay's per-cue i+1 readout. Same sender gate and same lemma-only shape as
        // GET_FLAGGED_WORDS; sentence/context fields never leave the worker.
        if (!(isPrimeContent(sender) || isDemoPage(sender))) throw new Error("Known words are only available in the subtitle overlay.");
        const stored = await chrome.storage.local.get("vocabulary");
        const vocabulary = Array.isArray(stored.vocabulary) ? stored.vocabulary : [];
        const lemmas = [...new Set(vocabulary.map((entry) => entry.lemma).filter(Boolean))].slice(0, 5000);
        return { ok: true, lemmas };
      }
      case "GET_VOCABULARY": {
        if (!isSetupPage(sender)) throw new Error("The vocabulary list is only available in the TapGerman popup.");
        const stored = await chrome.storage.local.get("vocabulary");
        return { ok: true, vocabulary: Array.isArray(stored.vocabulary) ? stored.vocabulary.slice(0, 2000) : [] };
      }
      case "DELETE_WORD": {
        if (!isSetupPage(sender)) throw new Error("Words can only be removed from the TapGerman popup.");
        const id = boundedText(message.id, 128, "Card ID");
        await withVocabMutex(async () => {
          const stored = await chrome.storage.local.get("vocabulary");
          const vocabulary = Array.isArray(stored.vocabulary) ? stored.vocabulary : [];
          await chrome.storage.local.set({ vocabulary: vocabulary.filter((entry) => entry.id !== id) });
        });
        return { ok: true };
      }
      case "ANKI_STATUS": {
        if (!isSetupPage(sender) || typeof message.requireApiKey !== "boolean") {
          throw new Error("Test the Anki connection from TapGerman Setup.");
        }
        const settings = await getSettings();
        if (message.requireApiKey && !settings.ankiApiKey) {
          throw new Error("AnkiConnect requires an API key. Enter it in Setup and test the connection again.");
        }
        const status = await getAnkiStatus(message.requireApiKey ? settings.ankiApiKey : "");
        await chrome.storage.local.set({ ankiApiKeyRequired: message.requireApiKey });
        return { ok: true, status: { ...status, permission: "granted", requireApiKey: message.requireApiKey } };
      }
      case "ADD_TO_ANKI": {
        if (!(isSetupPage(sender) || isPrimeContent(sender) || isDemoPage(sender))) {
          throw new Error("TapGerman rejected an unexpected Anki request.");
        }
        const settings = await getSettings();
        const card = sanitizeCard(message.card);
        const requestedDeck = isSetupPage(sender) ? String(message.deckName || settings.ankiDeck) : settings.ankiDeck;
        const deckName = requestedDeck.trim();
        if (!deckName || deckName.length > 120) throw new Error("The Anki deck name must be 1–120 characters.");
        const result = await addCardToAnki(card, deckName, ankiApiKeyFor(settings));
        await upsertVocabulary(card);
        return { ok: true, noteId: result.noteId, appended: result.appended };
      }
      case "GET_LAPSED_WORDS": {
        if (!isSetupPage(sender)) throw new Error("Lapsed words are only available in the TapGerman popup.");
        const settings = await getSettings();
        const stableIds = await getLapsedWordStableIds(ankiApiKeyFor(settings), {
          deckName: settings.ankiDeck,
          days: Number(message.days) || 1
        });
        if (!stableIds.length) return { ok: true, words: [] };
        const stored = await chrome.storage.local.get("vocabulary");
        const vocabulary = Array.isArray(stored.vocabulary) ? stored.vocabulary : [];
        const idSet = new Set(stableIds);
        return { ok: true, words: vocabulary.filter((entry) => idSet.has(entry.id)) };
      }
      case "WATCH_SCENE": {
        if (!isSetupPage(sender)) throw new Error("Scenes can only be opened from the TapGerman popup.");
        const sourceUrl = String(message.sourceUrl || "");
        if (!isPrimePlayerUrl(sourceUrl)) throw new Error("That saved link is no longer a valid Prime Video URL.");
        const timeSeconds = Math.max(0, Number(message.sourceTimeSeconds) || 0);
        const tab = await chrome.tabs.create({ url: sourceUrl });
        // The service worker isn't tied to the popup's focus lifecycle, unlike the popup itself —
        // opening the new tab already steals focus and would kill a retry loop running in the
        // popup before it ever got a chance to run.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const seeked = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: "SEEK_TO", timeSeconds }, (response) => {
              void chrome.runtime.lastError; // no listener yet on this attempt; retry
              resolve(Boolean(response?.ok));
            });
          });
          if (seeked) return { ok: true, seeked: true };
        }
        return { ok: true, seeked: false };
      }
      default:
        return { ok: false, error: "Unknown message type." };
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

export { DEFAULT_SETTINGS, inferFormat, inferLanguage, parseSubtitle, translateText };
