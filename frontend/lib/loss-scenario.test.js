import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScenario,
  formatSacks,
  formatTonnes,
  coverageBand,
  afterLossRate,
  serializeScenarioState,
  parseScenarioState
} from './loss-scenario.js';

const fixtureRows = [
  {
    d: 'bugesera', c: '101', productionKg: 1000, stageKg: { pests: 10, animals: 0, harvest: 20, transport: 0, storage: 100, processing: 0, sales: 0, other: null },
    unattributedKg: 20, totalLossKg: 150, records: 30, stageRecords: 24, stageCoveragePct: 70, priceRwfPerKg: 200
  },
  {
    d: 'kayonza', c: '101', productionKg: 500, stageKg: { pests: 0, animals: 0, harvest: 0, transport: 0, storage: 50, processing: 0, sales: 0, other: null },
    unattributedKg: 30, totalLossKg: 80, records: 29, stageRecords: 18, stageCoveragePct: 60, priceRwfPerKg: 220
  }
];

test('computes recovery and value from included rows only', () => {
  // Hand check: 100 kg storage loss * 50% = 50 kg recovered; 50 kg * RWF 200/kg = RWF 10,000.
  const result = computeScenario({ rows: fixtureRows, cropCode: '101', stageIds: ['storage'], reductionPct: 50 });
  assert.equal(result.totals.recoveredKg, 50);
  assert.equal(result.totals.valueRwf, 10000);
  assert.equal(result.totals.includedCount, 1);
  assert.equal(result.totals.suppressedCount, 1);
  assert.equal(result.byDistrict[0].code, 'bugesera');
  assert.equal(result.byDistrict[0].valueRwf, 10000);
});

test('reports missing price honestly and disables unconfirmed stage values', () => {
  const rows = [{ ...fixtureRows[0], priceRwfPerKg: null, stageKg: { ...fixtureRows[0].stageKg, other: null } }];
  const result = computeScenario({ rows, cropCode: '101', stageIds: ['storage', 'other'], availableStageIds: ['pests', 'animals', 'harvest', 'transport', 'storage', 'processing', 'sales'], reductionPct: 30 });
  assert.equal(result.totals.valueRwf, null);
  assert.equal(result.byDistrict[0].valueRwf, null);
  assert.deepEqual(result.unavailableStageIds, ['other']);
});

test('coverage bands and before-after loss use the documented thresholds', () => {
  assert.equal(coverageBand(70), 'high');
  assert.equal(coverageBand(69.9), 'medium');
  assert.equal(coverageBand(39.9), 'low');
  assert.equal(coverageBand(null), 'unavailable');
  assert.equal(afterLossRate({ recordedLossKg: 150, recoveredKg: 50, productionKg: 1000 }), 10);
});

test('formats tonnes and 50 kg sacks and round-trips scenario URL state', () => {
  assert.equal(formatTonnes(123456), '123 t');
  assert.equal(formatTonnes(12500), '12.5 t');
  assert.equal(formatSacks(250), '5 sacks');
  const state = { cropCode: '101', years: '2025', seasons: ['A', 'B'], districtCodes: ['bugesera', 'kayonza'], stageIds: ['storage'], reductionPct: 50 };
  assert.deepEqual(parseScenarioState(serializeScenarioState(state)), { ...state, years: ['2025'] });
});