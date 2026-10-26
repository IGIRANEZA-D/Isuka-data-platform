const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { datasetFiles } = require('../backend/src/data/dataset-config');
const { loadPeriod, AGGREGATE_CALC_VERSION } = require('../backend/src/data/overview-service');
const { readDatasetLabelMetadata } = require('../backend/src/data/loss-field-resolver');
const { isStructuredDataset, readStructuredDataset } = require('../backend/src/data/structured-reader');
const { readDelimitedFile } = require('../backend/src/data/parser');
const { LOSS_PLANNER_CALC_VERSION } = require('../backend/src/data/loss-planner-service');

const root = path.resolve(__dirname, '..');
const apiBase = process.env.ISUKA_API_URL || 'http://localhost:3000';
const failures = [];

function report(name, error) {
  if (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message || error}`);
  } else console.log(`PASS ${name}`);
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `Process exited ${result.status}`).trim());
  return result.stdout;
}

async function getJson(route) {
  const response = await fetch(`${apiBase}${route}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${body.error || 'request failed'}`);
  return body;
}

async function check(name, operation) {
  try {
    await operation();
    report(name);
  } catch (error) {
    report(name, error);
  }
}

async function main() {
  await check('all 18 source files resolve loss fields from labels', () => {
    const periods = datasetFiles.filter((period) => period.year >= 2020 && period.year <= 2025);
    if (periods.length !== 18) throw new Error(`expected 18 configured periods, got ${periods.length}`);
    for (const period of periods) {
      const parsed = isStructuredDataset(period.filePath) ? readStructuredDataset(period.filePath) : readDelimitedFile(period.filePath);
      const resolved = readDatasetLabelMetadata(period, parsed.headers, true).lossFields;
      const components = ['theft', 'pests', 'birdsAnimals', 'fallenStalks', 'harvestLoss', 'transport', 'storage', 'processing', 'packaging', 'sales'];
      if (!resolved.totalLoss && !components.some((field) => resolved[field])) throw new Error(`${period.key}: no total or components resolved`);
    }
  });

  await check('independent 18-period reconciliation', () => {
    runNode(['scripts/verify-loss-reconciliation.js']);
  });

  await check('2020-2022 label-only regression values', async () => {
    const expected = {
      '2020-A': 4.324404443, '2020-B': 2.970657334, '2020-C': 2.273736144,
      '2021-A': 2.829784890, '2021-B': 2.699773640, '2021-C': 3.068497870,
      '2022-A': 2.581985980, '2022-B': 2.604216892, '2022-C': 2.556604187
    };
    for (const [key, value] of Object.entries(expected)) {
      const [year, season] = key.split('-');
      const result = await getJson(`/api/overview?year=${year}&season=${season}`);
      if (!Number.isFinite(result.kpis.postHarvestLossPercent) || Math.abs(result.kpis.postHarvestLossPercent - value) > 0.001) {
        throw new Error(`${key}: expected ${value.toFixed(6)}%, got ${result.kpis.postHarvestLossPercent}`);
      }
    }
  });

  await check('calculation-versioned aggregate cache', () => {
    const period = loadPeriod(datasetFiles.find((entry) => entry.key === '2025-C'));
    const cachePath = `${period.filePath}.isuka-aggregate.json`;
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!cached.cacheKey?.endsWith(AGGREGATE_CALC_VERSION)) throw new Error('aggregate sidecar has no current calculation version');
  });

  await check('forecast horizon and cap invariants', () => {
    const cache = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/forecast-cache.json'), 'utf8'));
    if (cache.horizon?.startYear !== 2026 || cache.horizon?.endYear !== 2026 || JSON.stringify(cache.horizon?.seasons) !== '["A"]') throw new Error('forecast horizon is not exactly 2026-A');
    for (const entry of cache.forecasts || []) {
      if (entry.future?.length !== 1 || entry.future[0].year !== 2026 || entry.future[0].season !== 'A') throw new Error(`${entry.districtCode}/${entry.cropCode} does not have exactly one 2026-A period`);
      for (const cap of Object.values(entry.future[0].clamping?.caps || {})) if (!(Number.isFinite(cap) && cap > 0)) throw new Error(`${entry.districtCode}/${entry.cropCode} has a non-positive cap`);
    }
  });

  await check('methodology numbers are cache-bound', () => {
    const html = fs.readFileSync(path.join(root, 'frontend/forecasting-analysis.html'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'frontend/forecasting-analysis.js'), 'utf8');
    if (!html.includes('data-backtest-tier-match') || !html.includes('data-naive-baseline-note') || /94\.5355%|3\.9509 pp|1,100|56 of 586/.test(html)) throw new Error('methodology still contains hardcoded forecast metrics');
    if (!script.includes('/api/forecast?model=ensemble')) throw new Error('methodology does not load forecast statistics from the API');
  });

  await check('crop codes use s2q4 labels', async () => {
    const overview = await getJson('/api/overview?year=2025&season=C');
    const codes = overview.productionByCrop.map((row) => row.cropCode);
    if (!codes.length || new Set(codes).size !== codes.length) throw new Error('production crop codes are empty or duplicated');
    if (codes.some((code) => /^\d+$/.test(String(code)) === false)) throw new Error('a crop category is not keyed by its numeric s2q4 code');
    console.log(`  crop code count: ${codes.length}`);
  });

  await check('loss-planner endpoint contract and decomposition', async () => {
    const result = await getJson('/api/loss-planner/baseline?years=all&seasons=all');
    if (result.meta.periods.length !== 18 || !result.meta.calcVersion || !Array.isArray(result.crops) || !Array.isArray(result.districts) || !Array.isArray(result.stages) || !Array.isArray(result.rows)) throw new Error('planner response does not match the contract shape');
    if (result.stages.some((stage) => !['confirmed', 'unconfirmed'].includes(stage.unitStatus))) throw new Error('stage unitStatus is invalid');
    for (const row of result.rows) {
      if (row.totalLossKg === null) continue;
      const stageKg = Object.values(row.stageKg).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(row.unattributedKg) || Math.abs(stageKg + row.unattributedKg - row.totalLossKg) > Math.max(0.01, row.totalLossKg * 1e-9)) throw new Error(`${row.d}/${row.c} stage + unattributed does not equal total`);
    }
    if (Buffer.byteLength(JSON.stringify(result)) >= 1.5 * 1024 * 1024) throw new Error('all-period planner payload exceeds 1.5 MB');
    const defaultResult = await getJson('/api/loss-planner/default?years=all&seasons=all');
    if (!defaultResult.period || !Number.isFinite(defaultResult.reductionPct)) throw new Error('planner default response is incomplete');
  });

  await check('Ask Isuka aggregate consistency', () => {
    runNode(['scripts/verify-assistant-consistency.js']);
  });

  await check('scenario helper unit tests', () => {
    runNode(['--test', 'frontend/lib/loss-scenario.test.js']);
  });

  await check('existing backend tests', () => {
    const testFiles = fs.readdirSync(path.join(root, 'backend', 'test'))
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => path.join('backend', 'test', name));
    runNode(['--test', ...testFiles]);
  });

  if (failures.length) {
    console.error(`FAIL verify:data (${failures.length} check(s))`);
    process.exitCode = 1;
  } else console.log('PASS verify:data (11 checks)');
}

main().catch((error) => {
  console.error(`FAIL verify:data: ${error.stack || error.message}`);
  process.exitCode = 1;
});
