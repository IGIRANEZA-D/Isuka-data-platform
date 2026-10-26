#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'backend', 'data', 'dist');
const periodsRoot = path.join(distRoot, 'periods');
const lossPlannerRoot = path.join(distRoot, 'loss-planner');
const { datasetFiles } = require('../backend/src/data/dataset-config');
const { loadPeriod, serializeAggregate, AGGREGATE_CALC_VERSION } = require('../backend/src/data/overview-service');

fs.mkdirSync(periodsRoot, { recursive: true });
fs.mkdirSync(lossPlannerRoot, { recursive: true });
const manifest = { calcVersion: AGGREGATE_CALC_VERSION, generatedAt: new Date().toISOString(), files: {}, checksums: {} };

for (const config of datasetFiles) {
  const period = loadPeriod(config);
  if (!period.available || !period.aggregate) throw new Error(`Cannot build aggregate artifact for ${config.key}.`);
  const fileName = `periods/${config.key}.json`;
  const destination = path.join(distRoot, fileName);
  const artifact = {
    key: config.key,
    year: config.year,
    season: config.season,
    calcVersion: AGGREGATE_CALC_VERSION,
    rowCount: period.rowCount,
    invalidRows: period.invalidRows,
    warnings: period.aggregate.warnings,
    aggregate: serializeAggregate(period.aggregate)
  };
  const contents = `${JSON.stringify(artifact)}\n`;
  fs.writeFileSync(destination, contents);
  manifest.files[fileName] = { bytes: Buffer.byteLength(contents), rowCount: period.rowCount };
  manifest.checksums[fileName] = crypto.createHash('sha256').update(contents).digest('hex');
  process.stdout.write(`[build:data] ${config.key}: ${manifest.files[fileName].bytes} bytes\n`);
}

const lossPlannerCache = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'data', 'loss-planner-cache.json'), 'utf8'));
for (const entry of lossPlannerCache.periods || []) {
  const key = `${entry.period.year}-${entry.period.season}`;
  const fileName = `loss-planner/${key}.json`;
  const contents = `${JSON.stringify({ calcVersion: lossPlannerCache.calculationVersion, generatedAt: lossPlannerCache.generatedAt, entry })}\n`;
  fs.writeFileSync(path.join(distRoot, fileName), contents);
  manifest.files[fileName] = { bytes: Buffer.byteLength(contents) };
  manifest.checksums[fileName] = crypto.createHash('sha256').update(contents).digest('hex');
}

for (const [artifactPath, manifestKey] of [
  [path.join(root, 'backend', 'data', 'default-overview-cache.json'), '../default-overview-cache.json'],
  [path.join(root, 'backend', 'data', 'forecast-cache.json'), '../forecast-cache.json'],
  [path.join(root, 'backend', 'data', 'loss-planner-cache.json'), '../loss-planner-cache.json'],
  [path.join(root, 'frontend', 'data', 'landing-art.json'), 'frontend/data/landing-art.json']
]) {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.calcVersion = AGGREGATE_CALC_VERSION;
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  const contents = fs.readFileSync(artifactPath);
  manifest.files[manifestKey] = { bytes: contents.length };
  manifest.checksums[manifestKey] = crypto.createHash('sha256').update(contents).digest('hex');
}
fs.writeFileSync(path.join(distRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[build:data] Wrote ${Object.keys(manifest.checksums).length} checksummed aggregate artifacts.\n`);
