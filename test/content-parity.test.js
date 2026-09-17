import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activeCueAt } from "../extension/src/subtitles.js";
import { diffWords } from "../extension/src/dictation.js";

// content.js is a classic script (isolated world) and cannot import from src/, so it carries
// hand-copied twins of activeCueAt and diffDictationWords. Copies drift silently — this file
// pins every copy to its src/ original over a fixed vector so an edit to one without the other
// fails here instead of shipping subtly different behavior to the overlay.
function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n {2}\\}`));
  assert.ok(match, `could not find ${name}() in content.js — if it was renamed or removed, update this guard so the copy stays pinned to its src/ original`);
  return new Function(`return (${match[0]})`)();
}

const contentSource = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
const contentActiveCueAt = extractFunction(contentSource, "activeCueAt");
const contentDiffWords = extractFunction(contentSource, "diffDictationWords");

// Unsorted, overlapping, boundary-sharing, and degenerate cues. Every case exercises a
// semantic that differs between the old sorted-input scan and the canonical copy: the `break`
// on a later-starting cue, end-exclusivity at shared boundaries, Infinity ends, and invalid
// bounds that must be skipped rather than poison the scan.
const cueVectors = [
  [[], 0],
  [[{ start: 0, end: 2, text: "a" }], 1],
  [[{ start: 0, end: 2, text: "a" }], 2],
  [[{ start: 0, end: 2, text: "a" }], -1],
  [
    [
      { start: 0, end: 2, text: "a" },
      { start: 2, end: 4, text: "b" }
    ],
    2
  ],
  [
    [
      { start: 2, end: 4, text: "b" },
      { start: 0, end: 2, text: "a" }
    ],
    3
  ],
  [
    [
      { start: 0, end: 4, text: "wide" },
      { start: 2, end: 3, text: "narrow" }
    ],
    2.5
  ],
  [
    [
      { start: 0, end: 10, text: "a" },
      { start: 1, end: 2, text: "b" }
    ],
    1.5
  ],
  [
    [
      { start: 0, end: Number.POSITIVE_INFINITY, text: "forever" },
      { start: 1, end: 2, text: "brief" }
    ],
    5
  ],
  [
    [
      { start: Number.NEGATIVE_INFINITY, end: 0, text: "bad" },
      { start: 0, end: 2, text: "good" }
    ],
    1
  ],
  [
    [
      { start: 1, end: 0, text: "reversed" },
      { start: 0, end: 2, text: "valid" }
    ],
    1
  ],
  [
    [
      null,
      { start: Number.NaN, end: 2, text: "nan" },
      { start: 0, end: Number.NaN, text: "nan-end" },
      { start: 0, end: 2, text: "kept" }
    ],
    1
  ],
  [
    [
      { start: 20, end: 30, text: "future" },
      { start: 10, end: 15, text: "current" }
    ],
    12
  ],
  [
    [
      { start: 0, end: 2, text: "a" },
      { start: 10, end: 20, text: "later" }
    ],
    5
  ],
  [
    [
      { start: 0, end: 2, text: "a" },
      { start: 10, end: 20, text: "later" }
    ],
    Number.NaN
  ],
  [
    [
      { start: 0, end: 2, text: "a" },
      { start: 10, end: 20, text: "later" }
    ],
    "not-a-number"
  ]
];

test("the content.js copy of activeCueAt behaves identically to src/subtitles.js", () => {
  for (const [cues, time] of cueVectors) {
    assert.equal(
      contentActiveCueAt(cues, time),
      activeCueAt(cues, time),
      `content.js activeCueAt drifted from src/subtitles.js for time=${String(time)}`
    );
  }
  // The old copy's break-on-first-later-start dropped a matching cue that followed a
  // future-dated cue in unsorted input; assert the canonical semantics directly so the
  // failure reads as intent, not coincidence.
  const unsorted = [
    { start: 20, end: 30, text: "future" },
    { start: 10, end: 15, text: "current" }
  ];
  assert.equal(contentActiveCueAt(unsorted, 12).text, "current");
});

test("the content.js copy of the diff behaves identically to src/dictation.js", () => {
  const cases = [
    [["Ich", "gehe", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "gehe", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "gehe", "jetzt", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["Ich", "fahre", "zur", "Schule"], ["Ich", "gehe", "zur", "Schule"]],
    [["ich", "GEHE"], ["Ich", "gehe"]],
    [[], ["Ich", "gehe"]],
    [["Hallo"], []],
    [[], []],
    [["Diese", "wachsen", "im", "Garten"], ["Diese", "Blumen", "wachsen", "in", "einem", "Garten"]]
  ];
  for (const [typed, actual] of cases) {
    assert.deepEqual(
      contentDiffWords(typed, actual),
      diffWords(typed, actual),
      `content.js diff drifted from src/dictation.js for typed=${JSON.stringify(typed)}`
    );
  }
});
