const AMAZON_VIDEO_HOSTS = new Set([
  "amazon.com",
  "amazon.de",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.br",
  "amazon.com.mx"
]);

function isHostOrSubdomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isPrimePlayerUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const path = url.pathname.toLowerCase();
    if (isHostOrSubdomain(url.hostname, "primevideo.com")) {
      return /(?:^|\/)detail(?:\/|$)/.test(path);
    }
    return (
      [...AMAZON_VIDEO_HOSTS].some((domain) => isHostOrSubdomain(url.hostname, domain)) &&
      /^\/gp\/video\/(?:detail|watch)(?:\/|$)/.test(path)
    );
  } catch {
    return false;
  }
}

export function isAllowedSubtitleUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (isHostOrSubdomain(url.hostname, "primevideo.com") || isHostOrSubdomain(url.hostname, "pv-cdn.net"))
    );
  } catch {
    return false;
  }
}

export function looksLikeSubtitleResponse(value, contentType = "") {
  const expectedType = /^(?:text\/(?:vtt|xml|plain)|application\/(?:ttml\+xml|xml|octet-stream))(?:;|$)/i.test(
    String(contentType).trim()
  );
  const expectedPath = /\.(?:ttml2?|dfxp|vtt|srt)(?:$|[?#])/i.test(String(value));
  return expectedType || expectedPath;
}

function boundedString(value, maximum, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${field} must be text.`);
  const text = String(value).normalize("NFC");
  if (text.length > maximum) throw new Error(`${field} is too long.`);
  return text;
}

function httpsUrlOrEmpty(value, field) {
  const text = boundedString(value, 2048, field).trim();
  if (!text) return "";
  try {
    // Anki downloads this URL, so anything but plain HTTPS is dropped rather than forwarded.
    return new URL(text).protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

// Deliberately tolerant, like httpsUrlOrEmpty: an overlong or non-Prime value is dropped to "",
// never thrown — a corrupted deep-link field must not block saving the rest of an otherwise-valid
// card. Checked against isPrimePlayerUrl specifically (not a generic HTTPS check) because this URL
// later drives chrome.tabs.create from the "watch scene" action, so it must be a Prime title/watch
// URL, not an arbitrary page a corrupted storage entry could point at.
function sanitizeSourceUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 2048) return "";
  return isPrimePlayerUrl(text) ? text : "";
}

function sanitizeSourceTimeSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, 36000);
}

export function sanitizeCard(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Card data is invalid.");
  const word = boundedString(input.word, 120, "Word").trim();
  if (!word) throw new Error("A card needs a word.");
  const definitions = Array.isArray(input.definitions)
    ? input.definitions.slice(0, 8).map((definition) => boundedString(definition, 800, "Definition"))
    : [];
  const rawLanguageCode = boundedString(input.languageCode || "und", 24, "Language code").toLowerCase();
  const languageCode = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(rawLanguageCode) ? rawLanguageCode : "und";
  return {
    id: boundedString(input.id, 128, "Card ID"),
    word,
    lemma: boundedString(input.lemma || word, 120, "Lemma"),
    definitions,
    meaning: boundedString(input.meaning, 1600, "Meaning"),
    sentence: boundedString(input.sentence, 2000, "Sentence"),
    translation: boundedString(input.translation, 2000, "Translation"),
    grammar: boundedString(input.grammar, 500, "Grammar"),
    partOfSpeech: boundedString(input.partOfSpeech, 120, "Part of speech"),
    ipa: boundedString(input.ipa, 200, "Pronunciation"),
    audioUrl: httpsUrlOrEmpty(input.audioUrl, "Audio URL"),
    languageCode,
    source: boundedString(input.source, 2500, "Source"),
    dictionarySource: boundedString(input.dictionarySource, 2048, "Dictionary source"),
    sourceUrl: sanitizeSourceUrl(input.sourceUrl),
    sourceTimeSeconds: sanitizeSourceTimeSeconds(input.sourceTimeSeconds)
  };
}

export { AMAZON_VIDEO_HOSTS };
