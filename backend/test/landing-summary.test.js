const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLandingSummary } = require('../src/data/landing-summary');

test('landing summary preserves Overview national and district loss values with boundary codes', () => {
  const periods = [
    { year: 2023, season: 'A' },
    { year: 2023, season: 'B' },
    { year: 2024, season: 'A' }
  ];
  const districts = [
    { code: 'D01', name: 'North District' },
    { code: 'D02', name: 'South District' }
  ];
  const expected = new Map();
  const summary = buildLandingSummary({
    periods,
    districts,
    calcVersion: 'test-v1',
    getOverview(year, district, season) {
      assert.equal(district, 'all');
      const key = `${year}-${season}`;
      const result = {
        kpis: { postHarvestLossPercent: 2.5 },
        dataQuality: { rowsRead: 240 },
        districtPerformance: [
          { district: 'North District', lossPercent: 3.5 },
          { district: 'South District', lossPercent: 1.5 }
        ]
      };
      expected.set(key, result);
      return result;
    }
  });

  assert.deepEqual(summary.meta.years, [2023, 2024]);
  assert.deepEqual(summary.meta.seasons, ['A', 'B']);
  assert.equal(summary.meta.districtCount, 2);
  for (const key of ['2023-A', '2023-B', '2024-A']) {
    const expectedOverview = expected.get(key);
    const actual = summary.periods[key];
    assert.equal(actual.nationalLossPercent, expectedOverview.kpis.postHarvestLossPercent);
    assert.equal(actual.recordCount, expectedOverview.dataQuality.rowsRead);
    assert.deepEqual(actual.districts.map(({ code, name, lossPercent, rank }) => ({ code, name, lossPercent, rank })), [
      { code: 'D01', name: 'North District', lossPercent: 3.5, rank: 1 },
      { code: 'D02', name: 'South District', lossPercent: 1.5, rank: 2 }
    ]);
  }
});

test('landing summary rejects non-unique district labels or codes', () => {
  assert.throws(() => buildLandingSummary({
    periods: [{ year: 2024, season: 'A' }],
    districts: [{ code: '1', name: 'North' }, { code: '2', name: 'North' }],
    getOverview: () => ({ kpis: {}, dataQuality: {}, districtPerformance: [] }),
    calcVersion: 'test'
  }), /must be present and unique/);
});
