// Draws the LexiCue toolbar/store icons from scratch so the repository needs no binary design
// source and no image dependency. Run `npm run icons` after changing the artwork below.
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { crc32 } from "./lib/crc32.js";

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const OUT_DIR = new URL("../extension/icons/", import.meta.url);

const BACKGROUND_TOP = [30, 41, 74];
const BACKGROUND_BOTTOM = [17, 22, 41];
const LEARNING_LINE = [245, 196, 81];
const NATIVE_LINE = [186, 199, 226];

/** Signed distance from a point to a rounded rectangle, in canvas units. */
function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const halfWidth = (right - left) / 2;
  const halfHeight = (bottom - top) / 2;
  const clampedRadius = Math.min(radius, halfWidth, halfHeight);
  const dx = Math.abs(x - (left + right) / 2) - (halfWidth - clampedRadius);
  const dy = Math.abs(y - (top + bottom) / 2) - (halfHeight - clampedRadius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - clampedRadius;
}

function blend(base, layer, alpha) {
  return [
    Math.round(base[0] + (layer[0] - base[0]) * alpha),
    Math.round(base[1] + (layer[1] - base[1]) * alpha),
    Math.round(base[2] + (layer[2] - base[2]) * alpha)
  ];
}

/** Colour of one supersampled point, in a 0..1 unit square. Returns [r, g, b, a]. */
function samplePixel(u, v) {
  const inBackground = roundedRectDistance(u, v, 0.02, 0.02, 0.98, 0.98, 0.24) <= 0;
  if (!inBackground) return [0, 0, 0, 0];

  let colour = blend(BACKGROUND_TOP, BACKGROUND_BOTTOM, v);

  // Upper (learning-language) subtitle line, drawn wider and brighter than the native line.
  if (roundedRectDistance(u, v, 0.16, 0.34, 0.84, 0.47, 0.065) <= 0) {
    colour = LEARNING_LINE;
  }
  // Lower (native-language) subtitle line.
  if (roundedRectDistance(u, v, 0.28, 0.56, 0.72, 0.67, 0.055) <= 0) {
    colour = NATIVE_LINE;
  }
  // The clicked word: a gap punched out of the upper line, filled by a highlight block below it.
  if (roundedRectDistance(u, v, 0.5, 0.31, 0.66, 0.5, 0.045) <= 0) {
    colour = blend(BACKGROUND_TOP, LEARNING_LINE, 0.28);
  }
  if (roundedRectDistance(u, v, 0.52, 0.335, 0.64, 0.475, 0.035) <= 0) {
    colour = LEARNING_LINE;
  }

  return [...colour, 255];
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x * SUPERSAMPLE + sx + 0.5) * step;
          const v = (y * SUPERSAMPLE + sy + 0.5) * step;
          const [sr, sg, sb, sa] = samplePixel(u, v);
          const weight = sa / 255;
          r += sr * weight;
          g += sg * weight;
          b += sb * weight;
          a += sa;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const coverage = a / (samples * 255);
      const offset = (y * size + x) * 4;
      // Un-premultiply so partly covered edge pixels keep their colour instead of going dark.
      pixels[offset] = coverage > 0 ? Math.round(r / (coverage * samples)) : 0;
      pixels[offset + 1] = coverage > 0 ? Math.round(g / (coverage * samples)) : 0;
      pixels[offset + 2] = coverage > 0 ? Math.round(b / (coverage * samples)) : 0;
      pixels[offset + 3] = Math.round(coverage * 255);
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

await mkdir(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = new URL(`icon-${size}.png`, OUT_DIR);
  await writeFile(file, encodePng(size, renderRgba(size)));
  console.log(`Wrote extension/icons/icon-${size}.png`);
}
