const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pointInPolygons, rankCorrelation } = require('../../scripts/build-landing-art');

const artPath = path.join(__dirname, '..', '..', 'frontend', 'data', 'landing-art.json');
const art = JSON.parse(fs.readFileSync(artPath, 'utf8'));

test('generated landing art has 30 unique districts and interior points', () => {
  assert.equal(art.districts.length, 30);
  assert.equal(new Set(art.districts.map(({ code }) => code)).size, 30);
  assert.equal(new Set(art.districts.map(({ name }) => name)).size, 30);
  for (const district of art.districts) {
    assert.ok(district.path.startsWith('M'));
    assert.ok(pointInPolygons(district.labelPoint, district.polygons), `${district.name} label point must be inside its boundary`);
  }
});

test('generated pointy-top hex assignment passes spatial correlation and uniqueness gates', () => {
  const longitude = art.districts.map(({ centroid }) => centroid[0]);
  const latitude = art.districts.map(({ centroid }) => centroid[1]);
  const hexLongitude = art.districts.map(({ hex }) => hex.x);
  const hexLatitude = art.districts.map(({ hex }) => hex.y);
  assert.equal(new Set(art.districts.map(({ hex }) => `${hex.q},${hex.r}`)).size, 30);
  assert.ok(rankCorrelation(longitude, hexLongitude) >= 0.95);
  assert.ok(rankCorrelation(latitude, hexLatitude) >= 0.95);
  assert.equal(art.hexValidation.sharedBorderPairs, 69);
});

test('generated art stays within compressed total and terrain budgets', () => {
  const compressedTotal = zlib.gzipSync(JSON.stringify(art), { level: 9 }).byteLength;
  const compressedTerrain = zlib.gzipSync(JSON.stringify(art.terrainLayers), { level: 9 }).byteLength;
  assert.ok(compressedTotal <= 110 * 1024, `${compressedTotal} total gzip bytes`);
  assert.ok(compressedTerrain <= 30 * 1024, `${compressedTerrain} terrain gzip bytes`);
  assert.equal(art.terrainLayers.flatMap(({ paths }) => paths).length, 16);
});
