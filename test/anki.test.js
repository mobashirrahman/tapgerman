import test from "node:test";
import assert from "node:assert/strict";
import {
  ANKI_FIELDS,
  ANKI_MODEL,
  addCardToAnki,
  appendSentenceToNote,
  authorizeAnki,
  buildAnkiNote,
  buildAnkiRequest,
  buildAnkiStableId,
  buildSenseTag,
  escapeAnkiSearchValue,
  escapeHtml,
  findExistingAnkiNote,
  findLapsedNoteIds,
  getLapsedWordStableIds,
  highlightSurface,
  normalizeAnkiPermission,
  toAnkiTsvCell
} from "../extension/src/anki.js";

test("escapes user and subtitle text before creating Anki HTML", () => {
  assert.equal(escapeHtml('<img src=x onerror="bad">'), "&lt;img src=x onerror=&quot;bad&quot;&gt;");
});

test("builds a stable LexiCue Anki note with context", () => {
  const card = {
    word: "Haus",
    lemma: "Haus",
    definitions: ["house", "home"],
    sentence: "Das ist mein Haus.",
    translation: "That is my house.",
    grammar: "noun · neuter",
    source: "Episode · 1:23",
    languageCode: "de"
  };
  const note = buildAnkiNote(card);
  assert.equal(note.modelName, ANKI_MODEL);
  assert.deepEqual(Object.keys(note.fields), ANKI_FIELDS);
  assert.equal(note.fields.Surface, "Haus");
  assert.equal(note.fields.Lemma, "", "a lemma identical to the surface form is not repeated");
  assert.match(note.fields.StableId, /^lexicue-v1-[a-z0-9]+$/);
  assert.equal(note.fields.Meaning, '<ol class="senses"><li>house</li><li>home</li></ol>');
  assert.equal(note.fields.Sentence, 'Das ist mein <span class="target">Haus</span>.');
  assert.deepEqual(note.tags, ["lexicue", "language::de", buildSenseTag(card)]);
  assert.equal(note.options.allowDuplicate, false);
});

test("keeps the lemma, pronunciation, and audio when they add something", () => {
  const card = {
    word: "spricht",
    lemma: "sprechen",
    definitions: ["to speak"],
    sentence: "Harvey spricht für die Kanzlei.",
    ipa: "/ʃpʁɪçt/",
    partOfSpeech: "verb",
    languageCode: "de"
  };
  const note = buildAnkiNote(card, "LexiCue", "[sound:lexicue-v1-abc.mp3]");
  assert.equal(note.fields.Lemma, "sprechen");
  assert.equal(note.fields.Reading, "/ʃpʁɪçt/");
  assert.equal(note.fields.Audio, "[sound:lexicue-v1-abc.mp3]");
  assert.equal(note.fields.Meaning, "to speak", "a single sense stays unwrapped");
  assert.equal(note.fields.Sentence, 'Harvey <span class="target">spricht</span> für die Kanzlei.');
  assert.deepEqual(note.tags, ["lexicue", "language::de", buildSenseTag(card), "pos::verb"]);
});

test("highlights the saved word without letting subtitle markup execute", () => {
  assert.equal(
    highlightSurface("<b>Haus</b> und Haus", "Haus"),
    '&lt;b&gt;<span class="target">Haus</span>&lt;/b&gt; und <span class="target">Haus</span>',
    "every occurrence is marked, and the subtitle's own angle brackets stay escaped"
  );
  assert.equal(
    highlightSurface("Die Häuser sind alt.", "haus"),
    "Die Häuser sind alt.",
    "a partial match inside a longer word is not highlighted"
  );
  assert.equal(
    highlightSurface("Sie sprechen laut.", "spricht", "sprechen"),
    'Sie <span class="target">sprechen</span> laut.',
    "the lemma is used when the inflected surface form is absent"
  );
  assert.equal(highlightSurface("Kein Treffer hier.", "Haus"), "Kein Treffer hier.");
});

test("builds stable duplicate identities from language, word sense, and sentence context", () => {
  const card = {
    word: "Häuser",
    lemma: "Haus",
    definitions: ["houses"],
    sentence: "Die Häuser sind alt.",
    languageCode: "de"
  };
  assert.equal(buildAnkiStableId(card), buildAnkiStableId({ ...card, word: "  HÄUSER  " }));
  assert.notEqual(buildAnkiStableId(card), buildAnkiStableId({ ...card, definitions: ["buildings"] }));
  assert.notEqual(buildAnkiStableId(card), buildAnkiStableId({ ...card, sentence: "Viele Häuser stehen hier." }));
});

test("normalizes both AnkiConnect API-key requirement spellings", () => {
  assert.equal(normalizeAnkiPermission({ permission: "granted", requireApiKey: true }).requireApiKey, true);
  assert.equal(normalizeAnkiPermission({ permission: "granted", requireApikey: true }).requireApiKey, true);
  assert.equal(normalizeAnkiPermission({ permission: "granted", requireApikey: false }).requireApiKey, false);
});

test("adds an AnkiConnect API key only when configured", () => {
  assert.deepEqual(buildAnkiRequest("version"), { action: "version", version: 6, params: {} });
  assert.deepEqual(buildAnkiRequest("deckNames", {}, "local-secret"), {
    action: "deckNames",
    version: 6,
    params: {},
    key: "local-secret"
  });
});

test("escapes HTML in TSV fields before preserving line breaks", () => {
  assert.equal(toAnkiTsvCell("<script>bad()</script>\tline 1\nline 2"), "&lt;script&gt;bad()&lt;/script&gt; line 1<br>line 2");
});

test("requests origin permission before making authenticated status calls", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const addressSpaces = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    addressSpaces.push(options.targetAddressSpace);
    const results = {
      requestPermission: { permission: "granted", requireApikey: true, version: 6 },
      version: 6,
      deckNames: ["LexiCue"]
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: results[request.action], error: null })
    };
  };

  const status = await authorizeAnki("local-secret");
  assert.deepEqual(status, {
    connected: true,
    version: 6,
    decks: ["LexiCue"],
    permission: "granted",
    requireApiKey: true
  });
  assert.equal(requests[0].action, "requestPermission");
  assert.equal("key" in requests[0], false);
  assert.deepEqual(requests.slice(1).map(({ action, key }) => ({ action, key })), [
    { action: "version", key: "local-secret" },
    { action: "deckNames", key: "local-secret" }
  ]);
  assert.deepEqual(addressSpaces, [undefined, undefined, undefined]);
});

test("buildSenseTag keeps homonyms apart while ignoring sentence context", () => {
  const card = { word: "Schloss", lemma: "Schloss", definitions: ["castle"], sentence: "Das Schloss ist alt.", languageCode: "de" };
  assert.equal(
    buildSenseTag(card),
    buildSenseTag({ ...card, sentence: "Ein ganz anderer Satz." }),
    "sentence context does not affect the sense tag, unlike buildAnkiStableId — that is what lets a repeat save merge"
  );
  assert.equal(
    buildSenseTag(card),
    buildSenseTag({ ...card, definitions: ["  CASTLE  "] }),
    "casing and surrounding whitespace are normalized away"
  );
  assert.notEqual(
    buildSenseTag(card),
    buildSenseTag({ ...card, definitions: ["lock"] }),
    "a different sense produces a different tag, so unrelated homonyms never merge onto one card"
  );
  assert.match(buildSenseTag(card), /^sense::[a-z0-9]+$/);
});

test("escapeAnkiSearchValue escapes quote, backslash, and wildcard characters", () => {
  assert.equal(escapeAnkiSearchValue('Sch"loss'), 'Sch\\"loss');
  assert.equal(escapeAnkiSearchValue("back\\slash"), "back\\\\slash");
  assert.equal(escapeAnkiSearchValue("wild*card_"), "wild\\*card\\_");
});

test("findExistingAnkiNote searches by deck, note type, language, sense, and word identity", async (context) => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const card = { word: "spricht", lemma: "sprechen", definitions: ["to speak"], languageCode: "de" };
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    queries.push(request.params.query);
    return { ok: true, status: 200, json: async () => ({ result: [], error: null }) };
  };

  const found = await findExistingAnkiNote(card, "LexiCue");
  assert.equal(found, null, "no match returns null rather than an empty object");
  assert.equal(
    queries[0],
    `deck:"LexiCue" note:"${ANKI_MODEL}" tag:"language::de" tag:"${buildSenseTag(card)}" ("Surface:sprechen" OR "Lemma:sprechen")`
  );
});

test("findExistingAnkiNote returns the matched note", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const results = { notesInfo: [{ noteId: 42, fields: { Sentence: { value: "old" } } }] };
    return { ok: true, status: 200, json: async () => ({ result: results[request.action], error: null }) };
  };

  const found = await findExistingAnkiNote({ word: "Haus", languageCode: "de" }, "LexiCue");
  assert.equal(found.noteId, 42);
});

test("appendSentenceToNote skips the update when the sentence is already present", async (context) => {
  const originalFetch = globalThis.fetch;
  let updateCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "updateNoteFields") updateCalls += 1;
    return { ok: true, status: 200, json: async () => ({ result: null, error: null }) };
  };
  const existingNote = {
    noteId: 7,
    fields: {
      Sentence: { value: 'Harvey <span class="target">spricht</span> für die Kanzlei.' },
      Translation: { value: "" },
      Source: { value: "" }
    }
  };

  const result = await appendSentenceToNote(existingNote, { word: "spricht", sentence: "Harvey spricht für die Kanzlei." });
  assert.deepEqual(result, { noteId: 7, appended: false, alreadyPresent: true });
  assert.equal(updateCalls, 0, "re-sending the same subtitle line is a no-op");
});

test("appendSentenceToNote compares whole sentences, not substrings", async (context) => {
  const originalFetch = globalThis.fetch;
  const updates = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "updateNoteFields") updates.push(request.params.note);
    return { ok: true, status: 200, json: async () => ({ result: null, error: null }) };
  };

  // A short new line that happens to be contained in an already-stored one must still be added.
  const containedInExisting = await appendSentenceToNote(
    { noteId: 1, fields: { Sentence: { value: "Das ist mein Haus." } } },
    { word: "Haus", sentence: "mein Haus" }
  );
  assert.equal(containedInExisting.appended, true, "a substring of an existing sentence is still a distinct sentence");

  // A line that only appears to match by spanning the boundary between two stored sentences.
  const spansBoundary = await appendSentenceToNote(
    { noteId: 2, fields: { Sentence: { value: `Er geht.${'<hr class="context-sep">'}Sie bleibt.` } } },
    { word: "geht", sentence: "geht.Sie" }
  );
  assert.equal(spansBoundary.appended, true, "a match straddling the separator is not a real duplicate");
  assert.equal(updates.length, 2);
});

test("appendSentenceToNote merges a genuinely new sentence onto the existing note", async (context) => {
  const originalFetch = globalThis.fetch;
  let updateRequest = null;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "updateNoteFields") updateRequest = request.params.note;
    return { ok: true, status: 200, json: async () => ({ result: null, error: null }) };
  };
  const existingNote = {
    noteId: 7,
    fields: {
      Sentence: { value: 'Harvey <span class="target">spricht</span> für die Kanzlei.' },
      Translation: { value: "Harvey speaks for the firm." },
      Source: { value: "Suits · 3:57" }
    }
  };

  const result = await appendSentenceToNote(existingNote, {
    word: "spricht",
    sentence: "Sie spricht kaum Deutsch.",
    translation: "She barely speaks German.",
    source: "Suits · 12:04"
  });
  assert.deepEqual(result, { noteId: 7, appended: true });
  assert.equal(updateRequest.id, 7);
  assert.equal(
    updateRequest.fields.Sentence,
    'Harvey <span class="target">spricht</span> für die Kanzlei.<hr class="context-sep">Sie <span class="target">spricht</span> kaum Deutsch.'
  );
  assert.equal(
    updateRequest.fields.Translation,
    'Harvey speaks for the firm.<hr class="context-sep">She barely speaks German.'
  );
  assert.equal(updateRequest.fields.Source, 'Suits · 3:57<hr class="context-sep">Suits · 12:04');
  assert.equal("Meaning" in updateRequest.fields, false, "word-level facts are left untouched");
});

test("addCardToAnki creates a new note when none exists, and appends when one does", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const card = { word: "Haus", definitions: ["house"], sentence: "Das ist mein Haus.", languageCode: "de" };
  let notesInfoResult = [];
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.action);
    const results = {
      modelNames: [ANKI_MODEL],
      createDeck: null,
      updateModelTemplates: null,
      updateModelStyling: null,
      modelFieldNames: ANKI_FIELDS,
      notesInfo: notesInfoResult,
      canAddNotes: [true],
      addNote: 555,
      updateNoteFields: null
    };
    return { ok: true, status: 200, json: async () => ({ result: results[request.action], error: null }) };
  };

  const created = await addCardToAnki(card, "LexiCue");
  assert.deepEqual(created, { noteId: 555, appended: false, created: true });
  assert.ok(calls.includes("addNote"));
  assert.ok(!calls.includes("updateNoteFields"));

  calls.length = 0;
  notesInfoResult = [
    { noteId: 555, fields: { Sentence: { value: "old" }, Translation: { value: "" }, Source: { value: "" } } }
  ];
  const appended = await addCardToAnki({ ...card, sentence: "Ein ganz neuer Satz." }, "LexiCue");
  assert.deepEqual(appended, { noteId: 555, appended: true });
  assert.ok(calls.includes("updateNoteFields"));
  assert.ok(!calls.includes("addNote"), "a matched word merges instead of creating a duplicate");
});

// Builds a fetch stub for the create-a-new-note path, letting each test script only the media
// calls it cares about. `calls` records every action so tests can assert what was skipped.
function mockAnki({ calls, mediaNames = [], storeMediaFile }) {
  let storeAttempts = 0;
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.action);
    if (request.action === "storeMediaFile") {
      storeAttempts += 1;
      const outcome = storeMediaFile(storeAttempts, request.params);
      if (outcome instanceof Error) {
        return { ok: true, status: 200, json: async () => ({ result: null, error: outcome.message }) };
      }
      return { ok: true, status: 200, json: async () => ({ result: outcome, error: null }) };
    }
    const results = {
      modelNames: [ANKI_MODEL],
      createDeck: null,
      updateModelTemplates: null,
      updateModelStyling: null,
      modelFieldNames: ANKI_FIELDS,
      notesInfo: [],
      getMediaFilesNames: mediaNames,
      canAddNotes: [true],
      addNote: 999
    };
    return { ok: true, status: 200, json: async () => ({ result: results[request.action], error: null }) };
  };
}

const AUDIO_CARD = {
  word: "Haus",
  definitions: ["house"],
  sentence: "Das ist mein Haus.",
  languageCode: "de",
  audioUrl: "https://upload.wikimedia.org/De-Haus.ogg.mp3"
};

test("pronunciation audio already in the collection is reused instead of downloaded again", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = mockAnki({
    calls,
    mediaNames: ["lexicue-v1-cached.mp3"],
    storeMediaFile: () => new Error("should not download")
  });

  await addCardToAnki(AUDIO_CARD, "LexiCue");
  assert.ok(!calls.includes("storeMediaFile"), "a clip already in the media folder must not be re-fetched");
});

test("the sound tag uses the filename Anki reports back, which it lowercases", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let addedNote = null;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const base = mockAnki({ calls, mediaNames: [], storeMediaFile: () => "lexicue-v1-abc.mp3" });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "addNote") addedNote = request.params.note;
    return base(url, options);
  };

  await addCardToAnki({ ...AUDIO_CARD, audioUrl: "https://upload.wikimedia.org/De-Haus.OGG.MP3" }, "LexiCue");
  assert.equal(addedNote.fields.Audio, "[sound:lexicue-v1-abc.mp3]");
});

test("a rate-limited download is retried before the card gives up on audio", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let addedNote = null;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const base = mockAnki({
    calls,
    mediaNames: [],
    // Wikimedia refuses the first attempt, exactly as it does under a burst of saves.
    storeMediaFile: (attempt) => (attempt === 1 ? new Error("download failed with return code 429") : "lexicue-v1-ok.mp3")
  });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "addNote") addedNote = request.params.note;
    return base(url, options);
  };

  await addCardToAnki(AUDIO_CARD, "LexiCue");
  assert.equal(calls.filter((action) => action === "storeMediaFile").length, 2, "the refused attempt is retried once");
  assert.equal(addedNote.fields.Audio, "[sound:lexicue-v1-ok.mp3]");
});

test("a card still saves when audio cannot be fetched at all", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  const warnings = [];
  let addedNote = null;
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });
  console.warn = (...args) => warnings.push(args.join(" "));
  const base = mockAnki({ calls, mediaNames: [], storeMediaFile: () => new Error("download failed with return code 429") });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "addNote") addedNote = request.params.note;
    return base(url, options);
  };

  const result = await addCardToAnki(AUDIO_CARD, "LexiCue");
  assert.equal(result.created, true, "the note is still created without its pronunciation");
  assert.equal(addedNote.fields.Audio, "");
  assert.match(warnings.join(" "), /could not attach pronunciation audio for "Haus"/, "the failure is reported, not swallowed");
});

test("findLapsedNoteIds queries Anki's native rated:N:1 search and dedupes note ids", async (context) => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    queries.push({ action: request.action, params: request.params });
    const results = { findCards: [10, 11, 12], cardsToNotes: [900, 900, 901] };
    return { ok: true, status: 200, json: async () => ({ result: results[request.action], error: null }) };
  };

  const noteIds = await findLapsedNoteIds("", { deckName: "LexiCue", days: 3 });
  assert.deepEqual(noteIds, [900, 901], "duplicate note ids from cardsToNotes are deduped");
  assert.equal(queries[0].action, "findCards");
  assert.equal(queries[0].params.query, `deck:"LexiCue" note:"${ANKI_MODEL}" rated:3:1`);
  assert.deepEqual(queries[1].params.cards, [10, 11, 12]);
});

test("findLapsedNoteIds short-circuits when nothing was rated Again", async (context) => {
  const originalFetch = globalThis.fetch;
  let cardsToNotesCalled = false;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.action === "cardsToNotes") cardsToNotesCalled = true;
    return { ok: true, status: 200, json: async () => ({ result: [], error: null }) };
  };

  const noteIds = await findLapsedNoteIds();
  assert.deepEqual(noteIds, []);
  assert.equal(cardsToNotesCalled, false, "an empty findCards result skips the follow-up call entirely");
});

test("getLapsedWordStableIds extracts each lapsed note's StableId field", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const results = {
      findCards: [10],
      cardsToNotes: [900],
      notesInfo: [
        { noteId: 900, fields: { StableId: { value: "lexicue-v1-abc123" } } },
        {} // a note AnkiConnect could not find — must not crash the extraction
      ]
    };
    return { ok: true, status: 200, json: async () => ({ result: results[request.action], error: null }) };
  };

  const stableIds = await getLapsedWordStableIds("secret", { deckName: "LexiCue" });
  assert.deepEqual(stableIds, ["lexicue-v1-abc123"]);
});
