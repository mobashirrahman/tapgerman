const LANGUAGE_NAMES = {
  ar: "Arabic",
  bg: "Bulgarian",
  ca: "Catalan",
  cs: "Czech",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fr: "French",
  ga: "Irish",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  lt: "Lithuanian",
  lv: "Latvian",
  nl: "Dutch",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sv: "Swedish",
  ta: "Tamil",
  te: "Telugu",
  tr: "Turkish",
  uk: "Ukrainian",
  ur: "Urdu",
  vi: "Vietnamese",
  zh: "Chinese"
};

const KAIKKI_TIMEOUT_MS = 8000;
const KAIKKI_MAX_BYTES = 2 * 1024 * 1024;
const KAIKKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const kaikkiCache = new Map();

async function readBoundedText(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error("Dictionary entry is unexpectedly large.");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > maximumBytes) throw new Error("Dictionary entry is unexpectedly large.");
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
      throw new Error("Dictionary entry is unexpectedly large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function cacheKaikki(key, value, ttl = KAIKKI_CACHE_TTL_MS) {
  kaikkiCache.set(key, { value, expiresAt: Date.now() + ttl });
  while (kaikkiCache.size > 300) kaikkiCache.delete(kaikkiCache.keys().next().value);
}

export function normalizeLookupWord(input) {
  return String(input || "")
    .normalize("NFC")
    .trim()
    .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}'’\-]+$/gu, "")
    .slice(0, 120);
}

export function buildKaikkiUrl(input, languageCode) {
  const word = normalizeLookupWord(input);
  const language = LANGUAGE_NAMES[languageCode];
  if (!word || !language) return null;
  const characters = Array.from(word);
  const first = characters[0];
  const firstTwo = characters.slice(0, 2).join("");
  const path = [language, "meaning", first, firstTwo, `${word}.jsonl`]
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://kaikki.org/dictionary/${path}`;
}

export function parseKaikkiJsonl(text, requestedWord = "", languageCode = "") {
  const records = String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!records.length) return null;

  const entries = records.slice(0, 8).map((record) => {
    const definitions = (record.senses || [])
      .filter((sense) => Array.isArray(sense.glosses) && sense.glosses.length)
      .slice(0, 6)
      .map((sense) => ({
        gloss: sense.glosses[0],
        tags: [...new Set([...(sense.tags || []), ...(sense.raw_tags || [])])].slice(0, 8),
        examples: (sense.examples || [])
          .slice(0, 2)
          .map((example) => ({ text: example.text || "", translation: example.english || example.translation || "" }))
          .filter((example) => example.text)
      }));

    const sounds = record.sounds || [];
    const ipa = sounds.find((sound) => sound.ipa)?.ipa || "";
    const audioUrl = sounds.find((sound) => sound.mp3_url)?.mp3_url || "";
    const head = record.head_templates?.find((template) => template.expansion)?.expansion || "";
    const formOf = (record.senses || [])
      .flatMap((sense) => [...(sense.form_of || []), ...(sense.alt_of || [])])
      .find((form) => form.word)?.word;

    return {
      word: record.word || requestedWord,
      partOfSpeech: record.pos || "",
      head,
      ipa,
      audioUrl,
      formOf: formOf || "",
      definitions
    };
  });

  return {
    word: records[0].word || requestedWord,
    language: records[0].lang || LANGUAGE_NAMES[languageCode] || languageCode,
    languageCode: records[0].lang_code || languageCode,
    entries: entries.filter((entry) => entry.definitions.length),
    sourceName: "Kaikki / English Wiktionary",
    license: "CC BY-SA 4.0"
  };
}

async function fetchKaikki(word, languageCode) {
  const url = buildKaikkiUrl(word, languageCode);
  if (!url) return null;
  const cached = kaikkiCache.get(url);
  if (cached?.expiresAt > Date.now()) return cached.value;
  if (cached) kaikkiCache.delete(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KAIKKI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok) {
      cacheKaikki(url, null, 5 * 60 * 1000);
      return null;
    }
    const result = parseKaikkiJsonl(await readBoundedText(response, KAIKKI_MAX_BYTES), word, languageCode);
    if (result) result.sourceUrl = url.replace(/\.jsonl$/, ".html");
    cacheKaikki(url, result);
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The dictionary lookup timed out.");
    if (error?.message === "Dictionary entry is unexpectedly large.") throw error;
    throw new Error("The dictionary service is unavailable right now.");
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupWord(input, languageCode = "de") {
  const normalized = normalizeLookupWord(input);
  if (!normalized) throw new Error("Choose a word containing letters or numbers.");

  const candidates = [normalized];
  if (languageCode === "de") {
    const lowercase = normalized.toLocaleLowerCase("de");
    const titlecase = lowercase[0]?.toLocaleUpperCase("de") + lowercase.slice(1);
    candidates.push(lowercase, titlecase);
  }

  let result = null;
  for (const candidate of [...new Set(candidates)]) {
    result = await fetchKaikki(candidate, languageCode);
    if (result?.entries?.length) break;
  }

  if (!result?.entries?.length) {
    return {
      word: normalized,
      language: LANGUAGE_NAMES[languageCode] || languageCode,
      languageCode,
      entries: [],
      sourceName: "Kaikki / English Wiktionary",
      sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(normalized)}`,
      license: "CC BY-SA 4.0"
    };
  }

  const lemma = result.entries.map((entry) => entry.formOf).find(Boolean);
  if (lemma && lemma.toLocaleLowerCase() !== result.word.toLocaleLowerCase()) {
    const lemmaResult = await fetchKaikki(lemma, languageCode);
    if (lemmaResult?.entries?.length) {
      result.lemma = lemma;
      result.lemmaEntries = lemmaResult.entries.slice(0, 4);
    }
  }

  return result;
}

export { LANGUAGE_NAMES };
