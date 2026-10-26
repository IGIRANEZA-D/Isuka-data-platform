#!/usr/bin/env node
/**
 * verify-artifacts.js — V2.1 gate
 *
 * Verifies that all committed/built artifacts are present and match their
 * recorded checksums. This runs as part of `npm run build:vercel` so a
 * bad or missing artifact fails the build instead of the live site.
 *
 * Also checks that no respondent-level fields appear in the committed files.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function pass(msg) { console.log(`  ✓ ${msg}`); passed++; }
function fail(msg) { console.error(`  ✗ ${msg}`); failed++; }

// ─── 1. forecast-cache.json ──────────────────────────────────────────────────
console.log('\n[verify:artifacts] forecast-cache.json');
const forecastCachePath = path.join(root, 'backend', 'data', 'forecast-cache.json');
if (!fs.existsSync(forecastCachePath)) {
  fail('backend/data/forecast-cache.json is missing. Run scripts/forecasting_pipeline.py on a machine with microdata, then commit the output.');
} else {
  try {
    const cache = JSON.parse(fs.readFileSync(forecastCachePath, 'utf8'));
    if (!cache.forecasts || !Array.isArray(cache.forecasts)) fail('forecast-cache.json missing forecasts array');
    else pass(`forecast-cache.json present (${cache.forecasts.length} entries, generatedAt ${cache.generatedAt || 'unknown'})`);
  } catch (err) {
    fail(`forecast-cache.json parse error: ${err.message}`);
  }
}

// ─── 2. landing-art.json ─────────────────────────────────────────────────────
console.log('\n[verify:artifacts] landing-art.json');
const landingArtPath = path.join(root, 'frontend', 'data', 'landing-art.json');
if (!fs.existsSync(landingArtPath)) {
  fail('frontend/data/landing-art.json is missing. Run scripts/build-landing-art.js, then commit the output.');
} else {
  try {
    const art = JSON.parse(fs.readFileSync(landingArtPath, 'utf8'));
    if (!Array.isArray(art.districts) || art.districts.length !== 30) {
      fail(`landing-art.json should have 30 districts; found ${art.districts?.length || 0}`);
    } else {
      pass(`landing-art.json present (${art.districts.length} districts)`);
    }
  } catch (err) {
    fail(`landing-art.json parse error: ${err.message}`);
  }
}

// ─── 3. loss-planner-cache.json ──────────────────────────────────────────────
console.log('\n[verify:artifacts] loss-planner-cache.json');
const lossPlannerCachePath = path.join(root, 'backend', 'data', 'loss-planner-cache.json');
if (!fs.existsSync(lossPlannerCachePath)) {
  fail('backend/data/loss-planner-cache.json is missing.');
} else {
  try {
    const cache = JSON.parse(fs.readFileSync(lossPlannerCachePath, 'utf8'));
    if (!Array.isArray(cache.periods)) fail('loss-planner-cache.json missing periods array');
    else pass(`loss-planner-cache.json present (${cache.periods.length} periods)`);
  } catch (err) {
    fail(`loss-planner-cache.json parse error: ${err.message}`);
  }
}

// ─── 4. default-overview-cache.json ──────────────────────────────────────────
console.log('\n[verify:artifacts] default-overview-cache.json');
const overviewCachePath = path.join(root, 'backend', 'data', 'default-overview-cache.json');
if (!fs.existsSync(overviewCachePath)) {
  fail('backend/data/default-overview-cache.json is missing.');
} else {
  try {
    const cache = JSON.parse(fs.readFileSync(overviewCachePath, 'utf8'));
    if (!cache.overview || !cache.calcVersion) fail('default-overview-cache.json missing overview or calcVersion');
    else pass(`default-overview-cache.json present (calcVersion: ${cache.calcVersion || cache.overview?.calcVersion})`);
  } catch (err) {
    fail(`default-overview-cache.json parse error: ${err.message}`);
  }
}

// ─── 5. Aggregate shards and their manifest ──────────────────────────────────
console.log('\n[verify:artifacts] backend/data/dist/');
const distDir = path.join(root, 'backend', 'data', 'dist');
const distManifestPath = path.join(distDir, 'manifest.json');
const expectedCalcVersion = require('../backend/src/data/overview-service').AGGREGATE_CALC_VERSION;
const expectedLossPlannerVersion = require('../backend/src/data/loss-planner-service').LOSS_PLANNER_CALC_VERSION;
let distManifest;
if (!fs.existsSync(distManifestPath)) {
  fail('backend/data/dist/manifest.json is missing. Run npm run build:data locally and commit the aggregate artifacts.');
} else {
  try {
    distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
    if (distManifest.calcVersion !== expectedCalcVersion) fail(`manifest calcVersion mismatch: expected ${expectedCalcVersion}`);
    else pass(`aggregate manifest calcVersion: ${expectedCalcVersion}`);
    for (const [name, metadata] of Object.entries(distManifest.files || {})) {
      const artifactPath = name.startsWith('frontend/')
        ? path.join(root, name)
        : path.resolve(distDir, name);
      if (!fs.existsSync(artifactPath)) {
        fail(`${name} is missing`);
        continue;
      }
      const contents = fs.readFileSync(artifactPath);
      const actualHash = crypto.createHash('sha256').update(contents).digest('hex');
      if (actualHash !== distManifest.checksums?.[name]) fail(`${name}: checksum mismatch`);
      else pass(`${name}: checksum OK (${Math.round(contents.length / 1024)} KB)`);
      if (name.startsWith('periods/')) {
        const period = JSON.parse(contents.toString('utf8'));
        if (period.calcVersion !== expectedCalcVersion) fail(`${name}: calcVersion mismatch`);
        if (!period.aggregate || !Number.isInteger(period.rowCount)) fail(`${name}: aggregate payload is incomplete`);
      }
      if (name.startsWith('loss-planner/')) {
        const period = JSON.parse(contents.toString('utf8'));
        if (period.calcVersion !== expectedLossPlannerVersion || !period.entry?.period) fail(`${name}: loss-planner artifact version or payload mismatch`);
      }
      if (metadata.bytes !== contents.length) fail(`${name}: byte length mismatch`);
    }
  } catch (err) {
    fail(`Aggregate manifest error: ${err.message}`);
  }
}

// ─── 6. Static Data Library files ────────────────────────────────────────────
console.log('\n[verify:artifacts] backend/data/dist/downloads/');
const downloadsDir = path.join(distDir, 'downloads');
const manifestPath = path.join(downloadsDir, 'manifest.json');

if (!fs.existsSync(downloadsDir)) {
  fail('public/downloads/ directory is missing. Run npm run build:static-exports on a machine with microdata, then commit the output.');
} else if (!fs.existsSync(manifestPath)) {
  fail('public/downloads/manifest.json is missing.');
} else {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Check calcVersion is consistent
    const calcVersion = manifest.calcVersion;
    if (!calcVersion) {
      fail('manifest.json missing calcVersion');
    } else {
      pass(`manifest.json calcVersion: ${calcVersion}`);
    }

    // Verify each file
    const years = [2020, 2021, 2022, 2023, 2024, 2025];
    for (const year of years) {
      const filename = `isuka-cleaned-agricultural-dataset-${year}.csv`;
      const filePath = path.join(downloadsDir, filename);
      const manifestKey = `backend/data/dist/downloads/${filename}`;
      if (!fs.existsSync(filePath)) {
        fail(`${filename} is missing`);
        continue;
      }
      const data = fs.readFileSync(filePath);
      const actualHash = crypto.createHash('sha256').update(data).digest('hex');
      const expectedHash = manifest.checksums?.[manifestKey];
      if (!expectedHash) {
        fail(`${filename}: no checksum in manifest`);
      } else if (actualHash !== expectedHash) {
        fail(`${filename}: checksum mismatch (expected ${expectedHash.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...)`);
      } else {
        pass(`${filename}: checksum OK (${Math.round(data.length / 1024)} KB)`);
      }
    }

    // Verify ZIP
    const zipName = 'isuka-cleaned-agricultural-datasets-2020-2025.zip';
    const zipPath = path.join(downloadsDir, zipName);
    const zipManifestKey = `backend/data/dist/downloads/${zipName}`;
    if (!fs.existsSync(zipPath)) {
      fail(`${zipName} is missing`);
    } else {
      const data = fs.readFileSync(zipPath);
      const actualHash = crypto.createHash('sha256').update(data).digest('hex');
      const expectedHash = manifest.checksums?.[zipManifestKey];
      if (!expectedHash) {
        fail(`${zipName}: no checksum in manifest`);
      } else if (actualHash !== expectedHash) {
        fail(`${zipName}: checksum mismatch`);
      } else {
        pass(`${zipName}: checksum OK (${Math.round(data.length / 1024)} KB)`);
      }
    }
  } catch (err) {
    fail(`manifest.json error: ${err.message}`);
  }
}

// ─── 7. No respondent-level fields in committed artifacts ────────────────────
console.log('\n[verify:artifacts] Scanning for respondent-level fields in committed artifacts...');

// These field names appear in raw NISR microdata and must never appear in
// committed aggregate artifacts.
const RESPONDENT_FIELDS = [
  'hhid', 'household_id', 'respondent_id', 'hh_id',
  'individual_id', 'person_id', 'gps_latitude', 'gps_longitude',
  'interviewer_id', 'enumerator_id', 'cluster_id'
];
const RESPONDENT_PATTERN = new RegExp(`"(${RESPONDENT_FIELDS.join('|')})"\\s*:`, 'i');

const artifactPaths = [
  path.join(root, 'backend', 'data', 'default-overview-cache.json'),
  path.join(root, 'backend', 'data', 'forecast-cache.json'),
  path.join(root, 'backend', 'data', 'loss-planner-cache.json'),
  path.join(root, 'frontend', 'data', 'landing-art.json')
];

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  });
}
artifactPaths.push(...listFiles(distDir).filter((filePath) => !filePath.endsWith('manifest.json')));

// Add CSV exports
const csvExports = [2020, 2021, 2022, 2023, 2024, 2025].map((year) =>
  path.join(root, 'public', 'downloads', `isuka-cleaned-agricultural-dataset-${year}.csv`)
);

for (const filePath of [...artifactPaths, ...csvExports]) {
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  // CSV headers to check
  const firstLine = content.split('\n')[0].toLowerCase();
  let foundField = null;
  for (const field of RESPONDENT_FIELDS) {
    if (firstLine.includes(field) || new RegExp(`"${field}"\\s*:`, 'i').test(content)) {
      foundField = field;
      break;
    }
  }
  if (foundField) {
    fail(`${path.relative(root, filePath)}: contains respondent-level field "${foundField}"`);
  } else {
    pass(`${path.relative(root, filePath)}: no respondent-level fields detected`);
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────
console.log(`\n[verify:artifacts] ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error('\n[verify:artifacts] FAIL — One or more artifact checks failed.');
  console.error('Generate missing artifacts locally and commit them before deploying.\n');
  process.exit(1);
}
console.log('[verify:artifacts] All artifact checks passed. Safe to deploy.\n');
