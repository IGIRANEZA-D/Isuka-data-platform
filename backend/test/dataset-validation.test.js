const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateDatasetFile, remediateDatasetFile } = require('../src/data/dataset-validation');
const { buildValidationProgress, validationStageNames } = require('../src/data/dataset-worker');
const { DatasetQualityModel, buildDatasetAcceptanceDecision } = require('../src/data/dataset-quality-model');

test('builds a stable persisted worker-stage contract', () => {
  const progress = buildValidationProgress('model_check', 'Testing forecasting features', 84, ['period', 'schema']);
  assert.equal(progress.stage, validationStageNames.model_check);
  assert.equal(progress.percent, 84);
  assert.deepEqual(progress.completedChecks, ['period', 'schema']);
  assert.ok(progress.updatedAt instanceof Date);
});

test('validation job records include required lifecycle fields', () => {
  const job = {
    datasetId: 'dataset-1',
    version: 1,
    jobType: 'fit_review',
    status: 'running',
    createdAt: new Date(),
    progress: { phase: 'queued', currentStep: 'Preparing dataset', completedChecks: [] }
  };
  assert.equal(typeof job.createdAt.getTime, 'function');
  assert.equal(job.jobType, 'fit_review');
  assert.equal(job.progress.phase, 'queued');
});

function writeFixture(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'isuka-validation-'));
  const filePath = path.join(directory, 'dataset.csv');
  fs.writeFileSync(filePath, content);
  return { directory, filePath };
}

test('exposes an actionable blocking explanation for a period mismatch', () => {
  const fixture = writeFixture('district,crop,year,season,area_ha\nKigali,maize,2023,A,1\n');
  try {
    const result = validateDatasetFile(fixture.filePath, { year: 2026, season: 'Season A' });
    assert.equal(result.status, 'fail');
    assert.equal(result.periodCheck.yearMismatch, true);
    assert.ok(result.warnings.some((warning) => warning.includes('2026')));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('reports missing agricultural columns for administrator correction', () => {
  const fixture = writeFixture('district,year,season\nKigali,2023,A\n');
  try {
    const result = validateDatasetFile(fixture.filePath, { year: 2023, season: 'Season A' });
    assert.equal(result.status, 'fail');
    assert.ok(result.issues.missingColumns.includes('crop'));
    assert.ok(result.warnings.some((warning) => warning.includes('Missing expected agricultural columns')));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('reports model readiness requirements after reading the complete file', () => {
  const fixture = writeFixture('district,crop\nKigali,maize\n');
  try {
    const result = validateDatasetFile(fixture.filePath, { year: 2023, season: 'Season A', datasetType: 'crop' });
    assert.equal(result.modelReadiness.status, 'blocked');
    assert.ok(result.modelReadiness.blockingReasons.some((reason) => reason.includes('Year and season')));
    assert.ok(result.modelReadiness.algorithms.some((algorithm) => algorithm.name === 'Forecasting feature check'));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('accepts the demo aggregate crop schema when its period matches', () => {
  const fixture = writeFixture('year,season,districtCode,cropCode,cropName,weightedProductionKg,weightedAreaHa,lossKg,lossPercent,riskTier,rowCount\n2023,A,bugesera,Banana for beer,Banana for beer,16503091.02,1748.23,1102734.34,6.68,low,123\n2023,B,bugesera,Banana for beer,Banana for beer,28306535.18,3137.87,841986.39,2.97,low,135\n');
  try {
    const result = validateDatasetFile(fixture.filePath, { year: 2023, season: 'Season A', datasetType: 'crop' });
    assert.equal(result.status, 'pass');
    assert.equal(result.modelReadiness.status, 'ready');
    assert.equal(result.periodCheck.yearMismatch, false);
    assert.equal(typeof result.readinessScore, 'number');
    assert.ok(result.readinessScore >= 90);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('repairs a dataset by normalizing season labels, removing duplicates, and making it acceptable for submission', () => {
  const fixture = writeFixture([
    'district,crop,year,season,area_ha,production_kg',
    'Kigali,Maize,2023,Season B,10,100',
    'Kigali,Maize,2023,Season B,10,100',
    'Kigali,Maize,2024,Season B,30,300',
    'Kigali,Maize,2024,Season B,30,300',
    'Kigali,Beans,2024,Season B,20,180'
  ].join('\n'));

  try {
    const result = remediateDatasetFile(fixture.filePath, { year: 2024, season: 'Season B', datasetType: 'crop' });
    assert.ok(result.cleanedPath);
    assert.ok(result.cleaned);
    assert.ok(result.cleaningActions.some((action) => action.includes('duplicate') || action.includes('Season B')));
    const rechecked = validateDatasetFile(result.cleanedPath, { year: 2024, season: 'Season B', datasetType: 'crop' });
    assert.ok(['pass', 'warn'].includes(rechecked.status));
    assert.ok(rechecked.readinessScore >= 70);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('uses a confidence-aware acceptance model with deterministic fallback when the neural pass is weak', () => {
  const model = new DatasetQualityModel();
  const score = model.evaluate({
    schemaScore: 81,
    completenessScore: 84,
    temporalScore: 90,
    cleanlinessScore: 76,
    featureReadiness: 72,
    missingInfo: [],
    warnings: ['Minor district name drift'],
    duplicateRowsRemoved: 2,
    invalidRows: 3,
    rowCount: 180
  });

  assert.ok(typeof score.confidence === 'number');
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
  assert.ok(['accepted', 'needs_review', 'rejected'].includes(score.status));
  assert.ok('fallbackUsed' in score);

  const decision = buildDatasetAcceptanceDecision({
    schemaScore: 60,
    completenessScore: 55,
    periodCheck: { yearMismatch: true, seasonMismatch: false },
    duplicateRowsRemoved: 50,
    invalidRows: 20,
    rowCount: 100,
    issues: { missingColumns: ['crop'] },
    warnings: ['Missing crop names'],
    modelReadiness: { status: 'blocked' }
  }, model);

  assert.equal(decision.needsRepair, true);
  assert.ok(Array.isArray(decision.remediationPlan.actions));
  assert.ok(decision.fallbackUsed === true || decision.modelStatus === 'fallback');
});