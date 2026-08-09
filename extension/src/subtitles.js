const TTML_LINE_BREAK = '\uE000';

/**
 * Convert a subtitle/TTML time expression to seconds.
 *
 * Supported forms include SRT/VTT clock times, TTML offset times, and TTML
 * frame/tick expressions. Invalid or negative values return NaN.
 *
 * @param {string|number} value
 * @param {{frameRate?: number, subFrameRate?: number, tickRate?: number}|number} [timingOptions]
 * @returns {number}
 */
function parseTimestamp(value, timingOptions = {}) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
  }

  if (typeof value !== 'string') {
    return Number.NaN;
  }

  const source = value.trim();
  if (!source) {
    return Number.NaN;
  }

  const options =
    typeof timingOptions === 'number'
      ? { frameRate: timingOptions }
      : timingOptions && typeof timingOptions === 'object'
        ? timingOptions
        : {};
  const frameRate = positiveNumber(options.frameRate, 30);
  const subFrameRate = positiveNumber(options.subFrameRate, 1);
  const tickRate = positiveNumber(options.tickRate, 1);

  // TTML clock time with a frame component: hh:mm:ss:frames[.subframes].
  let match = source.match(/^(\d+):([0-5]\d):([0-5]\d):(\d+)(?:\.(\d+))?$/);
  if (match) {
    const frames = Number(match[4]);
    if (frames >= Math.ceil(frameRate)) {
      return Number.NaN;
    }

    const subframe = match[5] ? Number(match[5]) / subFrameRate : 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + (frames + subframe) / frameRate;
  }

  // SRT, VTT, and TTML clock time with hours.
  match = source.match(/^(\d+):([0-5]\d):([0-5]\d)([.,]\d+)?$/);
  if (match) {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + decimalPart(match[4]);
  }

  // VTT's abbreviated mm:ss.mmm form.
  match = source.match(/^(\d+):([0-5]\d)([.,]\d+)?$/);
  if (match) {
    return Number(match[1]) * 60 + Number(match[2]) + decimalPart(match[3]);
  }

  // TTML offset time (hours, minutes, seconds, milliseconds, frames, ticks).
  match = source.match(/^(\d+(?:\.\d+)?|\.\d+)(h|ms|m|s|f|t)$/i);
  if (match) {
    const amount = Number(match[1]);
    switch (match[2].toLowerCase()) {
      case 'h':
        return amount * 3600;
      case 'm':
        return amount * 60;
      case 's':
        return amount;
      case 'ms':
        return amount / 1000;
      case 'f':
        return amount / frameRate;
      case 't':
        return amount / tickRate;
      default:
        return Number.NaN;
    }
  }

  // Plain seconds are useful for already-normalized player data.
  if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(source)) {
    return Number(source);
  }

  return Number.NaN;
}

/**
 * Parse SubRip text into normalized cues.
 *
 * @param {string} input
 * @returns {Array<{start: number, end: number, text: string}>}
 */
function parseSrt(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const lines = normalizeNewlines(input).split('\n');
  const cues = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }

    let timingIndex = index;
    let timing = parseTimingLine(lines[timingIndex]);
    if (!timing && timingIndex + 1 < lines.length) {
      timingIndex += 1;
      timing = parseTimingLine(lines[timingIndex]);
    }

    if (!timing) {
      index += 1;
      continue;
    }

    index = timingIndex + 1;
    const payload = [];

    while (index < lines.length) {
      if (parseTimingLine(lines[index])) {
        break;
      }

      // Accommodate files that omit the blank line between numbered cues.
      if (
        lines[index].trim() &&
        index + 1 < lines.length &&
        parseTimingLine(lines[index + 1]) &&
        payload.length > 0
      ) {
        break;
      }

      if (!lines[index].trim()) {
        let next = index;
        while (next < lines.length && !lines[next].trim()) {
          next += 1;
        }

        if (
          next >= lines.length ||
          parseTimingLine(lines[next]) ||
          (next + 1 < lines.length && parseTimingLine(lines[next + 1]))
        ) {
          index = next;
          break;
        }

        payload.push('');
        index = next;
        continue;
      }

      payload.push(lines[index]);
      index += 1;
    }

    const text = cleanLineBasedCueText(payload.join('\n'));
    if (timing && text && timing.end >= timing.start) {
      cues.push({ start: timing.start, end: timing.end, text });
    }
  }

  return normalizeParsedCues(cues);
}

/**
 * Parse WebVTT text into normalized cues. Header metadata, NOTE, STYLE, and
 * REGION blocks are ignored.
 *
 * @param {string} input
 * @returns {Array<{start: number, end: number, text: string}>}
 */
function parseWebVtt(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const lines = normalizeNewlines(input).split('\n');
  const cues = [];
  let index = 0;

  if (/^WEBVTT(?:[ \t].*)?$/.test(lines[0].trim())) {
    index = 1;
  }

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }

    const blockName = lines[index].trim();
    if (/^NOTE(?:[ \t].*)?$/.test(blockName) || /^(STYLE|REGION)(?:[ \t].*)?$/.test(blockName)) {
      index += 1;
      while (index < lines.length && lines[index].trim()) {
        index += 1;
      }
      continue;
    }

    let timingIndex = index;
    let timing = parseTimingLine(lines[timingIndex]);
    if (!timing && timingIndex + 1 < lines.length) {
      timingIndex += 1;
      timing = parseTimingLine(lines[timingIndex]);
    }

    if (!timing) {
      index += 1;
      continue;
    }

    index = timingIndex + 1;
    const payload = [];
    while (index < lines.length && lines[index].trim()) {
      if (parseTimingLine(lines[index])) {
        break;
      }
      if (index + 1 < lines.length && parseTimingLine(lines[index + 1]) && payload.length > 0) {
        break;
      }
      payload.push(lines[index]);
      index += 1;
    }

    const text = cleanLineBasedCueText(payload.join('\n'));
    if (text && timing.end >= timing.start) {
      cues.push({ start: timing.start, end: timing.end, text });
    }
  }

  return normalizeParsedCues(cues);
}

/**
 * Parse TTML/DFXP text into normalized cues without requiring an XML package.
 * Timing inherited from body/div ancestors, duration expressions, frame rates,
 * nested spans, line breaks, and XML entities are supported.
 *
 * @param {string} input
 * @returns {Array<{start: number, end: number, text: string}>}
 */
function parseTtml(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const source = input.replace(/^\uFEFF/, '');
  const timingOptions = readTtmlTimingOptions(source);
  const tokens = source.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[^>]+>|[^<]+/g) || [];
  const stack = [];
  const cues = [];

  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?') || (token.startsWith('<!') && !token.startsWith('<![CDATA['))) {
      continue;
    }

    if (token.startsWith('<![CDATA[')) {
      appendTtmlText(stack, token.slice(9, -3));
      continue;
    }

    if (!token.startsWith('<')) {
      appendTtmlText(stack, token);
      continue;
    }

    const closing = token.match(/^<\/\s*([\w:.-]+)\s*>$/);
    if (closing) {
      const closingName = localName(closing[1]);
      let matchingIndex = stack.length - 1;
      while (matchingIndex >= 0 && stack[matchingIndex].name !== closingName) {
        matchingIndex -= 1;
      }
      if (matchingIndex < 0) {
        continue;
      }

      while (stack.length > matchingIndex) {
        finalizeTtmlNode(stack.pop(), stack, cues);
      }
      continue;
    }

    const opening = token.match(/^<\s*([\w:.-]+)([\s\S]*?)(\/?)>$/);
    if (!opening) {
      continue;
    }

    const name = localName(opening[1]);
    if (name === 'br') {
      appendTtmlText(stack, TTML_LINE_BREAK);
      continue;
    }

    const attributes = parseXmlAttributes(opening[2]);
    const parent = stack[stack.length - 1] || {
      start: 0,
      end: Number.POSITIVE_INFINITY,
      timeContainer: 'par',
      sequenceCursor: 0,
    };
    const node = createTtmlNode(name, attributes, parent, timingOptions);

    if (opening[3] === '/') {
      finalizeTtmlNode(node, stack, cues);
    } else {
      stack.push(node);
    }
  }

  while (stack.length) {
    finalizeTtmlNode(stack.pop(), stack, cues);
  }

  const normalizedCues = normalizeParsedCues(cues);

  // A begin-only cue naturally runs until the following chronological cue.
  for (let index = 0; index < normalizedCues.length - 1; index += 1) {
    if (!Number.isFinite(normalizedCues[index].end)) {
      normalizedCues[index].end = normalizedCues[index + 1].start;
    }
  }

  return normalizedCues;
}

/**
 * Return the active cue at a time in seconds, or null. Cue ends are exclusive
 * so adjacent cues do not both match at their shared boundary.
 *
 * @param {Array<{start: number, end: number}>} cues
 * @param {number} time
 * @returns {object|null}
 */
function activeCueAt(cues, time) {
  const target = Number(time);
  if (!Array.isArray(cues) || !Number.isFinite(target)) {
    return null;
  }

  let active = null;
  for (const cue of cues) {
    if (!hasValidBounds(cue)) {
      continue;
    }
    if (cue.start <= target && target < cue.end) {
      // Prefer the most recently started cue when source cues overlap.
      if (!active || cue.start > active.start) {
        active = cue;
      }
    }
  }
  return active;
}

/**
 * Find the candidate with the greatest positive temporal overlap with a cue.
 * Equal overlaps are resolved by center-point proximity, then source order.
 *
 * @param {{start: number, end: number}} cue
 * @param {Array<{start: number, end: number}>} candidates
 * @returns {object|null}
 */
function alignCueByOverlap(cue, candidates) {
  if (!hasValidBounds(cue) || !Array.isArray(candidates)) {
    return null;
  }

  const cueCenter = (cue.start + cue.end) / 2;
  let best = null;
  let bestOverlap = 0;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!hasValidBounds(candidate)) {
      continue;
    }

    const overlap = Math.min(cue.end, candidate.end) - Math.max(cue.start, candidate.start);
    if (overlap <= 0) {
      continue;
    }

    const centerDistance = Math.abs((candidate.start + candidate.end) / 2 - cueCenter);
    if (
      overlap > bestOverlap + Number.EPSILON ||
      (Math.abs(overlap - bestOverlap) <= Number.EPSILON && centerDistance < bestCenterDistance)
    ) {
      best = candidate;
      bestOverlap = overlap;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function decimalPart(value) {
  return value ? Number(value.replace(',', '.')) : 0;
}

function normalizeNewlines(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function parseTimingLine(line) {
  if (typeof line !== 'string') {
    return null;
  }

  const match = line.match(/^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/);
  if (!match) {
    return null;
  }

  const start = parseTimestamp(match[1]);
  const end = parseTimestamp(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function cleanLineBasedCueText(value) {
  return decodeEntities(
    value
      .replace(/<br\b[^>]*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\[^}]+}/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00A0',
    quot: '"',
    lrm: '\u200E',
    rlm: '\u200F',
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][\w.-]*);/gi, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1].toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return String.fromCodePoint(codePoint);
      }
      return entity;
    }
    return Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : entity;
  });
}

function parseXmlAttributes(source) {
  const attributes = {};
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] === undefined ? match[3] : match[2]);
  }
  return attributes;
}

function getXmlAttribute(attributes, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(attributes)) {
    if (key === target || key.endsWith(`:${target}`)) {
      return value;
    }
  }
  return undefined;
}

function localName(name) {
  return name.toLowerCase().split(':').pop();
}

function readTtmlTimingOptions(source) {
  const root = source.match(/<(?:[\w.-]+:)?tt\b([\s\S]*?)>/i);
  const attributes = root ? parseXmlAttributes(root[1]) : {};
  const frameRateValue = getXmlAttribute(attributes, 'frameRate');
  const parsedFrameRate = Number(frameRateValue);
  const hasExplicitFrameRate = Number.isFinite(parsedFrameRate) && parsedFrameRate > 0;
  const nominalFrameRate = hasExplicitFrameRate ? parsedFrameRate : 30;
  const multiplierValue = getXmlAttribute(attributes, 'frameRateMultiplier');
  let multiplier = 1;

  if (multiplierValue) {
    const parts = multiplierValue.trim().split(/\s+/).map(Number);
    if (parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)) {
      multiplier = parts[0] / parts[1];
    }
  }

  const frameRate = nominalFrameRate * multiplier;
  const subFrameRate = positiveNumber(getXmlAttribute(attributes, 'subFrameRate'), 1);
  const defaultTickRate = hasExplicitFrameRate ? frameRate * subFrameRate : 1;
  const tickRate = positiveNumber(getXmlAttribute(attributes, 'tickRate'), defaultTickRate);
  return { frameRate, subFrameRate, tickRate };
}

function createTtmlNode(name, attributes, parent, timingOptions) {
  const parentIsSequence = parent.timeContainer === 'seq';
  const base = parentIsSequence ? parent.sequenceCursor : parent.start;
  const beginValue = getXmlAttribute(attributes, 'begin');
  const endValue = getXmlAttribute(attributes, 'end');
  const durationValue = getXmlAttribute(attributes, 'dur');
  const parsedBegin = beginValue === undefined ? Number.NaN : parseTimestamp(beginValue, timingOptions);
  const parsedEnd = endValue === undefined ? Number.NaN : parseTimestamp(endValue, timingOptions);
  const parsedDuration = durationValue === undefined ? Number.NaN : parseTimestamp(durationValue, timingOptions);
  const start = Number.isFinite(parsedBegin) ? base + parsedBegin : base;
  const explicitEnds = [];
  if (Number.isFinite(parsedEnd)) explicitEnds.push(base + parsedEnd);
  if (Number.isFinite(parsedDuration)) explicitEnds.push(start + parsedDuration);
  let end = explicitEnds.length ? Math.min(...explicitEnds) : parent.end;
  if (Number.isFinite(parent.end)) {
    end = Math.min(end, parent.end);
  }

  return {
    name,
    start,
    end,
    timeContainer: (getXmlAttribute(attributes, 'timeContainer') || 'par').toLowerCase(),
    sequenceCursor: start,
    cueParts: name === 'p' ? [] : null,
  };
}

function appendTtmlText(stack, value) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].cueParts) {
      stack[index].cueParts.push(value);
      return;
    }
  }
}

function finalizeTtmlNode(node, stack, cues) {
  if (node.cueParts) {
    const text = node.cueParts
      .join('')
      .split(TTML_LINE_BREAK)
      .map((part) => decodeEntities(part).replace(/\s+/g, ' ').trim())
      .join('\n')
      .trim();

    if (text && Number.isFinite(node.start) && node.start >= 0 && node.end >= node.start) {
      cues.push({ start: node.start, end: node.end, text });
    }
  }

  const parent = stack[stack.length - 1];
  if (parent && parent.timeContainer === 'seq') {
    parent.sequenceCursor = node.end;
  }
}

function hasValidBounds(cue) {
  return (
    cue !== null &&
    typeof cue === 'object' &&
    Number.isFinite(cue.start) &&
    (Number.isFinite(cue.end) || cue.end === Number.POSITIVE_INFINITY) &&
    cue.end >= cue.start
  );
}

function normalizeParsedCues(cues) {
  return cues
    .filter(
      (cue) =>
        hasValidBounds(cue) &&
        typeof cue.text === 'string' &&
        cue.text.trim().length > 0,
    )
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      if (left.end === right.end) return 0;
      return left.end < right.end ? -1 : 1;
    });
}

export {
  parseTimestamp,
  parseSrt,
  parseWebVtt,
  parseTtml,
  activeCueAt,
  alignCueByOverlap,
};
