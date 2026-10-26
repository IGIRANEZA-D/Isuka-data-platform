const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCoordinates, interpretWeather } = require('../src/data/weather-service');
const { findRwandaDistrict } = require('../src/data/rwanda-locations');

test('validates worldwide coordinates and rejects invalid values', () => {
  assert.deepEqual(validateCoordinates(-1.9441, 30.0619), { latitude: -1.9441, longitude: 30.0619 });
  assert.throws(() => validateCoordinates(91, 30), /Latitude/);
  assert.throws(() => validateCoordinates(-1, 181), /longitude/);
});

test('resolves configured Rwanda districts', () => {
  assert.equal(findRwandaDistrict('Musanze').province, 'Northern Province');
  assert.equal(findRwandaDistrict('unknown'), null);
});

test('derives conservative weather indicators from provider values', () => {
  const result = interpretWeather({ current: { temperature_2m: 34, wind_speed_10m: 15, precipitation: 1 }, daily: { precipitation_sum: [25] } });
  assert.equal(result.agriculture.rainfallRisk, 'high');
  assert.equal(result.livestock.heatStress, 'watch');
  assert.equal(result.alerts.length, 2);
});
