const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDelimitedText, parseNumber } = require('../src/data/parser');
const { aggregateRows, buildOverview, buildFilteredOverview, buildTimeSeries, deduplicateRows, getFieldMap } = require('../src/data/overview-service');
const { buildLoginFailureMessage } = require('../src/data/auth-service');
const { calculateUnreadAlertCount } = require('../src/server');

test('parses quoted tab-delimited rows and preserves embedded delimiters', () => {
  const result = parseDelimitedText('district\tcrop\tvalue\n"Kigali"\t"Bush\tbean"\t"1,200"');
  assert.equal(result.delimiter, 'tab');
  assert.deepEqual(result.rows[0], { district: 'Kigali', crop: 'Bush\tbean', value: '1,200' });
  assert.equal(result.invalidRows, 0);
});

test('returns null for blank and invalid numeric values', () => {
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('not a number'), null);
  assert.equal(parseNumber('1,200.5'), 1200.5);
});

test('aggregates weighted production and excludes negative losses', () => {
  const rows = [
    { CropCategory: 'Maize', Crop_Area_ha: '2', Plot_area_ha: '3', Yield: '1000', Plot_weight: '2', s2q41: '10', s2q42: '-4', s1q2: '01' },
    { CropCategory: 'Beans', Crop_Area_ha: '1', Plot_area_ha: '1', Yield: '500', Plot_weight: '1', s2q41: '5', s1q2: '02' }
  ];
  const fieldMap = {
    cropName: ['CropCategory'], cropAreaHa: ['Crop_Area_ha'], plotAreaHa: ['Plot_area_ha'], yield: ['Yield'], weight: ['Plot_weight'], districtCode: ['s1q2'], lossFields: ['s2q41', 's2q42']
  };
  const result = aggregateRows(rows, fieldMap);
  assert.equal(result.weightedProductionKg, 4500);
  assert.equal(result.weightedAreaHa, 7);
  assert.equal(result.lossKg, 25);
  assert.equal(result.negativeLossRows, 1);
});

test('builds an overview for the selected period with traceable metadata', () => {
  const makePeriod = (key, year, season, production) => ({
    key, year, season, available: true, relativePath: `${key}.csv`, rows: [{}], invalidRows: 0,
    aggregate: {
      weightedProductionKg: production, weightedAreaHa: 2, lossKg: 10, productionRowsWithValues: 1,
      warnings: [], districtMap: new Map([['01', { productionKg: production, lossKg: 10, rows: 1 }]]),
      cropMap: new Map([['Maize', { productionKg: production, rows: 1 }]])
    }
  });
  const overview = buildOverview([makePeriod('2024-C', 2024, 'C', 100), makePeriod('2025-C', 2025, 'C', 150)], 2025, 'C');
  assert.deepEqual(overview.period, { year: 2025, season: 'C' });
  assert.equal(overview.kpis.weightedProductionKg, 150);
  assert.equal(overview.dataQuality.rowsUsed, 1);
  assert.match(overview.dataQuality.formulas.weightedProductionKg, /survey weight/);
});

test('filters all loaded years and districts before calculating risk distribution', () => {
  const makePeriod = (key, year, district, production, loss) => ({
    key, year, season: 'C', available: true, relativePath: `${key}.csv`, rows: [
      { s1q2: district, CropCategory: 'Maize', Crop_Area_ha: '1', Plot_area_ha: '1', Yield: String(production), Plot_weight: '1', s2q41: String(loss) }
    ], invalidRows: 0, fieldMap: {
      districtCode: ['s1q2'], cropName: ['CropCategory'], cropAreaHa: ['Crop_Area_ha'], plotAreaHa: ['Plot_area_ha'],
      yield: ['Yield'], weight: ['Plot_weight'], lossFields: ['s2q41']
    }
  });
  const periods = [
    makePeriod('2024-C', 2024, 'Alpha', 100, 10),
    makePeriod('2024-C-2', 2024, 'Beta', 100, 50),
    makePeriod('2025-C', 2025, 'Alpha', 200, 20)
  ];

  const allYears = buildFilteredOverview(periods, 'all', 'all');
  const district = buildFilteredOverview(periods, '2024', 'beta');

  assert.deepEqual(allYears.filters.availableYears, [2024, 2025]);
  assert.deepEqual(allYears.filters.availableSeasons, ['C']);
  assert.equal(allYears.kpis.weightedProductionKg, 400);
  assert.equal(allYears.districtPerformance.length, 2);
  assert.equal(allYears.districtPerformance[0].district, 'alpha');
  assert.equal(district.kpis.weightedProductionKg, 100);
  assert.equal(district.riskDistribution.find((entry) => entry.tier === 'low').districtCount, 0);
  assert.equal(district.riskDistribution.find((entry) => entry.tier === 'high').districtCount, 1);
  assert.equal(district.kpis.highRiskDistrictCount, 1);
});

test('deduplicates exact farmer plot crop rows and normalizes district names', () => {
  const rows = [
    { s1q6: 'farmer-1', s2q1: 'plot-1', Code: 'MZ', s1q2: ' Nyarugenege ' },
    { s1q6: 'farmer-1', s2q1: 'plot-1', Code: 'MZ', s1q2: ' Nyarugenege ' },
    { s1q6: 'farmer-1', s2q1: 'plot-1', Code: 'MZ', s1q2: ' Nyarugenge ' }
  ];
  const result = deduplicateRows(rows, getFieldMap(Object.keys(rows[0])));
  assert.equal(result.removed, 1);
  assert.equal(result.rows.length, 2);
});

test('builds one time-series row per available period', () => {
  const periods = ['A', 'B', 'C'].flatMap((season) => [2024, 2025].map((year) => ({
    year, season, available: true, aggregate: {
      weightedProductionKg: year, weightedAreaHa: 1, lossKg: 1, productionRowsWithValues: 1,
      districtAggregates: new Map([['district', { weightedProductionKg: year, weightedAreaHa: 1, lossKg: 1, productionRowsWithValues: 1 }]])
    }
  })));
  const result = buildTimeSeries(periods, 'district', 'all');
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((entry) => `${entry.year}-${entry.season}`), ['2024-A', '2024-B', '2024-C', '2025-A', '2025-B', '2025-C']);
});

test('uses total loss and theft, excludes non-loss use fields and impossible loss rows', () => {
  const fieldMap = {
    cropName: ['CropCategory'], districtCode: ['s1q2'], cropAreaHa: [], plotAreaHa: [],
    yield: [], weight: ['Plot_weight'], directProductionKg: ['s2q21'],
    lossFields: ['s2q38', 's2q39', 's2q40', 's2q41', 's2q42']
  };
  const result = aggregateRows([
    { CropCategory: 'Maize', s1q2: '01', s2q21: '100', Plot_weight: '1', s2q38: '10', s2q41: '8', s2q39: '2', s2q40: '1' },
    { CropCategory: 'Beans', s1q2: '01', s2q21: '5', Plot_weight: '1', s2q38: '50', s2q41: '10' }
  ], fieldMap);
  assert.equal(result.lossKg, 11);
  assert.equal(result.invalidLossRows, 1);
  assert.match(result.warnings.at(-1), /loss greater than production/);
});

test('ignores soft-deleted reminder IDs when counting unread alerts', () => {
  const reminders = [
    { id: 'weather-heavy-rain-2025-09-23' },
    { id: 'crop-123-needs-review' }
  ];
  const storedAlerts = [
    { id: 'weather-heavy-rain-2025-09-23', read: false, deletedAt: new Date('2025-09-23T12:00:00Z') },
    { id: 'crop-123-needs-review', read: false }
  ];

  assert.equal(calculateUnreadAlertCount(reminders, storedAlerts), 1);
});

test('builds clear messages for invalid login attempts', () => {
  assert.equal(buildLoginFailureMessage({ identity: '' }), 'Enter your email or phone number.');
  assert.equal(buildLoginFailureMessage({ identity: 'bad@', user: null }), 'Enter a valid email address.');
  assert.equal(buildLoginFailureMessage({ identity: 'missing@example.com', user: null }), 'No account found for this email or phone number. Create an account first.');
  assert.equal(buildLoginFailureMessage({ identity: 'user@example.com', user: { email: 'user@example.com' }, password: '' }), 'Enter your password.');
  assert.equal(buildLoginFailureMessage({ identity: 'user@example.com', user: { email: 'user@example.com' }, password: 'wrong' }), 'Incorrect password. Please try again.');
});

test('exposes the farmer session/profile routes used by the app after login', () => {
  const app = require('../src/server');
  const routeMap = new Set();
  for (const layer of app._router.stack) {
    const route = layer.route;
    if (!route) continue;
    for (const method of Object.keys(route.methods)) {
      routeMap.add(`${method.toUpperCase()} ${route.path}`);
    }
  }

  assert.ok(routeMap.has('GET /api/auth/me'));
  assert.ok(routeMap.has('POST /api/auth/logout'));
  assert.ok(routeMap.has('PATCH /api/auth/profile'));
  assert.ok(routeMap.has('POST /api/auth/password'));
  assert.ok(routeMap.has('DELETE /api/auth/account'));
});
