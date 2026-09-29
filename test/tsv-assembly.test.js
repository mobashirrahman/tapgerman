import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toAnkiTsvCell } from "../extension/src/anki.js";

// popup.js exportVocabulary is the only producer of the Anki-import TSV; until now only the
// per-cell escaping (toAnkiTsvCell) had tests. The header contract and column order are what
// Anki's file import actually maps against — a reordered or renamed column silently files
// translations under Grammar. These tests execute the real source text from popup.js, so a
// drift in the assembly fails here rather than at import time.
const source = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");

const headerMatch = source.match(/const header = (\[[^\]]+\])/);
assert.ok(headerMatch, "could not find the TSV header assembly in popup.js exportVocabulary");
const header = new Function(`return (${headerMatch[1]})`)();

const rowExprMatch = source.match(/const rows = vocabulary\.map\(\(card\) =>\s*(\[[\s\S]*?\])\s*\.map\(toAnkiTsvCell\)/);
assert.ok(rowExprMatch, "could not find the TSV row assembly in popup.js exportVocabulary");
const rowCells = new Function("card", `return (${rowExprMatch[1]})`);

test("TSV header pins separator, html mode, and the exact Anki column order", () => {
  assert.deepEqual(header, [
    "#separator:Tab",
    "#html:true",
    "#columns:Word\tMeaning\tSentence\tTranslation\tGrammar\tSource\tTags"
  ]);
});

test("rows map the seven columns in header order for a full card", () => {
  const card = {
    word: "Blumen",
    lemma: "Blume",
    definitions: ["flower", "blossom"],
    sentence: "Diese Blumen wachsen hier.",
    translation: "These flowers grow here.",
    grammar: "noun · plural",
    source: "Some Title · 0:12 · https://www.primevideo.com/detail/X",
    languageCode: "de"
  };
  const row = rowCells(card).map(toAnkiTsvCell).join("\t");
  const columns = row.split("\t");
  assert.equal(columns.length, 7);
  assert.deepEqual(columns, [
    "Blumen",
    // Multi-gloss definitions join with \n in the cell value; toAnkiTsvCell turns newlines
    // into <br> because #html:true makes Anki render them.
    "flower<br>blossom",
    "Diese Blumen wachsen hier.",
    "These flowers grow here.",
    "noun · plural",
    "Some Title · 0:12 · https://www.primevideo.com/detail/X",
    "glossline language::de"
  ]);
});

test("a card without structured definitions falls back to the flat meaning", () => {
  const card = { word: "Haus", meaning: "house", languageCode: "de" };
  const columns = rowCells(card).map(toAnkiTsvCell).join("\t").split("\t");
  assert.equal(columns[1], "house");
  assert.equal(columns[2], "");
  assert.equal(columns[6], "glossline language::de");
});

test("a word that could execute as a spreadsheet formula is inert in the export", () => {
  const card = { word: "=1+1", definitions: ["injected"], languageCode: "de" };
  const columns = rowCells(card).map(toAnkiTsvCell).join("\t").split("\t");
  assert.equal(columns[0], "'=1+1");
});
