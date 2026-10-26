const path = require('node:path');
const { datasetFiles } = require('../backend/src/data/dataset-config');
const { normalizeText, parseNumber, readDelimitedFile } = require('../backend/src/data/parser');
const { isStructuredDataset, readStructuredDataset } = require('../backend/src/data/structured-reader');
const { readVariableLabels } = require('../backend/src/data/loss-field-resolver');

const API_URL = process.env.ISUKA_API_URL || 'http://localhost:3000';
const UNIT_CONFIRMED_BY_EQUIVALENT = new Set(['totalLoss', 'fallenStalks', 'storage']);
const componentKeys = ['pests', 'birdsAnimals', 'fallenStalks', 'harvestLoss', 'transport', 'storage', 'processing', 'packaging', 'sales'];

function resolveLabelSource(period) {
  if (path.extname(period.filePath).toLowerCase() === '.sav') return period.filePath;
  const sourceName = path.basename(period.filePath).replace(/\.(csv|dta)$/i, '.sav');
  if (period.year === 2023) {
    return path.join(path.dirname(path.dirname(period.filePath)), 'SPSS', sourceName);
  }
  return path.join(path.dirname(period.filePath), sourceName);
}

function matches(label, field) {
  const text = String(label || '').toLowerCase();
  const hasQuantity = /\b(?:qty|quantity)\b/.test(text);
  if (field === 'totalLoss') return hasQuantity && (/estimated loss/.test(text) || /quantity[^.]*has been los(?:t)?\b/.test(text) || /quantity that has been lost/.test(text));
  if (field === 'theft') return hasQuantity && /\bstol(?:en|len)\b/.test(text);
  if (field === 'otherLoss') return hasQuantity && /\bother\b/.test(text) && /\b(?:loss|lost)\b/.test(text) && !/\b(?:used|birds?|animals?|insects?|pests?)\b/.test(text);
  if (field === 'pests') return hasQuantity && /\b(?:insect|pest)/.test(text) && /\b(?:damage|damaged|loss|lost)\b/.test(text);
  if (field === 'birdsAnimals') return hasQuantity && /\b(?:bird|animal)/.test(text) && /\b(?:damage|damaged|loss|lost)\b/.test(text);
  if (field === 'fallenStalks') return hasQuantity && /\bstalk/.test(text) && /\bfallen\b/.test(text);
  if (field === 'harvestLoss') return hasQuantity && /\b(?:lost|loss) during harvest(?:ing)?\b/.test(text) && !/\bprocessing\b/.test(text);
  if (field === 'transport') return hasQuantity && /\b(?:transport|transportation)\b/.test(text) && /\b(?:loss|lost)\b/.test(text);
  if (field === 'storage') return hasQuantity && /\bstorage\b/.test(text) && /\b(?:loss|lost)\b/.test(text);
  if (field === 'processing') return hasQuantity && /\bprocessing\b/.test(text) && /\b(?:loss|lost)\b/.test(text);
  if (field === 'packaging') return hasQuantity && /\bpackaging\b/.test(text) && /\b(?:loss|lost)\b/.test(text);
  if (field === 'sales') return hasQuantity && /\b(?:sales|sale)\b/.test(text) && /\b(?:loss|lost)\b/.test(text);
  return false;
}

function resolveFields(labelMap, headers, filename) {
  const fields = {};
  for (const field of ['totalLoss', 'theft', 'otherLoss', ...componentKeys]) {
    const candidates = headers.filter((column) => matches(labelMap[column], field));
    if (candidates.length > 1) throw new Error(`${filename}: ambiguous ${field} labels (${candidates.join(', ')})`);
    fields[field] = candidates[0] || null;
  }
  if (!fields.totalLoss && !fields.theft && !componentKeys.some((field) => fields[field])) {
    throw new Error(`${filename}: no total or component loss field found by label`);
  }
  return fields;
}

function readRows(filePath) {
  return isStructuredDataset(filePath) ? readStructuredDataset(filePath) : readDelimitedFile(filePath);
}

function rowLookup(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

function cell(lookup, names) {
  for (const name of names) {
    const value = lookup[name.toLowerCase()];
    if (value !== undefined && normalizeText(value) !== '') return value;
  }
  return null;
}

function deduplicateIndependently(rows, headers) {
  const loweredHeaders = new Set(headers.map((header) => header.toLowerCase()));
  const farmerColumn = ['s1q6', 'farmer_id', 'farmerid'].find((column) => loweredHeaders.has(column));
  const plotColumn = ['s2q1', 'plot_number', 'plot_number'].find((column) => loweredHeaders.has(column));
  const cropColumn = ['s2q4', 'crop_code', 'cropcode'].find((column) => loweredHeaders.has(column));
  const seen = new Set();
  const retained = [];
  let removed = 0;
  for (const row of rows) {
    const lookup = rowLookup(row);
    const keyParts = [farmerColumn, plotColumn, cropColumn].map((column) => normalizeText(column ? lookup[column] : ''));
    if (keyParts.some((part) => !part)) {
      retained.push(row);
      continue;
    }
    const fingerprint = JSON.stringify(Object.keys(row).sort().map((key) => normalizeText(row[key])));
    const key = `${keyParts.join('|')}|${fingerprint}`;
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    retained.push(row);
  }
  return { rows: retained, removed };
}

function calculateIndependent(period, parsed, fields) {
  const deduplicated = deduplicateIndependently(parsed.rows, parsed.headers);
  const headers = new Set(parsed.headers.map((header) => header.toLowerCase()));
  const areaFields = ['Crop_Area_ha', 'Crop_Area', 'crop_area_ha', 'CropArea_ha', 'Harvested_Crop_Area_ha', 'Harvested_Area', 'Harv_area', 'Plot_area_ha', 'plot_area_ha', 'Plot_Area_ha'].filter((field) => headers.has(field.toLowerCase()));
  const yieldFields = ['Yield', 'yield', 'harvest_yield'].filter((field) => headers.has(field.toLowerCase()));
  const weightFields = ['Plot_weight', 'plot_weight', 'weight_plot', 'finalplot_weight', 'final_plot_weight', 'aweight'].filter((field) => headers.has(field.toLowerCase()));
  const directFields = ['s2q21', 's2q22', 's2q23', 'Harvested_Quantity', 'harvest_quantity'].filter((field) => headers.has(field.toLowerCase()));
  let weightedProductionKg = 0;
  let weightedLossKg = 0;
  let productionRows = 0;
  let invalidLossRows = 0;
  let negativeLossRows = 0;

  for (const row of deduplicated.rows) {
    const lookup = rowLookup(row);
    const cropArea = parseNumber(cell(lookup, areaFields));
    const plotArea = parseNumber(cell(lookup, ['Plot_area_ha', 'plot_area_ha', 'Plot_Area_ha'].filter((field) => headers.has(field.toLowerCase()))));
    const area = cropArea ?? plotArea;
    const yieldValue = parseNumber(cell(lookup, yieldFields));
    const weight = parseNumber(cell(lookup, weightFields));
    const directProduction = parseNumber(cell(lookup, directFields));
    const derivedIsValid = area !== null && yieldValue !== null && weight !== null && area >= 0 && yieldValue >= 0 && weight >= 0;
    const directIsValid = directProduction !== null && weight !== null && directProduction >= 0 && weight >= 0;
    if (!derivedIsValid && !directIsValid) continue;

    const physicalProduction = derivedIsValid ? area * yieldValue : directProduction;
    weightedProductionKg += physicalProduction * weight;
    productionRows += 1;

    const quantity = (field) => field ? parseNumber(cell(lookup, [field])) : null;
    const total = quantity(fields.totalLoss);
    const theft = quantity(fields.theft);
    const otherLoss = quantity(fields.otherLoss);
    const componentValues = componentKeys.map((key) => quantity(fields[key])).filter((value) => value !== null);
    const negativeValues = [total, theft, otherLoss, ...componentValues].filter((value) => value !== null && value < 0);
    if (negativeValues.length) negativeLossRows += 1;
    const components = componentValues.filter((value) => value >= 0).reduce((sum, value) => sum + value, 0);
    const baseLoss = total !== null && total > 0 ? total : components;
    const reportedQuantity = baseLoss + Math.max(0, theft ?? 0) + Math.max(0, otherLoss ?? 0);
    const hasLoss = total !== null || components > 0 || theft !== null || otherLoss !== null;
    if (!hasLoss) continue;
    if (reportedQuantity > physicalProduction) {
      invalidLossRows += 1;
      continue;
    }
    weightedLossKg += reportedQuantity * weight;
  }

  return {
    weightedProductionKg,
    weightedLossKg,
    lossPercent: weightedProductionKg > 0 ? weightedLossKg / weightedProductionKg * 100 : null,
    productionRows,
    invalidLossRows,
    negativeLossRows,
    duplicatesRemoved: deduplicated.removed
  };
}

async function verifyPeriod(period) {
  const parsed = readRows(period.filePath);
  const labelMetadata = readVariableLabels(resolveLabelSource(period));
  const fields = resolveFields(labelMetadata.variableLabels, parsed.headers, period.relativePath);
  const independent = calculateIndependent(period, parsed, fields);
  const response = await fetch(`${API_URL}/api/overview?year=${period.year}&season=${period.season}`);
  if (!response.ok) throw new Error(`${period.key}: shared overview returned ${response.status}`);
  const shared = await response.json();
  const sharedProduction = Number(shared.kpis.weightedProductionKg);
  const sharedLossPct = Number(shared.kpis.postHarvestLossPercent);
  const sharedLossKg = sharedProduction * sharedLossPct / 100;
  const lossKgErrorPct = sharedLossKg === 0 ? Math.abs(independent.weightedLossKg - sharedLossKg) : Math.abs(independent.weightedLossKg - sharedLossKg) / sharedLossKg * 100;
  const lossPctError = Math.abs(independent.lossPercent - sharedLossPct);
  const passed = lossKgErrorPct <= 0.1 && lossPctError <= 0.01;
  return {
    period: period.key,
    independentLossKg: independent.weightedLossKg,
    sharedLossKg,
    independentLossPct: independent.lossPercent,
    sharedLossPct,
    lossKgErrorPct,
    lossPctError,
    rows: independent.productionRows,
    invalidLossRows: independent.invalidLossRows,
    negativeLossRows: independent.negativeLossRows,
    duplicatesRemoved: independent.duplicatesRemoved,
    fields,
    passed
  };
}

async function main() {
  const results = [];
  for (const period of datasetFiles.filter((entry) => entry.year >= 2020 && entry.year <= 2025)) {
    results.push(await verifyPeriod(period));
  }
  console.log('period\tindependent loss kg\tshared loss kg\tindependent %\tshared %\tkg error %\tpp error\tresult');
  for (const row of results) {
    console.log(`${row.period}\t${row.independentLossKg.toFixed(2)}\t${row.sharedLossKg.toFixed(2)}\t${row.independentLossPct.toFixed(6)}\t${row.sharedLossPct.toFixed(6)}\t${row.lossKgErrorPct.toFixed(6)}\t${row.lossPctError.toFixed(6)}\t${row.passed ? 'PASS' : 'FAIL'}`);
  }
  if (results.length !== 18 || results.some((result) => !result.passed)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { resolveFields, calculateIndependent, verifyPeriod };