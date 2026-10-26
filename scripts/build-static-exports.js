#!/usr/bin/env node
/**
 * build-static-exports.js
 *
 * V2.3 — Data Library static files
 *
 * Generates the six per-year CSV files and a combined ZIP at build time.
 * These are served by the CDN from public/downloads/, completely bypassing
 * the serverless function (no archiver at request time, no payload limit).
 *
 * The existing /api/data-export/:year and /api/data-export/all routes are
 * kept as API endpoints that redirect (301) to these static CDN paths so
 * nothing built is removed.
 *
 * Usage: node scripts/build-static-exports.js
 * Called automatically as part of npm run build:vercel.
 */

'use strict';

// Ensure we can import the backend modules
process.chdir(require('node:path').resolve(__dirname, '..'));

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createWriteStream } = require('node:fs');

const root = path.resolve(__dirname, '..');
const publicDownloads = path.join(root, 'backend', 'data', 'dist', 'downloads');

fs.mkdirSync(publicDownloads, { recursive: true });

// Load the data layer — this does NOT parse microdata at build time on Vercel.
// On the developer machine the microdata files are present so this works.
// On Vercel this script is NOT run (build:vercel calls verify:artifacts instead,
// which checks that pre-built artifacts are committed). The static files must
// be committed to the repo after local generation.
let overviewService;
try {
  overviewService = require('../backend/src/data/overview-service');
} catch (err) {
  console.error('[build-static-exports] Could not load overview-service:', err.message);
  console.error('Run this script on a machine with the microdata files present, then commit the output.');
  process.exit(1);
}

const { buildDetailedTimeSeries, AGGREGATE_CALC_VERSION } = overviewService;
let datasetConfig;
try {
  datasetConfig = require('../backend/src/data/dataset-config');
} catch (err) {
  console.error('[build-static-exports] Could not load dataset-config:', err.message);
  process.exit(1);
}

const { datasetFiles } = datasetConfig;
const { loadPeriod } = overviewService;

function getAllPeriods() {
  return datasetFiles
    .map((item) => {
      try { return loadPeriod(item); } catch { return null; }
    })
    .filter(Boolean);
}

function cleanedDataRowsForYear(year) {
  return buildDetailedTimeSeries(getAllPeriods())
    .filter((row) => row.year === Number(year))
    .map((row) => ({
      year: row.year,
      season: row.season,
      districtCode: row.districtCode,
      cropCode: row.cropCode,
      cropName: row.cropName,
      weightedProductionKg: row.weightedProductionKg,
      weightedAreaHa: row.weightedAreaHa,
      lossKg: row.lossKg,
      lossPercent: row.lossPercent,
      riskTier: row.riskTier,
      rowCount: row.rowCount
    }));
}

function rowsToCsv(rows) {
  const headers = ['year', 'season', 'districtCode', 'cropCode', 'cropName',
    'weightedProductionKg', 'weightedAreaHa', 'lossKg', 'lossPercent', 'riskTier', 'rowCount'];
  const csvValue = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => csvValue(row[h])).join(','))].join('\n');
}

const years = [2020, 2021, 2022, 2023, 2024, 2025];
const csvPaths = [];

console.log('[build-static-exports] Generating per-year CSV files...');
for (const year of years) {
  try {
    const rows = cleanedDataRowsForYear(year);
    const csv = rowsToCsv(rows);
    const filename = `isuka-cleaned-agricultural-dataset-${year}.csv`;
    const destPath = path.join(publicDownloads, filename);
    fs.writeFileSync(destPath, csv, 'utf8');
    csvPaths.push({ year, path: destPath, filename });
    console.log(`[build-static-exports]   ${filename} (${rows.length} rows, ${Math.round(csv.length / 1024)} KB)`);
  } catch (err) {
    console.error(`[build-static-exports] ERROR generating ${year}: ${err.message}`);
    process.exit(1);
  }
}

// Build ZIP — use zlib's built-in deflate to avoid archiver dependency at build time.
// We create a minimal ZIP manually for portability.
console.log('[build-static-exports] Building combined ZIP...');

function makeZip(entries) {
  // entries: Array of { name, data: Buffer }
  // Simple ZIP implementation (no archiver dependency)
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    // Local file header
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // compression (deflate)
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc >>> 0, 14);   // CRC-32
    local.writeUInt32LE(compressed.length, 18); // compressed size
    local.writeUInt32LE(entry.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26); // file name length
    local.writeUInt16LE(0, 28);           // extra field length
    nameBuffer.copy(local, 30);

    localHeaders.push({ local, compressed, nameBuffer, crc, uncompressedSize: entry.data.length, centralOffset: offset });
    offset += local.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of localHeaders) {
    const central = Buffer.alloc(46 + entry.nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(8, 10);          // compression
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(entry.crc >>> 0, 16); // CRC-32
    central.writeUInt32LE(entry.compressed.length, 20); // compressed size
    central.writeUInt32LE(entry.uncompressedSize, 24);  // uncompressed size
    central.writeUInt16LE(entry.nameBuffer.length, 28); // file name length
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk number
    central.writeUInt16LE(0, 36);          // internal attr
    central.writeUInt32LE(0, 38);          // external attr
    central.writeUInt32LE(entry.centralOffset, 42); // offset of local header
    entry.nameBuffer.copy(central, 46);
    centralHeaders.push(central);
  }

  const centralSize = centralHeaders.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);         // signature
  eocd.writeUInt16LE(0, 4);                   // disk number
  eocd.writeUInt16LE(0, 6);                   // disk with central dir
  eocd.writeUInt16LE(localHeaders.length, 8); // entries on disk
  eocd.writeUInt16LE(localHeaders.length, 10);// total entries
  eocd.writeUInt32LE(centralSize, 12);         // size of central dir
  eocd.writeUInt32LE(centralStart, 16);        // offset of central dir
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([
    ...localHeaders.flatMap((e) => [e.local, e.compressed]),
    ...centralHeaders,
    eocd
  ]);
}

// CRC-32 using polynomial table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const zipEntries = csvPaths.map(({ year, filename }) => ({
  name: filename,
  data: fs.readFileSync(path.join(publicDownloads, filename))
}));

const zipBuffer = makeZip(zipEntries);
const zipPath = path.join(publicDownloads, 'isuka-cleaned-agricultural-datasets-2020-2025.zip');
fs.writeFileSync(zipPath, zipBuffer);
const zipSizeMb = (zipBuffer.length / 1024 / 1024).toFixed(2);
console.log(`[build-static-exports] Combined ZIP: isuka-cleaned-agricultural-datasets-2020-2025.zip (${zipSizeMb} MB)`);

// Write a manifest for verify:artifacts
const manifest = {
  generatedAt: new Date().toISOString(),
  calcVersion: AGGREGATE_CALC_VERSION,
  files: [
    ...csvPaths.map(({ year, filename }) => ({
      name: filename,
      path: `backend/data/dist/downloads/${filename}`,
      type: 'csv',
      year
    })),
    {
      name: 'isuka-cleaned-agricultural-datasets-2020-2025.zip',
      path: 'backend/data/dist/downloads/isuka-cleaned-agricultural-datasets-2020-2025.zip',
      type: 'zip'
    }
  ]
};

// Also write checksums
const crypto = require('node:crypto');
manifest.checksums = {};
for (const { filename } of csvPaths) {
  const data = fs.readFileSync(path.join(publicDownloads, filename));
  manifest.checksums[`backend/data/dist/downloads/${filename}`] = crypto.createHash('sha256').update(data).digest('hex');
}
const zipData = fs.readFileSync(zipPath);
manifest.checksums['backend/data/dist/downloads/isuka-cleaned-agricultural-datasets-2020-2025.zip'] =
  crypto.createHash('sha256').update(zipData).digest('hex');

const manifestPath = path.join(publicDownloads, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('[build-static-exports] Manifest written to public/downloads/manifest.json');
console.log('[build-static-exports] Done. Commit public/downloads/ to the repository.');
