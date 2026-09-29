const ANKI_URL = "http://127.0.0.1:8765";
export const ANKI_MODEL = "GlossLine Context v2";
export const ANKI_CARD_TEMPLATE = "Recognition";
export const ANKI_FIELDS = [
  "StableId",
  "Surface",
  "Lemma",
  "Reading",
  "Audio",
  "Meaning",
  "Sentence",
  "Translation",
  "Grammar",
  "Source"
];

// Colours are left to Anki so the card follows the collection's light or night theme. Only
// translucent greys are hardcoded, because they read correctly against either background.
export const MODEL_CSS = `.card{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:20px;line-height:1.5;text-align:left}
.word{font-size:34px;font-weight:700;line-height:1.2}
.lemma,.reading{font-size:16px;opacity:.65}
.context{margin-top:16px;padding:12px 14px;border-left:4px solid #f7b32b;background:rgba(128,128,128,.14);border-radius:0 6px 6px 0}
.target{background:rgba(247,179,43,.4);border-radius:3px;padding:0 3px;font-weight:700}
.senses{margin:0;padding-left:22px}
.senses li{margin-bottom:4px}
.grammar{margin-top:10px;font-size:16px;opacity:.75}
.audio{margin-top:12px}
.meta{margin-top:16px;font-size:12px;opacity:.55;word-break:break-word}
hr#answer{margin:18px 0;border:none;border-top:1px solid rgba(128,128,128,.4)}
.context-sep{margin:14px 0;border:none;border-top:1px dashed rgba(128,128,128,.35)}`;

export const FRONT_TEMPLATE = `<div class="word">{{Surface}}</div>{{#Lemma}}<div class="lemma">{{Lemma}}</div>{{/Lemma}}{{#Reading}}<div class="reading">{{Reading}}</div>{{/Reading}}{{#Sentence}}<div class="context">{{Sentence}}</div>{{/Sentence}}`;

export const BACK_TEMPLATE = `{{FrontSide}}<hr id="answer">{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}<div class="meaning">{{Meaning}}</div>{{#Grammar}}<div class="grammar">{{Grammar}}</div>{{/Grammar}}{{#Translation}}<div class="context">{{Translation}}</div>{{/Translation}}{{#Source}}<div class="meta">{{Source}}</div>{{/Source}}`;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escapes the sentence first, then wraps whole-word occurrences of the saved word in a highlight
 * span. Marking up already-escaped text is what keeps subtitle content from becoming live HTML.
 * Candidates are tried in order so an inflected surface wins over the lemma; if none of them occur
 * in the sentence the plain escaped sentence is returned.
 */
export function highlightSurface(sentence, ...candidates) {
  const escapedSentence = escapeHtml(sentence);
  for (const candidate of candidates) {
    const escapedCandidate = escapeHtml(String(candidate ?? "").trim());
    if (!escapedCandidate) continue;
    // \b is ASCII-only, so letter lookarounds are used to avoid matching inside a longer word.
    const pattern = new RegExp(`(?<!\\p{L})${escapeRegExp(escapedCandidate)}(?!\\p{L})`, "giu");
    if (pattern.test(escapedSentence)) {
      pattern.lastIndex = 0;
      return escapedSentence.replace(pattern, (match) => `<span class="target">${match}</span>`);
    }
  }
  return escapedSentence;
}

export function toAnkiTsvCell(value) {
  const escaped = escapeHtml(value).replaceAll("\t", " ").replaceAll(/\r\n?|\n/g, "<br>");
  // Excel/LibreOffice execute a cell as a formula when it starts with =, +, -, or @. A saved
  // word like "=1+1" would otherwise become live spreadsheet code on TSV import — prefix an
  // apostrophe so the cell stays inert text.
  if (/^[=+\-@]/.test(String(value).trimStart())) return `'${escaped}`;
  return escaped;
}

export function buildAnkiRequest(action, params = {}, apiKey = "") {
  const request = { action, version: 6, params };
  if (apiKey !== "" && apiKey != null) request.key = String(apiKey);
  return request;
}

function normalizeStablePart(value) {
  return String(value ?? "").normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function hashStableKey(value) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(36);
}

export function buildAnkiStableId(card) {
  const surface = normalizeStablePart(card.word);
  const lemma = normalizeStablePart(card.lemma || card.word);
  const sense = normalizeStablePart(Array.isArray(card.definitions) ? card.definitions[0] : card.meaning);
  const grammar = normalizeStablePart(card.grammar || card.partOfSpeech);
  const context = normalizeStablePart(card.sentence);
  const identity = JSON.stringify([normalizeStablePart(card.languageCode || "unknown"), lemma, surface, sense, grammar, context]);
  return `glossline-v1-${hashStableKey(identity)}`;
}

export function buildLanguageTag(languageCode) {
  return `language::${String(languageCode || "unknown").replace(/[^\w-]/g, "")}`;
}

function normalizeSenseToken(card) {
  return normalizeStablePart(Array.isArray(card.definitions) ? card.definitions[0] : card.meaning) || "unknown";
}

// A note's sense is not directly re-derivable from its rendered Meaning field (HTML, possibly a
// list), so it is instead recorded as a tag at save time and matched by tag at lookup time. This
// is what keeps "cards that grow" from merging two unrelated senses of the same word (Schloss the
// castle vs. Schloss the lock) onto one card.
export function buildSenseTag(card) {
  return `sense::${hashStableKey(normalizeSenseToken(card))}`;
}

export function escapeAnkiSearchValue(value) {
  return String(value ?? "").replace(/[\\"*_]/g, (char) => `\\${char}`);
}

export async function invokeAnki(action, params = {}, apiKey = "") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let response;
    try {
      // Do not declare targetAddressSpace here. It only exempts mixed content, and naming a space
      // that disagrees with the resolved one (127.0.0.1 resolves to `loopback`) makes Chromium
      // reject the request outright, before the Local Network Access prompt can ever be shown.
      response = await fetch(ANKI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildAnkiRequest(action, params, apiKey))
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AnkiConnect did not respond within 8 seconds.");
      throw new Error(
        "Cannot reach AnkiConnect. Confirm Anki is open with add-on 2055492159 installed. " +
          "On Chrome/Edge 142+ you must also allow this extension to reach your local network: open GlossLine " +
          "from the extension's Options entry (not the toolbar popup) and approve the local network prompt."
      );
    }
    if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}.`);
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AnkiConnect did not respond within 8 seconds.");
      throw new Error("AnkiConnect returned an invalid response.");
    }
    if (!payload || typeof payload !== "object" || !("result" in payload) || !("error" in payload)) {
      throw new Error("AnkiConnect returned an invalid response.");
    }
    if (payload.error) throw new Error(payload.error);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeAnkiPermission(result) {
  if (!result || !["granted", "denied"].includes(result.permission)) {
    throw new Error("AnkiConnect returned an invalid permission response.");
  }
  return { ...result, requireApiKey: Boolean(result.requireApiKey ?? result.requireApikey) };
}

export async function requestAnkiPermission() {
  return normalizeAnkiPermission(await invokeAnki("requestPermission"));
}

export async function ensureGlossLineModel(deckName = "GlossLine", apiKey = "") {
  const [models] = await Promise.all([
    invokeAnki("modelNames", {}, apiKey),
    invokeAnki("createDeck", { deck: deckName }, apiKey)
  ]);
  if (!models.includes(ANKI_MODEL)) {
    await invokeAnki("createModel", {
      modelName: ANKI_MODEL,
      inOrderFields: ANKI_FIELDS,
      css: MODEL_CSS,
      isCloze: false,
      cardTemplates: [{ Name: ANKI_CARD_TEMPLATE, Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE }]
    }, apiKey);
  } else {
    // Push the current layout to collections that already hold this note type, so template and
    // styling fixes reach cards that were added before the change.
    await invokeAnki("updateModelTemplates", {
      model: { name: ANKI_MODEL, templates: { [ANKI_CARD_TEMPLATE]: { Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE } } }
    }, apiKey);
    await invokeAnki("updateModelStyling", { model: { name: ANKI_MODEL, css: MODEL_CSS } }, apiKey);
  }

  const fields = await invokeAnki("modelFieldNames", { modelName: ANKI_MODEL }, apiKey);
  if (!Array.isArray(fields) || fields.length !== ANKI_FIELDS.length || fields.some((field, index) => field !== ANKI_FIELDS[index])) {
    throw new Error(`The ${ANKI_MODEL} note type has an incompatible field layout. Rename or remove it in Anki, then try again.`);
  }
}

// Only the senses that fit on a card. Reviewing eight glosses teaches recognition of none of them.
const MAX_CARD_SENSES = 4;

function buildMeaning(card) {
  const glosses = (Array.isArray(card.definitions) && card.definitions.length
    ? card.definitions
    : [card.meaning]
  )
    .filter((gloss) => String(gloss ?? "").trim())
    .slice(0, MAX_CARD_SENSES);
  if (!glosses.length) return "";
  if (glosses.length === 1) return escapeHtml(glosses[0]);
  return `<ol class="senses">${glosses.map((gloss) => `<li>${escapeHtml(gloss)}</li>`).join("")}</ol>`;
}

export function buildAnkiNote(card, deckName = "GlossLine", audioTag = "") {
  // Repeating the lemma when it matches the surface form is noise, and it makes the template's
  // {{#Lemma}} conditional meaningful instead of always true.
  const lemmaDiffers = card.lemma && normalizeStablePart(card.lemma) !== normalizeStablePart(card.word);
  const tags = ["glossline", buildLanguageTag(card.languageCode), buildSenseTag(card)];
  const partOfSpeech = String(card.partOfSpeech || "").toLowerCase().replace(/[^a-z]/g, "");
  if (partOfSpeech) tags.push(`pos::${partOfSpeech}`);
  return {
    deckName,
    modelName: ANKI_MODEL,
    fields: {
      StableId: buildAnkiStableId(card),
      Surface: escapeHtml(card.word),
      Lemma: lemmaDiffers ? escapeHtml(card.lemma) : "",
      Reading: escapeHtml(card.ipa || ""),
      Audio: audioTag,
      Meaning: buildMeaning(card),
      Sentence: highlightSurface(card.sentence, card.word, card.lemma),
      Translation: escapeHtml(card.translation),
      Grammar: escapeHtml(card.grammar || card.partOfSpeech || ""),
      Source: escapeHtml(card.source || "Prime Video via GlossLine")
    },
    options: { allowDuplicate: false, duplicateScope: "deck" },
    tags
  };
}

const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "oga", "opus", "wav", "m4a"]);

function audioFileName(card) {
  let extension = "mp3";
  try {
    const [, found] = new URL(card.audioUrl).pathname.toLowerCase().match(/\.([a-z0-9]+)$/) || [];
    if (AUDIO_EXTENSIONS.has(found)) extension = found;
  } catch {
    // A malformed URL keeps the default extension; storeMediaFile decides whether it is usable.
  }
  // Lowercased to match what Anki does to the names it is given, so the existence probe below
  // looks for the name the file would actually have been stored under.
  return `${buildAnkiStableId(card)}.${extension}`.toLowerCase();
}

const AUDIO_RETRY_DELAYS_MS = [400, 1200];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function storeCardAudio(card, apiKey) {
  if (!card.audioUrl) return "";
  const filename = audioFileName(card);

  // Saving the same word again must not re-download the clip. Beyond being wasteful, bursts of
  // requests are what earn a 429 from the media host in the first place.
  try {
    const existing = await invokeAnki("getMediaFilesNames", { pattern: filename }, apiKey);
    if (Array.isArray(existing) && existing.length) return `[sound:${existing[0]}]`;
  } catch {
    // A failed probe is not fatal — fall through and try the download.
  }

  // Wikimedia rate-limits, and Anki surfaces that as a failed download, so one refused clip gets
  // a couple of spaced retries before the card settles for no audio.
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Anki fetches the URL itself, so the extension needs no host access to the media host.
      // It also rewrites the name it is given (lowercasing it, and suffixing on a content clash),
      // so the tag has to use the name it reports back rather than the one we asked for.
      const stored = await invokeAnki("storeMediaFile", { filename, url: card.audioUrl }, apiKey);
      return stored ? `[sound:${stored}]` : "";
    } catch (error) {
      if (attempt < AUDIO_RETRY_DELAYS_MS.length) {
        await wait(AUDIO_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      // Pronunciation is a bonus; a media failure must not block saving the card. It is still
      // worth reporting, or a card silently arrives without audio and nothing explains why.
      console.warn(`GlossLine could not attach pronunciation audio for "${card.word}":`, error.message);
      return "";
    }
  }
}

// Looks up a note by word identity (deck + note type + language + sense tags, then an exact
// Surface-or-Lemma field match) rather than by StableId, since StableId bakes in sentence context
// and would never match a repeat save in a new sentence. Uses notesInfo's own `query` parameter so
// a match costs one round trip instead of a separate findNotes call.
export async function findExistingAnkiNote(card, deckName = "GlossLine", apiKey = "") {
  const key = escapeAnkiSearchValue(normalizeStablePart(card.lemma || card.word));
  if (!key) return null;
  const query = [
    `deck:"${escapeAnkiSearchValue(deckName)}"`,
    `note:"${escapeAnkiSearchValue(ANKI_MODEL)}"`,
    `tag:"${buildLanguageTag(card.languageCode)}"`,
    `tag:"${buildSenseTag(card)}"`,
    `("Surface:${key}" OR "Lemma:${key}")`
  ].join(" ");
  const notes = await invokeAnki("notesInfo", { query }, apiKey);
  return notes.find((note) => note && note.noteId) || null;
}

const CONTEXT_SEPARATOR = '<hr class="context-sep">';

function stripHtmlTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "");
}

// Splits an accumulated field back into the individual sentences it was built from. Comparing
// whole segments is what makes the idempotency check exact: a substring scan over the joined
// value would both match across a segment boundary and wrongly skip a new sentence that merely
// contains an existing one.
function fieldSegments(value) {
  return String(value ?? "")
    .split(CONTEXT_SEPARATOR)
    .map((segment) => stripHtmlTags(segment).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function appendToField(existingValue, addition) {
  return existingValue ? `${existingValue}${CONTEXT_SEPARATOR}${addition}` : addition;
}

// Appends the new sentence/translation/source onto an existing note instead of creating a
// duplicate. Word-level facts (Meaning/Grammar/Reading/Audio/StableId) are left untouched — only
// the per-sentence fields grow. Idempotent: re-sending the same subtitle line is a no-op, checked
// on stripped plain text so a highlight-span difference (surface match vs. lemma match) can't
// defeat the comparison.
export async function appendSentenceToNote(existingNote, card, apiKey = "") {
  const noteId = existingNote.noteId;
  const existingSentence = existingNote.fields?.Sentence?.value || "";
  const newSentenceHtml = highlightSurface(card.sentence, card.word, card.lemma);
  const [newSentencePlain] = fieldSegments(newSentenceHtml);
  if (newSentencePlain && fieldSegments(existingSentence).includes(newSentencePlain)) {
    return { noteId, appended: false, alreadyPresent: true };
  }

  const fields = { Sentence: appendToField(existingSentence, newSentenceHtml) };
  const newTranslation = escapeHtml(card.translation || "");
  if (newTranslation) {
    fields.Translation = appendToField(existingNote.fields?.Translation?.value || "", newTranslation);
  }
  const newSource = escapeHtml(card.source || "");
  if (newSource) {
    fields.Source = appendToField(existingNote.fields?.Source?.value || "", newSource);
  }

  await invokeAnki("updateNoteFields", { note: { id: noteId, fields } }, apiKey);
  return { noteId, appended: true };
}

export async function addCardToAnki(card, deckName = "GlossLine", apiKey = "") {
  await ensureGlossLineModel(deckName, apiKey);
  const existing = await findExistingAnkiNote(card, deckName, apiKey);
  if (existing) return appendSentenceToNote(existing, card, apiKey);
  const note = buildAnkiNote(card, deckName, await storeCardAudio(card, apiKey));
  const [canAdd] = await invokeAnki("canAddNotes", { notes: [note] }, apiKey);
  if (!canAdd) throw new Error("This vocabulary card already exists in the selected Anki deck.");
  const noteId = await invokeAnki("addNote", { note }, apiKey);
  return { noteId, appended: false, created: true };
}

// Anki's `rated:N:1` search operator finds cards graded "Again" in the last N days — this is a
// direct passthrough of Anki's own search syntax (findCards/findNotes hand off to Anki's native
// query engine), not a bespoke lapse query.
export async function findLapsedNoteIds(apiKey = "", { deckName = "GlossLine", days = 1 } = {}) {
  const query = [
    `deck:"${escapeAnkiSearchValue(deckName)}"`,
    `note:"${escapeAnkiSearchValue(ANKI_MODEL)}"`,
    `rated:${Number(days) > 0 ? Math.floor(Number(days)) : 1}:1`
  ].join(" ");
  const cardIds = await invokeAnki("findCards", { query }, apiKey);
  if (!cardIds.length) return [];
  const noteIds = await invokeAnki("cardsToNotes", { cards: cardIds }, apiKey);
  return [...new Set(noteIds)];
}

export async function getLapsedWordStableIds(apiKey = "", opts = {}) {
  const noteIds = await findLapsedNoteIds(apiKey, opts);
  if (!noteIds.length) return [];
  const notes = await invokeAnki("notesInfo", { notes: noteIds }, apiKey);
  return notes.map((note) => note?.fields?.StableId?.value).filter(Boolean);
}

export async function getAnkiStatus(apiKey = "") {
  const version = await invokeAnki("version", {}, apiKey);
  const decks = await invokeAnki("deckNames", {}, apiKey);
  return { connected: true, version, decks };
}

export async function authorizeAnki(apiKey = "") {
  const permission = await requestAnkiPermission();
  if (permission.permission !== "granted") {
    throw new Error("AnkiConnect access was denied. Click Test again and approve GlossLine in Anki.");
  }
  if (permission.requireApiKey && !apiKey) {
    throw new Error("AnkiConnect requires an API key. Enter the key from its add-on configuration and test again.");
  }
  const activeApiKey = permission.requireApiKey ? apiKey : "";
  return {
    ...(await getAnkiStatus(activeApiKey)),
    permission: permission.permission,
    requireApiKey: Boolean(permission.requireApiKey)
  };
}
