const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { datasetFiles } = require('./dataset-config');
const { normalizeText, parseNumber, readDelimitedFile } = require('./parser');
const { riskTier } = require('./risk-thresholds');
const { canonicalizeCropName, normalizeCropCode } = require('./crop-name-map');
const { isStructuredDataset, readStructuredDataset } = require('./structured-reader');
const { readDatasetLabelMetadata } = require('./loss-field-resolver');

const AGGREGATE_CALC_VERSION = 'loss-label-resolver-v1-crop-labels-v1-production-aliases-v1';
const LOSS_FIELD_KEYS = ['totalLoss', 'theft', 'otherLoss', 'pests', 'birdsAnimals', 'fallenStalks', 'harvestLoss', 'transport', 'storage', 'processing', 'packaging', 'sales'];

const aliases = {
  districtCode: ['s1q2', 'district_code', 'District'],
  farmerId: ['s1q6', 'Farmer_ID', 'farmer_id', 'farmerid'],
  plotNumber: ['s2q1', 'plot_number', 'Plot_Number'],
  cropCode: ['s2q4', 'crop_code', 'Crop_Code', 'Code', 'code'],
  cropName: ['s2q4', 'crop_name', 'Crop Name', 'CropCategory'],
  plotAreaHa: ['Plot_area_ha', 'plot_area_ha', 'Plot_Area_ha'],
  cropAreaHa: ['Crop_Area_ha', 'Crop_Area', 'crop_area_ha', 'CropArea_ha', 'Harvested_Crop_Area_ha', 'Harvested_Area', 'Harv_area'],
  yield: ['Yield', 'yield', 'harvest_yield'],
  weight: ['Plot_weight', 'plot_weight', 'weight_plot', 'finalplot_weight', 'final_plot_weight', 'aweight'],
  directProductionKg: ['s2q21', 's2q22', 's2q23', 'Harvested_Quantity', 'harvest_quantity']
};

function getCell(row, names) {
  const lookup = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  return getCellFromLookup(lookup, names);
}

function getCellFromLookup(lookup, names) {
  for (const name of names) {
    const value = lookup[name.toLowerCase()];
    if (value !== undefined && normalizeText(value) !== '') return value;
  }
  return null;
}

function rowLookup(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

function calculateProductionMeasures(lookup, fieldMap) {
  const area = parseNumber(getCellFromLookup(lookup, fieldMap.cropAreaHa)) ?? parseNumber(getCellFromLookup(lookup, fieldMap.plotAreaHa));
  const plotArea = parseNumber(getCellFromLookup(lookup, fieldMap.plotAreaHa));
  const yieldValue = parseNumber(getCellFromLookup(lookup, fieldMap.yield));
  const weight = parseNumber(getCellFromLookup(lookup, fieldMap.weight));
  const directProduction = parseNumber(getCellFromLookup(lookup, fieldMap.directProductionKg || []));
  const canUseDerivedProduction = area !== null && yieldValue !== null && weight !== null
    && area >= 0 && yieldValue >= 0 && weight >= 0;
  const canUseDirectProduction = directProduction !== null && weight !== null
    && directProduction >= 0 && weight >= 0;
  if (!canUseDerivedProduction && !canUseDirectProduction) return null;
  const physicalProductionKg = canUseDerivedProduction ? area * yieldValue : directProduction;
  return {
    area,
    plotArea,
    yieldValue,
    weight,
    physicalProductionKg,
    weightedProductionKg: physicalProductionKg * weight,
    weightedAreaHa: (plotArea ?? area ?? 0) * weight
  };
}

function getFieldMap(headers, labelMetadata = null, fileName = 'unknown source') {
  const lowerHeaders = new Set(headers.map((header) => header.toLowerCase()));
  const fieldMap = Object.fromEntries(Object.entries(aliases).map(([field, candidates]) => [
    field,
    candidates.filter((candidate) => lowerHeaders.has(candidate.toLowerCase()))
  ]));
  if (labelMetadata) {
    fieldMap.loss = labelMetadata.lossFields;
    fieldMap.cropValueLabels = labelMetadata.cropValueLabels || {};
    fieldMap.cropCode = lowerHeaders.has('s2q4') ? ['s2q4'] : fieldMap.cropCode;
    fieldMap.cropName = lowerHeaders.has('s2q4') ? ['s2q4'] : fieldMap.cropName;
    fieldMap.lossFields = [...new Set(LOSS_FIELD_KEYS
      .map((key) => labelMetadata.lossFields[key])
      .filter((field) => field && field.unit === 'kg')
      .map((field) => field.column))];
    fieldMap.fileName = fileName;
  } else {
    fieldMap.lossFields = [];
  }
  return fieldMap;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function normalizeDistrictCode(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '').replace('nyarugenege', 'nyarugenge');
}

function isDisplayCropName(value) {
  return Boolean(String(value || '').trim()) && !/^\d+$/.test(String(value).trim());
}

function deduplicateRows(rows, fieldMap) {
  const seen = new Set();
  const retained = [];
  let removed = 0;
  rows.forEach((row) => {
    const lookup = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
    const keyParts = [fieldMap.farmerId, fieldMap.plotNumber, fieldMap.cropCode]
      .map((fields) => normalizeText(getCellFromLookup(lookup, fields || [])));
    if (keyParts.some((part) => !part)) {
      retained.push(row);
      return;
    }
    const fingerprint = JSON.stringify(Object.keys(row).sort().map((key) => normalizeText(row[key])));
    const key = `${keyParts.join('|')}|${fingerprint}`;
    if (seen.has(key)) {
      removed += 1;
      return;
    }
    seen.add(key);
    retained.push(row);
  });
  return { rows: retained, removed };
}

function calculateLossQuantity(lookup, fieldMap) {
  const resolvedLoss = fieldMap.loss;
  const lossColumn = (field) => field?.unit === 'kg' ? field.column : null;
  const totalLoss = parseNumber(getCellFromLookup(lookup, resolvedLoss ? [lossColumn(resolvedLoss.totalLoss)].filter(Boolean) : ['s2q38']));
  const otherLoss = parseNumber(getCellFromLookup(lookup, [lossColumn(resolvedLoss?.otherLoss)].filter(Boolean))) ?? 0;
  const stolenLoss = parseNumber(getCellFromLookup(lookup, resolvedLoss ? [lossColumn(resolvedLoss.theft)].filter(Boolean) : ['s2q40'])) ?? 0;
  const componentFields = resolvedLoss
    ? ['pests', 'birdsAnimals', 'fallenStalks', 'harvestLoss', 'transport', 'storage', 'processing', 'packaging', 'sales']
      .map((key) => lossColumn(resolvedLoss[key]))
      .filter(Boolean)
    : (fieldMap.lossFields || []).filter((field) => /^s2q4[1-9]$/i.test(field));
  const componentLoss = componentFields
    .map((field) => parseNumber(getCellFromLookup(lookup, [field])))
    .filter((value) => value !== null && value >= 0)
    .reduce((sum, value) => sum + value, 0);
  const lossColumns = resolvedLoss
    ? LOSS_FIELD_KEYS.map((key) => resolvedLoss[key]).filter((field) => field?.unit === 'kg').map((field) => field.column)
    : (fieldMap.lossFields || []);
  const hasNegativeLoss = lossColumns
    .map((field) => parseNumber(getCellFromLookup(lookup, [field])))
    .some((value) => value !== null && value < 0);
  const otherLossColumn = resolvedLoss ? resolvedLoss.otherLoss?.column : null;
  return {
    quantity: (totalLoss !== null && totalLoss > 0 ? totalLoss : componentLoss) + Math.max(0, otherLoss) + Math.max(0, stolenLoss),
    hasNegativeLoss,
    hasLossFields: totalLoss !== null || componentLoss > 0 || otherLoss > 0 || stolenLoss > 0 || Boolean(otherLossColumn && parseNumber(getCellFromLookup(lookup, [otherLossColumn])) !== null)
  };
}

function aggregateRows(rows, fieldMap) {
  const totals = {
    weightedProductionKg: 0,
    weightedAreaHa: 0,
    lossKg: 0,
    productionRows: 0,
    productionRowsWithValues: 0,
    districtMap: new Map(),
    districtAggregates: new Map(),
    cropMap: new Map(),
    warnings: [],
    negativeLossRows: 0,
    invalidLossRows: 0,
    cropNameFixes: 0,
    dedupRowsRemoved: 0
  };

  rows.forEach((row) => {
    const lookup = rowLookup(row);
    const production = calculateProductionMeasures(lookup, fieldMap);
    const sourceCrop = normalizeText(getCellFromLookup(lookup, fieldMap.cropName || []));
    const normalizedCrop = normalizeCropCode(sourceCrop, fieldMap.cropValueLabels || {});
    const crop = canonicalizeCropName(normalizedCrop?.name || sourceCrop);
    if (sourceCrop && crop !== sourceCrop) totals.cropNameFixes += 1;
    const cropCode = normalizedCrop?.code || normalizeText(getCellFromLookup(lookup, fieldMap.cropCode || []));
    const cropKey = cropCode || crop || 'Unknown';
    const district = normalizeDistrictCode(getCellFromLookup(lookup, fieldMap.districtCode));

    if (!production) {
      totals.warnings.push('Rows with missing or invalid production fields were excluded from production totals.');
      return;
    }

    const loss = calculateLossQuantity(lookup, fieldMap);
    if (loss.hasNegativeLoss) totals.negativeLossRows += 1;
    const lossKg = loss.hasLossFields && loss.quantity <= production.physicalProductionKg ? loss.quantity * production.weight : null;
    if (loss.hasLossFields && lossKg === null) totals.invalidLossRows += 1;

    totals.weightedProductionKg += production.weightedProductionKg;
    totals.weightedAreaHa += production.weightedAreaHa;
    totals.lossKg += lossKg ?? 0;
    totals.productionRowsWithValues += 1;

    const cropStats = totals.cropMap.get(cropKey) || { crop: crop || 'Unknown', cropCode, productionKg: 0, weightedAreaHa: 0, lossKg: 0, rows: 0 };
    cropStats.productionKg += production.weightedProductionKg;
    cropStats.weightedAreaHa += production.weightedAreaHa;
    cropStats.lossKg += lossKg ?? 0;
    cropStats.rows += 1;
    totals.cropMap.set(cropKey, cropStats);

    const districtStats = totals.districtMap.get(district || 'unknown') || { productionKg: 0, lossKg: 0, rows: 0, hasLoss: false };
    const districtAggregate = totals.districtAggregates.get(district || 'unknown') || {
      weightedProductionKg: 0,
      weightedAreaHa: 0,
      lossKg: 0,
      productionRows: 0,
      productionRowsWithValues: 0,
      districtMap: new Map(),
      cropMap: new Map(),
      warnings: [],
      negativeLossRows: 0
    };
    districtStats.productionKg += production.weightedProductionKg;
    districtStats.lossKg += lossKg ?? 0;
    districtStats.rows += 1;
    districtStats.hasLoss = districtStats.hasLoss || lossKg !== null;
    totals.districtMap.set(district || 'unknown', districtStats);
    districtAggregate.weightedProductionKg += production.weightedProductionKg;
    districtAggregate.weightedAreaHa += production.weightedAreaHa;
    districtAggregate.lossKg += lossKg ?? 0;
    districtAggregate.productionRows += 1;
    districtAggregate.productionRowsWithValues += 1;
    const districtCropStats = districtAggregate.cropMap.get(cropKey) || { crop: crop || 'Unknown', cropCode, productionKg: 0, weightedAreaHa: 0, lossKg: 0, rows: 0 };
    districtCropStats.productionKg += production.weightedProductionKg;
    districtCropStats.weightedAreaHa += production.weightedAreaHa;
    districtCropStats.lossKg += lossKg ?? 0;
    districtCropStats.rows += 1;
    districtAggregate.cropMap.set(cropKey, districtCropStats);
    districtAggregate.districtMap.set(district || 'unknown', districtStats);
    totals.districtAggregates.set(district || 'unknown', districtAggregate);
  });

  totals.productionRows = rows.length;
  if (!fieldMap.yield.length) totals.warnings.push('No yield field was found in this source file.');
  if (!(fieldMap.directProductionKg || []).length) totals.warnings.push('No direct production field was found in this source file.');
  if (!fieldMap.weight.length) totals.warnings.push('No survey weight field was found in this source file.');
  if (!fieldMap.lossFields?.length) totals.warnings.push(`No supported loss fields were found in ${fieldMap.fileName || 'this source file'}.`);
  if (totals.negativeLossRows) totals.warnings.push(`${totals.negativeLossRows} rows contained negative loss values; those values were excluded.`);
  if (totals.invalidLossRows) totals.warnings.push(`${totals.invalidLossRows} rows reported loss greater than production; their loss values were excluded.`);

  return totals;
}

function loadPeriod(config) {
  if (!fs.existsSync(config.filePath)) {
    return {
      ...config,
      available: false,
      headers: [],
      rows: [],
      invalidRows: 0,
      warnings: [`Source file is missing: ${config.relativePath}`]
    };
  }

  const aggregateCachePath = `${config.filePath}.isuka-aggregate.json`;
  const cacheKey = `${fs.statSync(config.filePath).mtimeMs}:${AGGREGATE_CALC_VERSION}`;
  if (fs.existsSync(aggregateCachePath) && fs.statSync(aggregateCachePath).mtimeMs >= fs.statSync(config.filePath).mtimeMs) {
    try {
      const cached = JSON.parse(fs.readFileSync(aggregateCachePath, 'utf8'));
      if (cached.cacheKey === cacheKey && cached.aggregate && Array.isArray(cached.headers)) {
        return { ...config, available: true, headers: cached.headers, rows: [], rowCount: cached.rowCount, invalidRows: cached.invalidRows, delimiter: cached.delimiter, fieldMap: cached.fieldMap, aggregate: deserializeAggregate(cached.aggregate) };
      }
    } catch {
      fs.rmSync(aggregateCachePath, { force: true });
    }
  }

  const parsed = isStructuredDataset(config.filePath)
    ? readStructuredDataset(config.filePath)
    : readDelimitedFile(config.filePath);
  const labelMetadata = readDatasetLabelMetadata(config, parsed.headers, true);
  const fieldMap = getFieldMap(parsed.headers, labelMetadata, config.relativePath);
  const deduplicated = deduplicateRows(parsed.rows, fieldMap);
  const aggregate = aggregateRows(deduplicated.rows, fieldMap);
  aggregate.dedupRowsRemoved = deduplicated.removed;
  if (deduplicated.removed) aggregate.warnings.push(`${deduplicated.removed} exact duplicate rows were removed from ${config.key}.`);
  if (aggregate.cropNameFixes) aggregate.warnings.push(`${aggregate.cropNameFixes} crop labels were canonicalized in ${config.key}.`);
  const period = {
    ...config,
    available: true,
    headers: parsed.headers,
    rows: parsed.rows,
    invalidRows: parsed.invalidRows,
    delimiter: parsed.delimiter,
    fieldMap,
    aggregate,
    rowCount: parsed.rows.length
  };
  fs.writeFileSync(aggregateCachePath, JSON.stringify({ cacheKey, calculationVersion: AGGREGATE_CALC_VERSION, headers: parsed.headers, rowCount: parsed.rows.length, invalidRows: parsed.invalidRows, delimiter: parsed.delimiter, fieldMap, aggregate: serializeAggregate(aggregate) }));
  return period;
}

function serializeAggregate(aggregate) {
  const serializeMap = (map) => [...map.entries()].map(([key, value]) => [key, value]);
  const districtAggregates = [...aggregate.districtAggregates.entries()].map(([key, value]) => [key, {
    ...value,
    districtMap: serializeMap(value.districtMap),
    cropMap: serializeMap(value.cropMap)
  }]);
  return { ...aggregate, districtMap: serializeMap(aggregate.districtMap), districtAggregates, cropMap: serializeMap(aggregate.cropMap) };
}

function deserializeAggregate(serialized) {
  const deserializeMap = (entries) => new Map(entries || []);
  const aggregate = { ...serialized, districtMap: deserializeMap(serialized.districtMap), districtAggregates: deserializeMap(serialized.districtAggregates), cropMap: deserializeMap(serialized.cropMap) };
  aggregate.districtAggregates.forEach((districtAggregate) => {
    districtAggregate.districtMap = deserializeMap(districtAggregate.districtMap);
    districtAggregate.cropMap = deserializeMap(districtAggregate.cropMap);
  });
  return aggregate;
}

function readStatFile(filePath) {
  const cachePath = `${filePath}.isuka-cache.json`;
  const sourceMtime = fs.statSync(filePath).mtimeMs;
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= sourceMtime) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(cached.headers) && Array.isArray(cached.rows)) return cached;
    } catch {
      fs.rmSync(cachePath, { force: true });
    }
  }

  const result = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname, 'read-stat-file.py'), filePath], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not read statistical dataset ${filePath}: ${result.stderr || result.error?.message || 'Python reader failed'}`);
  }
  const parsed = { ...JSON.parse(result.stdout), delimiter: 'statistical-file', invalidRows: 0 };
  fs.writeFileSync(cachePath, JSON.stringify(parsed));
  return parsed;
}

function loadAllPeriods() {
  return datasetFiles.map(loadPeriod);
}

function pickPeriod(periods, year, season) {
  return periods.find((period) => period.year === Number(year) && period.season === season);
}

function buildOverview(periods, requestedYear, requestedSeason) {
  const availablePeriods = periods.filter((period) => period.available);
  const latest = pickPeriod(availablePeriods, requestedYear, requestedSeason)
    || [...availablePeriods].sort((left, right) => right.year - left.year || right.season.localeCompare(left.season))[0];
  if (!latest) throw new Error('No configured production dataset is available.');

  const previous = pickPeriod(availablePeriods, latest.year - 1, latest.season);
  const stats = latest.aggregate;
  const previousStats = previous?.aggregate;
  const districtEntries = [...stats.districtMap.entries()].filter(([, value]) => value.productionKg > 0);
  const riskDistribution = { low: 0, moderate: 0, high: 0 };

  districtEntries.forEach(([, value]) => {
    const ratio = value.lossKg / value.productionKg * 100;
    riskDistribution[riskTier(ratio)] += 1;
  });

  const warnings = [...new Set([
    ...stats.warnings,
    ...(latest.invalidRows ? [`${latest.invalidRows} malformed rows were excluded from ${latest.key}.`] : []),
    ...(previous ? previous.aggregate.warnings : []),
    ...(previous ? [] : [`No comparison period is available for ${latest.year}-${latest.season}.`])
  ])];

  const lossPercent = stats.lossKg > 0 && stats.weightedProductionKg > 0
    ? stats.lossKg / stats.weightedProductionKg * 100
    : null;
  const previousLossPercent = previousStats && previousStats.lossKg > 0 && previousStats.weightedProductionKg > 0
    ? previousStats.lossKg / previousStats.weightedProductionKg * 100
    : null;
  const change = (current, prior) => current !== null && prior !== null && prior !== 0 ? (current - prior) / prior * 100 : null;

  return {
    period: { year: latest.year, season: latest.season },
    kpis: {
      weightedProductionKg: stats.weightedProductionKg || null,
      arableLandHa: stats.weightedAreaHa || null,
      postHarvestLossPercent: lossPercent,
      districtCount: districtEntries.length || null,
      highRiskDistrictCount: riskDistribution.high || null
    },
    trends: {
      weightedProductionPercent: change(stats.weightedProductionKg, previousStats?.weightedProductionKg ?? null),
      arableLandPercent: change(stats.weightedAreaHa, previousStats?.weightedAreaHa ?? null),
      postHarvestLossPercent: change(lossPercent, previousLossPercent)
    },
    productionByCrop: [...stats.cropMap.entries()]
      .filter(([, value]) => isDisplayCropName(value.crop))
      .map(([crop, value]) => ({ crop: value.crop || crop, cropCode: value.cropCode || crop, productionKg: value.productionKg, rows: value.rows }))
      .sort((left, right) => right.productionKg - left.productionKg),
    districtPerformance: [...stats.districtMap.entries()]
      .map(([district, value]) => {
        const aggregate = stats.districtAggregates?.get(district);
        const crops = aggregate?.cropMap || new Map();
        const primaryCrop = [...crops.entries()].filter(([, crop]) => isDisplayCropName(crop.crop)).sort((left, right) => right[1].productionKg - left[1].productionKg)[0]?.[1]?.crop || 'Other or unclassified';
        return {
          district,
          primaryCrop,
          productionKg: value.productionKg,
          areaHa: aggregate?.weightedAreaHa ?? null,
          rows: value.rows,
          lossPercent: value.productionKg > 0 ? value.lossKg / value.productionKg * 100 : null,
          riskTier: riskTier(value.productionKg > 0 ? value.lossKg / value.productionKg * 100 : null)
        };
      })
      .sort((left, right) => right.productionKg - left.productionKg),
    riskDistribution: Object.entries(riskDistribution).map(([tier, districtCount]) => ({ tier, districtCount })),
    dataQuality: {
      sourceFiles: [latest.relativePath, ...(previous ? [previous.relativePath] : [])],
      periodsLoaded: availablePeriods.map((period) => period.key),
      rowsRead: latest.rows.length,
      rowsUsed: stats.productionRowsWithValues,
      invalidRows: latest.invalidRows,
      warnings,
      calculationTimestamp: new Date().toISOString(),
      units: {
        weightedProductionKg: 'kg',
        arableLandHa: 'ha',
        postHarvestLossPercent: 'percent'
      },
      formulas: {
        weightedProductionKg: 'crop area (ha) * yield (kg/ha) * survey weight',
        arableLandHa: 'plot area (ha) * survey weight',
        postHarvestLossPercent: 'non-negative reported loss components * survey weight / weighted production * 100'
      }
    }
  };
}

function mergeAggregates(aggregates) {
  const merged = {
    weightedProductionKg: 0,
    weightedAreaHa: 0,
    lossKg: 0,
    productionRows: 0,
    productionRowsWithValues: 0,
    districtMap: new Map(),
    districtAggregates: new Map(),
    cropMap: new Map(),
    warnings: [],
    negativeLossRows: 0
  };

  aggregates.forEach((aggregate) => {
    merged.weightedProductionKg += aggregate.weightedProductionKg;
    merged.weightedAreaHa += aggregate.weightedAreaHa;
    merged.lossKg += aggregate.lossKg;
    merged.productionRows += aggregate.productionRows;
    merged.productionRowsWithValues += aggregate.productionRowsWithValues;
    merged.negativeLossRows += aggregate.negativeLossRows;
    merged.warnings.push(...aggregate.warnings);

    aggregate.districtMap.forEach((value, key) => {
      const target = merged.districtMap.get(key) || { productionKg: 0, lossKg: 0, rows: 0, hasLoss: false };
      target.productionKg += value.productionKg;
      target.lossKg += value.lossKg;
      target.rows += value.rows;
      target.hasLoss = target.hasLoss || value.hasLoss;
      merged.districtMap.set(key, target);
    });

    aggregate.cropMap.forEach((value, key) => {
      const target = merged.cropMap.get(key) || { crop: value.crop || key, cropCode: value.cropCode || '', productionKg: 0, weightedAreaHa: 0, lossKg: 0, rows: 0 };
      target.productionKg += value.productionKg;
      target.weightedAreaHa += value.weightedAreaHa || 0;
      target.lossKg += value.lossKg || 0;
      target.rows += value.rows;
      merged.cropMap.set(key, target);
    });

    (aggregate.districtAggregates || new Map()).forEach((districtAggregate, key) => {
      const target = merged.districtAggregates.get(key) || {
        weightedProductionKg: 0, weightedAreaHa: 0, lossKg: 0, productionRows: 0,
        productionRowsWithValues: 0, districtMap: new Map(), cropMap: new Map(), warnings: [], negativeLossRows: 0
      };
      target.weightedProductionKg += districtAggregate.weightedProductionKg;
      target.weightedAreaHa += districtAggregate.weightedAreaHa;
      target.lossKg += districtAggregate.lossKg;
      target.productionRows += districtAggregate.productionRows;
      target.productionRowsWithValues += districtAggregate.productionRowsWithValues;
      districtAggregate.cropMap.forEach((value, crop) => {
        const cropTarget = target.cropMap.get(crop) || { crop: value.crop || crop, cropCode: value.cropCode || '', productionKg: 0, weightedAreaHa: 0, lossKg: 0, rows: 0 };
        cropTarget.productionKg += value.productionKg;
        cropTarget.weightedAreaHa += value.weightedAreaHa || 0;
        cropTarget.lossKg += value.lossKg || 0;
        cropTarget.rows += value.rows;
        target.cropMap.set(crop, cropTarget);
      });
      merged.districtAggregates.set(key, target);
    });
  });

  merged.warnings = [...new Set(merged.warnings)];
  return merged;
}

function buildFilteredOverview(periods, yearFilter = '2025', districtFilter = 'all', seasonFilter = 'all') {
  const available = periods.filter((period) => period.available);
  const seasonMatching = seasonFilter === 'all' ? available : available.filter((period) => period.season === seasonFilter);
  const matching = yearFilter === 'all'
    ? seasonMatching
    : seasonMatching.filter((period) => period.year === Number(yearFilter));
  if (!matching.length) throw new Error('No production dataset is available for the selected year.');

  const district = normalizeDistrictCode(districtFilter);
  const districtValues = (period) => period.aggregate?.districtMap
    ? [...period.aggregate.districtMap.keys()]
    : period.rows.map((row) => normalizeDistrictCode(getCell(row, period.fieldMap.districtCode))).filter(Boolean);
  const availableDistricts = [...new Set(periods.filter((period) => period.available).flatMap(districtValues))].sort();
  const aggregatePeriod = (periodGroup) => mergeAggregates(periodGroup.map((period) => {
    if (district === 'all' && period.aggregate) return period.aggregate;
    if (district === 'all') return aggregateRows(period.rows, period.fieldMap);
    if (period.aggregate?.districtAggregates?.has(district)) return period.aggregate.districtAggregates.get(district);
    const rows = period.rows.filter((row) => normalizeDistrictCode(getCell(row, period.fieldMap.districtCode)) === district);
    return aggregateRows(rows, period.fieldMap);
  }));

  const latestYear = Math.max(...matching.map((period) => period.year));
  const latestPeriods = yearFilter === 'all' ? matching : matching.filter((period) => period.year === latestYear);
  const previousPeriods = yearFilter === 'all'
    ? []
    : available.filter((period) => period.year === latestYear - 1 && (seasonFilter === 'all' || period.season === seasonFilter));
  const latestSeason = seasonFilter === 'all' ? 'C' : seasonFilter;
  const latest = { key: `${latestYear}-${latestSeason}`, year: latestYear, season: latestSeason, available: true, rows: [], rowCount: latestPeriods.reduce((sum, period) => sum + (period.rowCount ?? period.rows.length), 0), invalidRows: latestPeriods.reduce((sum, period) => sum + period.invalidRows, 0), aggregate: aggregatePeriod(latestPeriods), relativePath: latestPeriods.map((period) => period.relativePath).join('; ') };
  const previous = previousPeriods.length
    ? { key: `${latestYear - 1}-${latestSeason}`, year: latestYear - 1, season: latestSeason, available: true, rows: [], rowCount: previousPeriods.reduce((sum, period) => sum + (period.rowCount ?? period.rows.length), 0), invalidRows: previousPeriods.reduce((sum, period) => sum + period.invalidRows, 0), aggregate: aggregatePeriod(previousPeriods), relativePath: previousPeriods.map((period) => period.relativePath).join('; ') }
    : null;

  const overview = buildOverview([latest, ...(previous ? [previous] : [])], latestYear, 'C');
  overview.period.season = seasonFilter === 'all' ? 'All seasons' : seasonFilter;
  overview.filters = {
    year: yearFilter,
    district: districtFilter,
    season: seasonFilter,
    availableYears: [...new Set(available.map((period) => period.year))].sort((left, right) => left - right),
    availableSeasons: [...new Set(available.map((period) => period.season))].sort(),
    availableDistricts
  };
  overview.dataQuality.sourceFiles = matching.map((period) => period.relativePath);
  overview.dataQuality.periodsLoaded = matching.map((period) => period.key);
  overview.dataQuality.rowsRead = latest.rowCount;
  overview.dataQuality.invalidRows = latest.invalidRows;
  return overview;
}

function latestPeriodsForDistricts(periods, yearFilter) {
  const available = periods.filter((period) => period.available);
  return yearFilter === 'all' ? available : available.filter((period) => period.year === Number(yearFilter));
}

function buildTimeSeries(periods, districtFilter = 'all', cropFilter = 'all') {
  const district = normalizeDistrictCode(districtFilter);
  const crop = normalizeText(cropFilter).toLowerCase();
  return periods.filter((period) => period.available).map((period) => {
    let aggregate = district === 'all'
      ? period.aggregate
      : period.aggregate?.districtAggregates?.get(district);
    if (!aggregate) return null;
    if (crop !== 'all') {
      const cropEntry = aggregate.cropMap?.get(crop)
        || [...(aggregate.cropMap || new Map()).entries()].find(([key, value]) => String(key).toLowerCase() === crop || String(value.cropCode || '').toLowerCase() === crop)?.[1];
      if (!cropEntry) return null;
      aggregate = { weightedProductionKg: cropEntry.productionKg, weightedAreaHa: cropEntry.weightedAreaHa, lossKg: cropEntry.lossKg, productionRowsWithValues: cropEntry.rows };
    }
    const weightedProductionKg = aggregate.weightedProductionKg || 0;
    const lossKg = aggregate.lossKg || 0;
    const lossPercent = weightedProductionKg > 0 ? lossKg / weightedProductionKg * 100 : null;
    return {
      year: period.year,
      season: period.season,
      districtCode: districtFilter === 'all' ? 'all' : district,
      cropCode: cropFilter === 'all' ? 'all' : cropFilter,
      weightedProductionKg,
      weightedAreaHa: aggregate.weightedAreaHa || 0,
      lossKg,
      lossPercent,
      riskTier: riskTier(lossPercent),
      rowCount: aggregate.productionRowsWithValues || 0
    };
  }).filter(Boolean).sort((left, right) => left.year - right.year || left.season.localeCompare(right.season));
}

function buildDetailedTimeSeries(periods) {
  const entries = [];
  periods.filter((period) => period.available).forEach((period) => {
    period.aggregate?.districtAggregates?.forEach((districtAggregate, districtCode) => {
      districtAggregate.cropMap?.forEach((cropEntry, cropCode) => {
        const weightedProductionKg = cropEntry.productionKg || 0;
        const lossKg = cropEntry.lossKg || 0;
        const lossPercent = weightedProductionKg > 0 ? lossKg / weightedProductionKg * 100 : null;
        entries.push({
          year: period.year,
          season: period.season,
          districtCode,
          cropCode,
          cropName: cropEntry.crop || cropCode,
          weightedProductionKg,
          weightedAreaHa: cropEntry.weightedAreaHa || 0,
          lossKg,
          lossPercent,
          riskTier: riskTier(lossPercent),
          rowCount: cropEntry.rows || 0
        });
      });
    });
  });
  return entries.sort((left, right) => left.districtCode.localeCompare(right.districtCode) || left.cropCode.localeCompare(right.cropCode) || left.year - right.year || left.season.localeCompare(right.season));
}

module.exports = { aliases, getFieldMap, aggregateRows, loadPeriod, loadAllPeriods, buildOverview, buildFilteredOverview, buildTimeSeries, buildDetailedTimeSeries, normalizeDistrictCode, deduplicateRows, calculateLossQuantity, calculateProductionMeasures, rowLookup, serializeAggregate, deserializeAggregate, AGGREGATE_CALC_VERSION };
