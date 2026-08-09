import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { diffWords } from "../extension/src/dictation.js";

test("marks every word correct on an exact match", () => {
  const words = ["Ich", "gehe", "zur", "Schule"];
  assert.deepEqual(
    diffWords(words, words),
    words.map((word) => ({ type: "match", actual: word, typed: word }))
  );
});

test("a missing middle word does not cascade into false mismatches after it", () => {
  const result = diffWords(["Ich", "gehe", "Schule"], ["Ich", "gehe", "zur", "Schule"]);
  assert.deepEqual(result, [
    { type: "match", actual: "Ich", typed: "Ich" },
    { type: "match", actual: "gehe", typed: "gehe" },
    { type: "missing", actual: "zur" },
    { type: "match", actual: "Schule", typed: "Schule" }
  ]);
});

test("an extra typed word is flagged without misaligning the rest", () => {
  const result = diffWords(["Ich", "gehe", "jetzt", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]);
  assert.deepEqual(result, [
    { type: "match", actual: "Ich", typed: "Ich" },
    { type: "match", actual: "gehe", typed: "gehe" },
    { type: "extra", typed: "jetzt" },
    { type: "match", actual: "zur", typed: "zur" },
    { type: "match", actual: "Schule", typed: "Schule" }
  ]);
});

test("a single-word substitution shows as a delete+insert pair — expected LCS behavior, not a bug", () => {
  const result = diffWords(["Ich", "fahre", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]);
  assert.deepEqual(result, [
    { type: "match", actual: "Ich", typed: "Ich" },
    { type: "extra", typed: "fahre" },
    { type: "missing", actual: "gehe" },
    { type: "match", actual: "zur", typed: "zur" },
    { type: "match", actual: "Schule", typed: "Schule" }
  ]);
});

test("empty typed input shows every actual word as missing", () => {
  assert.deepEqual(diffWords([], ["Ich", "gehe"]), [
    { type: "missing", actual: "Ich" },
    { type: "missing", actual: "gehe" }
  ]);
});

test("matches case-insensitively but keeps a distinct wrong-case state", () => {
  assert.deepEqual(diffWords(["ich", "GEHE"], ["Ich", "gehe"]), [
    { type: "wrong-case", actual: "Ich", typed: "ich" },
    { type: "wrong-case", actual: "gehe", typed: "GEHE" }
  ]);
});

test("handles empty actual text without throwing", () => {
  assert.deepEqual(diffWords(["Hallo"], []), [{ type: "extra", typed: "Hallo" }]);
  assert.deepEqual(diffWords([], []), []);
});

// content.js is a classic script and cannot import from src/, so it carries a hand-copied twin of
// diffWords (the same arrangement the codebase already uses for activeCueAt). Copies drift
// silently, so this pins the two implementations together: edit one without the other and this
// fails rather than shipping a subtly different diff to the overlay.
test("the content.js copy of the diff behaves identically to this module", async () => {
  const source = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const match = source.match(/function diffDictationWords\(typedWords, actualWords\) \{[\s\S]*?\n {2}\}/);
  assert.ok(
    match,
    "could not find diffDictationWords() in content.js — if it was renamed or removed, update this guard so the two diff implementations stay pinned together"
  );
  const contentCopy = new Function(`return (${match[0]})`)();

  const cases = [
    [["Ich", "gehe", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "gehe", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "gehe", "jetzt", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "fahre", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["ich", "GEHE"], ["Ich", "gehe"]],
    [[], ["Ich", "gehe"]],
    [["Hallo"], []],
    [["Diese", "wachsen", "im", "Garten"], ["Diese", "Blumen", "wachsen", "in", "einem", "Garten"]]
  ];
  for (const [typed, actual] of cases) {
    assert.deepEqual(
      contentCopy(typed, actual),
      diffWords(typed, actual),
      `content.js diff drifted from src/dictation.js for typed=${JSON.stringify(typed)}`
    );
  }
});
