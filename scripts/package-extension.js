// Builds the Chrome Web Store upload zip from extension/ with no third-party dependency and no
// reliance on a `zip` binary, so local packaging and CI packaging produce the same archive.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "./lib/crc32.js";

const EXTENSION_ROOT = new URL("../extension/", import.meta.url);
const DIST_DIR = new URL("../dist/", import.meta.url);
const EXCLUDED = new Set([".DS_Store", "Thumbs.db", "demo.html", "demo.js", "demo.css"]);

// Zip entries need a timestamp; a fixed one keeps the archive byte-identical between builds.
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // 2020-01-01

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(fileURLToPath(directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED.has(entry.name)) continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(new URL(`${entry.name}/`, directory), `${path}/`)));
    } else if (entry.isFile()) {
      files.push({ path, data: await readFile(new URL(path, EXTENSION_ROOT)) });
    }
  }
  return files;
}

function localHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  return Buffer.concat([header, entry.name, entry.compressed]);
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(8, 10); // deflate
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: regular file, rw-r--r--
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function buildZip(files) {
  const entries = [];
  const chunks = [];
  let offset = 0;
  for (const file of files) {
    const entry = {
      name: Buffer.from(file.path, "utf8"),
      data: file.data,
      compressed: deflateRawSync(file.data, { level: 9 }),
      crc: crc32(file.data),
      offset
    };
    const local = localHeader(entry);
    chunks.push(local);
    offset += local.length;
    entries.push(entry);
  }

  const central = Buffer.concat(entries.map(centralHeader));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

const manifest = JSON.parse(await readFile(new URL("manifest.json", EXTENSION_ROOT), "utf8"));
const files = await collectFiles(EXTENSION_ROOT);
if (!files.some((file) => file.path === "manifest.json")) {
  throw new Error("extension/manifest.json is missing; refusing to build an unloadable archive.");
}
// Chrome's loader reads manifest.json before anything else; listing it first keeps the archive
// valid even in unzip tools that stream local headers without seeking to the central directory.
files.sort((left, right) => {
  if (left.path === "manifest.json") return -1;
  if (right.path === "manifest.json") return 1;
  return left.path.localeCompare(right.path);
});

await mkdir(fileURLToPath(DIST_DIR), { recursive: true });
const outputName = `tapgerman-${manifest.version}.zip`;
const zip = buildZip(files);
await writeFile(new URL(outputName, DIST_DIR), zip);

// Store review rejects archives whose central directory drifts from the local entries, and
// Chrome unzips manifest.json first — so the built artifact is read back and checked rather
// than trusted from the buffers we just wrote.
{
  const names = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const compressedLength = zip.readUInt32LE(offset + 18);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + compressedLength;
  }
  if (names[0] !== "manifest.json") {
    throw new Error(`manifest.json must be the first zip entry (store requirement); got ${names[0]}.`);
  }
  if (names.length !== files.length) {
    throw new Error(`Zip has ${names.length} entries but ${files.length} files were collected.`);
  }
  const expected = files.map((file) => file.path).sort();
  if (expected.some((path, index) => path !== names.sort()[index])) {
    throw new Error("Zip entries do not match the collected file list.");
  }
}

console.log(`Packaged ${files.length} files into dist/${outputName} (${(zip.length / 1024).toFixed(1)} KB).`);
