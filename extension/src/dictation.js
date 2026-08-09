function wordsEqualCaseInsensitive(a, b) {
  return String(a).toLocaleLowerCase() === String(b).toLocaleLowerCase();
}

/**
 * Word-level diff between what the user typed and the actual cue text, both already reduced to
 * word-like tokens (no punctuation/whitespace tokens — those would otherwise register as spurious
 * mismatches, e.g. a missing comma). Uses a longest-common-subsequence alignment rather than a
 * positional compare, so a single missed or extra word does not misalign everything after it.
 *
 * Matches are case-insensitive for the correct/incorrect verdict (a typed answer matching German
 * noun capitalization by accident is unlikely, so treating a case mismatch as simply "wrong" would
 * hide a real, usually-heard-correctly result) but the two states are kept distinct: "match" is an
 * exact match, "wrong-case" is the same word heard correctly but capitalized differently.
 *
 * Returns entries in reading order: { type: "match" | "wrong-case", actual, typed },
 * { type: "missing", actual } for an actual word the user never typed, or { type: "extra", typed }
 * for a typed word with no corresponding actual word.
 */
export function diffWords(typedWords, actualWords) {
  const typed = Array.isArray(typedWords) ? typedWords : [];
  const actual = Array.isArray(actualWords) ? actualWords : [];
  const rows = typed.length;
  const cols = actual.length;

  const lcs = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      lcs[i][j] = wordsEqualCaseInsensitive(typed[i - 1], actual[j - 1])
        ? lcs[i - 1][j - 1] + 1
        : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  const result = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsEqualCaseInsensitive(typed[i - 1], actual[j - 1])) {
      const exact = typed[i - 1] === actual[j - 1];
      result.push({ type: exact ? "match" : "wrong-case", actual: actual[j - 1], typed: typed[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.push({ type: "missing", actual: actual[j - 1] });
      j -= 1;
    } else {
      result.push({ type: "extra", typed: typed[i - 1] });
      i -= 1;
    }
  }
  result.reverse();
  return result;
}
