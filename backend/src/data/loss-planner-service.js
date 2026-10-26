const fs = require('node:fs');
const path = require('node:path');
const { datasetFiles, repositoryRoot } = require('./dataset-config');
const { readDelimitedFile, parseNumber, normalizeText } = require('./parser');
const { isStructuredDataset, readStructuredDataset } = require('./structured-reader');
const {
  getFieldMap,
  deduplicateRows,
  calculateLossQuantity,
  calculateProductionMeasures,
  rowLookup,
  normalizeDistrictCode
} = require('./overview-service');
const { readDatasetLabelMetadata } = require('./loss-field-resolver');
const { LOSS_STAGE_GROUPS } = require('./loss-field-config');
const { normalizeCropCode } = require('./crop-name-map');

const LOSS_PLANNER_CALC_VERSION = 'loss-planner-v3';
const MIN_PRICE_RECORDS = 30;
const STAGE_IDS = LOSS_STAGE_GROUPS.map((stage) => stage.id);
const cachePath = path.join(repositoryRoot, 'backend', 'data', 'loss-planner-cache.json');
const publishedPeriodCache = new Map();

function weightedMedian(entries) {
  const values = entries.filter((entry) => Number.isFinite(entry.price) && entry.price > 0 && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((left, right) => left.price - right.price);
  if (!values.length) return null;
  const midpoint = values.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let cumulative = 0;
  for (const entry of values) {
    cumulative += entry.weight;
    if (cumulative >= midpoint) return entry.price;
  }
  return values.at(-1).price;
}

function parseSelection(value, availableValues, defaultToAll = true) {
  if (value === undefined || value === null || String(value).trim() === '') return defaultToAll ? [...availableValues] : [];
  const tokens = String(value).split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.some((token) => token.toLowerCase() === 'all')) return [...availableValues];
  return [...new Set(tokens)];
}

function loadSourceRows(period, strict) {
  const parsed = isStructuredDataset(period.filePath)
    ? readStructuredDataset(period.filePath)
    : readDelimitedFile(period.filePath);
  const labelMetadata = readDatasetLabelMetadata(period, parsed.headers, strict);
  const fieldMap = getFieldMap(parsed.headers, labelMetadata, period.relativePath);
  const deduplicated = deduplicateRows(parsed.rows, fieldMap);
  return { rows: deduplicated.rows, headers: parsed.headers, fieldMap, removedDuplicates: deduplicated.removed };
}

function buildPeriodMetadata(periods) {
  return LOSS_STAGE_GROUPS.map((group) => {
    const availablePeriods = [];
    let anyUnconfirmed = false;
    for (const period of periods) {
      const { fieldMap } = loadSourceRows(period, true);
      const fields = group.fields.map((field) => fieldMap.loss[field]);
      if (fields.every((field) => field && field.status === 'confirmed' && field.unit === 'kg')) {
        availablePeriods.push({ year: period.year, season: period.season });
      } else if (fields.some((field) => field && field.status !== 'confirmed')) {
        anyUnconfirmed = true;
      }
    }
    return {
      id: group.id,
      label: group.label,
      availablePeriods,
      unitStatus: availablePeriods.length && !anyUnconfirmed ? 'confirmed' : 'unconfirmed'
    };
  });
}

function sumFieldValues(lookup, columns) {
  return columns.map((column) => parseNumber(lookup[column.toLowerCase()]))
    .filter((value) => value !== null && value >= 0)
    .reduce((sum, value) => sum + value, 0);
}

function buildPeriodCache(period) {
  const { rows, fieldMap, removedDuplicates } = loadSourceRows(period, true);
  const cropMetadata = fieldMap.cropValueLabels || {};
  const stages = LOSS_STAGE_GROUPS.map((group) => {
    const fields = group.fields.map((key) => fieldMap.loss[key]);
    return {
      ...group,
      available: fields.every((field) => field && field.status === 'confirmed' && field.unit === 'kg'),
      columns: fields.map((field) => field?.column || null)
    };
  });
  const districts = new Map();
  const cropNames = new Map();
  const cells = new Map();
  let stageExceedTotalRows = 0;
  let invalidLossRows = 0;
  let negativeLossRows = 0;

  for (const row of rows) {
    const lookup = rowLookup(row);
    const measures = calculateProductionMeasures(lookup, fieldMap);
    if (!measures) continue;
    const districtCode = normalizeDistrictCode(normalizeText(lookup.s1q2 || lookup.district_code || lookup.district));
    const districtName = normalizeText(lookup.s1q2 || lookup.district || districtCode);
    const province = normalizeText(lookup.s1q1 || lookup.province || '');
    const cropValue = normalizeText(lookup.s2q4 ?? lookup.crop_code ?? lookup.crop ?? '');
    const crop = normalizeCropCode(cropValue, cropMetadata);
    const cropCode = crop?.code || `name:${cropValue.toLowerCase()}`;
    const cropName = crop?.name || cropValue;
    if (!districtCode || !cropCode) continue;
    districts.set(districtCode, { code: districtCode, name: districtName, province });
    cropNames.set(cropCode, cropName);
    const key = `${districtCode}\u0000${cropCode}`;
    const cell = cells.get(key) || {
      d: districtCode,
      c: cropCode,
      productionKg: 0,
      stageKg: Object.fromEntries(STAGE_IDS.map((id) => [id, 0])),
      availableStages: new Set(stages.filter((stage) => stage.available).map((stage) => stage.id)),
      unattributedKg: 0,
      totalLossKg: 0,
      records: 0,
      stageRecords: 0,
      stageProductionKg: 0,
      lossRecords: 0,
      priceEntries: [],
      excludedStageRows: 0
    };
    cell.productionKg += measures.weightedProductionKg;
    cell.records += 1;

    const loss = calculateLossQuantity(lookup, fieldMap);
    if (loss.hasNegativeLoss) negativeLossRows += 1;
    const validLoss = loss.hasLossFields && loss.quantity <= measures.physicalProductionKg;
    if (loss.hasLossFields && !validLoss) invalidLossRows += 1;

    const valuesByStage = {};
    let stageTotalKg = 0;
    let hasStageData = false;
    for (const stage of stages) {
      if (!stage.available) continue;
      const values = stage.columns.map((column) => column ? parseNumber(lookup[column.toLowerCase()]) : null);
      if (values.some((value) => value !== null)) hasStageData = true;
      const quantity = values.filter((value) => value !== null && value >= 0).reduce((sum, value) => sum + value, 0);
      valuesByStage[stage.id] = quantity;
      stageTotalKg += quantity;
    }

    if (hasStageData) {
      cell.stageRecords += 1;
      cell.stageProductionKg += measures.weightedProductionKg;
    }

    if (validLoss) {
      const weightedLoss = loss.quantity * measures.weight;
      cell.totalLossKg += weightedLoss;
      cell.lossRecords += 1;
      if (hasStageData) {
        if (stageTotalKg > loss.quantity) {
          stageExceedTotalRows += 1;
          cell.excludedStageRows += 1;
          cell.unattributedKg += weightedLoss;
        } else {
          for (const stage of stages) {
            if (!stage.available) continue;
            const value = valuesByStage[stage.id];
            cell.stageKg[stage.id] += value * measures.weight;
          }
          cell.unattributedKg += Math.max(0, loss.quantity - stageTotalKg) * measures.weight;
        }
      } else {
        cell.unattributedKg += weightedLoss;
      }
    }

    const priceField = fieldMap.loss.pricePerKg;
    const price = priceField?.status === 'confirmed' && priceField.unit === 'RWF/kg'
      ? parseNumber(lookup[priceField.column.toLowerCase()])
      : null;
    if (price !== null && price > 0) cell.priceEntries.push({ price, weight: measures.weightedProductionKg });
    cells.set(key, cell);
  }

  return {
    period: { year: period.year, season: period.season },
    sourceFields: Object.entries(fieldMap.loss).map(([id, field]) => ({
      id,
      column: field?.column || null,
      label: field?.label || null,
      unit: field?.unit || null,
      unitStatus: field?.status || 'unconfirmed'
    })),
    districts: [...districts.values()],
    cropNames: [...cropNames.entries()],
    stages,
    cells: [...cells.values()].map((cell) => ({
      ...cell,
      stageKg: Object.fromEntries(Object.entries(cell.stageKg).map(([id, value]) => [id, cell.availableStages.has(id) ? value : null])),
      availableStages: [...cell.availableStages],
      stageCoveragePct: cell.productionKg > 0 ? cell.stageProductionKg / cell.productionKg * 100 : null,
      totalLossKg: cell.lossRecords ? cell.totalLossKg : null,
      priceRecordCount: cell.priceEntries.length,
      priceEntries: cell.priceEntries,
      priceRwfPerKg: weightedMedian(cell.priceEntries),
      removedDuplicates
    })),
    counters: { stageExceedTotalRows, invalidLossRows, negativeLossRows, removedDuplicates }
  };
}

function getPeriodCache(periods) {
  if (process.env.VERCEL) {
    const selectedPeriods = periods.map((period) => {
      if (!publishedPeriodCache.has(period.key)) {
        const artifactPath = path.join(repositoryRoot, 'backend', 'data', 'dist', 'loss-planner', `${period.key}.json`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        if (artifact.calcVersion !== LOSS_PLANNER_CALC_VERSION || artifact.entry?.period?.year !== period.year || artifact.entry?.period?.season !== period.season) {
          throw new Error(`Published loss-planner artifact ${period.key} is missing or incompatible.`);
        }
        publishedPeriodCache.set(period.key, artifact.entry);
      }
      return publishedPeriodCache.get(period.key);
    });
    return { calculationVersion: LOSS_PLANNER_CALC_VERSION, generatedAt: new Date().toISOString(), periods: selectedPeriods };
  }

  const cachedPeriods = periods.map((period) => {
    const periodCachePath = `${period.filePath}.isuka-loss-planner.json`;
    const cacheKey = `${LOSS_PLANNER_CALC_VERSION}:${fs.statSync(period.filePath).mtimeMs}`;
    if (fs.existsSync(periodCachePath)) {
    try {
        const cached = JSON.parse(fs.readFileSync(periodCachePath, 'utf8'));
        if (cached.cacheKey === cacheKey && cached.calculationVersion === LOSS_PLANNER_CALC_VERSION) return cached.period;
    } catch {
        fs.rmSync(periodCachePath, { force: true });
      }
    }
    const cached = buildPeriodCache(period);
    fs.writeFileSync(periodCachePath, JSON.stringify({ cacheKey, calculationVersion: LOSS_PLANNER_CALC_VERSION, generatedAt: new Date().toISOString(), period: cached }));
    return cached;
  });
  return { calculationVersion: LOSS_PLANNER_CALC_VERSION, generatedAt: new Date().toISOString(), periods: cachedPeriods };
}

function availablePeriodsFor(cache) {
  return cache.periods.map((period) => period.period).sort((a, b) => a.year - b.year || a.season.localeCompare(b.season));
}

function selectPeriods(cache, years, seasons) {
  const available = availablePeriodsFor(cache);
  const selectedYears = parseSelection(years, [...new Set(available.map((period) => String(period.year)))]);
  const selectedSeasons = parseSelection(seasons, ['A', 'B', 'C']);
  return cache.periods.filter((period) => selectedYears.includes(String(period.period.year)) && selectedSeasons.includes(period.period.season));
}

function buildBaseline({ years, seasons } = {}) {
  const availablePeriods = datasetFiles.filter((period) => period.year >= 2020 && period.year <= 2025);
  const selectedYears = parseSelection(years, [...new Set(availablePeriods.map((period) => String(period.year)))]);
  const selectedSeasons = parseSelection(seasons, ['A', 'B', 'C']);
  const selectedConfigs = availablePeriods.filter((period) => selectedYears.includes(String(period.year)) && selectedSeasons.includes(period.season));
  const cache = getPeriodCache(selectedConfigs);
  const selected = selectPeriods(cache, years, seasons);
  if (!selected.length) throw new Error('No loss-planner periods match the requested years and seasons.');
  const periods = selected.map((entry) => entry.period);
  const districtMap = new Map();
  const cropMap = new Map();
  const stageAvailability = new Map(LOSS_STAGE_GROUPS.map((stage) => [stage.id, { label: stage.label, available: new Map() }]));
  const combined = new Map();
  const nationalPriceEntries = new Map();
  let stageExceedTotalRows = 0;
  let invalidLossRows = 0;
  let negativeLossRows = 0;

  for (const entry of selected) {
    const periodKey = `${entry.period.year}-${entry.period.season}`;
    for (const district of entry.districts) districtMap.set(district.code, district);
    for (const [code, name] of entry.cropNames) cropMap.set(code, name);
    for (const stage of entry.stages) stageAvailability.get(stage.id).available.set(periodKey, stage.available);
    stageExceedTotalRows += entry.counters.stageExceedTotalRows;
    invalidLossRows += entry.counters.invalidLossRows;
    negativeLossRows += entry.counters.negativeLossRows;
    for (const cell of entry.cells) {
      const key = `${cell.d}\u0000${cell.c}`;
      const target = combined.get(key) || {
        d: cell.d,
        c: cell.c,
        productionKg: 0,
        stageKg: Object.fromEntries(STAGE_IDS.map((id) => [id, null])),
        stageAvailable: new Set(),
        unattributedKg: 0,
        hasUnattributed: false,
        totalLossKg: 0,
        hasTotalLoss: false,
        records: 0,
        stageRecords: 0,
        stageProductionKg: 0,
        priceEntries: [],
        priceRecordCount: 0,
        excludedStageRows: 0
      };
      target.productionKg += cell.productionKg;
      target.records += cell.records;
      target.stageRecords += cell.stageRecords;
      target.stageProductionKg += cell.stageProductionKg;
      target.priceRecordCount += cell.priceRecordCount;
      target.excludedStageRows += cell.excludedStageRows;
      if (cell.totalLossKg !== null) {
        target.totalLossKg += cell.totalLossKg;
        target.hasTotalLoss = true;
      }
      if (cell.unattributedKg !== null) {
        target.unattributedKg += cell.unattributedKg;
        target.hasUnattributed = true;
      }
      for (const stageId of STAGE_IDS) {
        if (cell.stageKg[stageId] === null) continue;
        target.stageKg[stageId] = (target.stageKg[stageId] ?? 0) + cell.stageKg[stageId];
        target.stageAvailable.add(stageId);
      }
      if (cell.priceRwfPerKg !== null) {
        const periodEntries = entry.cells.find((value) => value.d === cell.d && value.c === cell.c)?.priceEntries || [];
        target.priceEntries.push(...periodEntries);
        const nationalKey = cell.c;
        const entriesForCrop = nationalPriceEntries.get(nationalKey) || [];
        entriesForCrop.push(...periodEntries);
        nationalPriceEntries.set(nationalKey, entriesForCrop);
      }
      combined.set(key, target);
    }
  }

  const rows = [...combined.values()].map((row) => {
    const districtPrice = row.priceRecordCount >= MIN_PRICE_RECORDS ? weightedMedian(row.priceEntries) : null;
    const cropPriceEntries = nationalPriceEntries.get(row.c) || [];
    const nationalPrice = weightedMedian(cropPriceEntries);
    return {
      d: row.d,
      c: row.c,
      productionKg: row.productionKg,
      stageKg: Object.fromEntries(STAGE_IDS.map((id) => [id, row.stageAvailable.has(id) ? row.stageKg[id] : null])),
      unattributedKg: row.hasUnattributed ? Math.max(0, row.unattributedKg) : null,
      totalLossKg: row.hasTotalLoss ? row.totalLossKg : null,
      records: row.records,
      stageRecords: row.stageRecords,
      stageCoveragePct: row.productionKg > 0 ? row.stageProductionKg / row.productionKg * 100 : null,
      priceRwfPerKg: districtPrice ?? nationalPrice,
      priceBasis: districtPrice !== null ? 'district' : nationalPrice !== null ? 'national' : 'none',
      priceRecordCount: row.priceRecordCount,
      excludedStageRows: row.excludedStageRows
    };
  }).sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c));

  const stages = LOSS_STAGE_GROUPS.map((group) => {
    const availability = stageAvailability.get(group.id).available;
    const availablePeriods = periods.filter((period) => availability.get(`${period.year}-${period.season}`) === true);
    const unitStatus = availablePeriods.length === periods.length ? 'confirmed' : 'unconfirmed';
    return { id: group.id, label: group.label, availablePeriods, unitStatus };
  });
  return {
    meta: {
      periods,
      sourceFields: selected.map((entry) => ({ period: entry.period, fields: entry.sourceFields })),
      generatedAt: cache.generatedAt,
      calcVersion: LOSS_PLANNER_CALC_VERSION,
      minRecords: MIN_PRICE_RECORDS,
      stageExceedTotalRows,
      invalidLossRows,
      negativeLossRows,
      aggregation: 'Kilograms and records are summed across the selected periods; coverage is weighted production with usable stage data divided by weighted production.',
      notes: [
        'This is a what-if planning baseline from measured NISR survey data, not a forecast or guarantee.',
        'Stage groups are available only where all member fields have a confirmed kilogram unit.',
        'Rows whose stage components exceed the reported total are excluded from stage attribution.',
        'Prices are self-reported and use a production-weighted median; district-crop prices require at least 30 price records before national crop fallback.'
      ]
    },
    crops: [...cropMap.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    districts: [...districtMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    stages,
    rows
  };
}

function getLossPlannerBaseline(options) {
  return buildBaseline(options);
}

function getLossPlannerDefault({ years, seasons } = {}) {
  const available = datasetFiles.filter((period) => period.year >= 2020 && period.year <= 2025);
  const yearsSelected = parseSelection(years, [...new Set(available.map((period) => String(period.year)))]);
  const seasonsSelected = parseSelection(seasons, ['A', 'B', 'C']);
  const latestConfig = available.filter((period) => yearsSelected.includes(String(period.year)) && seasonsSelected.includes(period.season))
    .sort((a, b) => b.year - a.year || b.season.localeCompare(a.season))[0];
  if (!latestConfig) throw new Error('No loss-planner periods match the requested years and seasons.');
  const latest = { year: latestConfig.year, season: latestConfig.season };
  const latestKey = `${latest.year}-${latest.season}`;
  const latestBaseline = buildBaseline({ years: String(latest.year), seasons: latest.season });
  const stageIds = latestBaseline.stages.filter((stage) => stage.availablePeriods.some((period) => `${period.year}-${period.season}` === latestKey)).map((stage) => stage.id);
  const candidates = latestBaseline.rows.filter((row) => row.records >= MIN_PRICE_RECORDS && stageIds.length && row.stageKg);
  let best = null;
  for (const row of candidates) {
    for (const stageId of stageIds) {
      const amount = row.stageKg[stageId];
      if (Number.isFinite(amount) && amount > (best?.amount ?? 0)) best = { cropCode: row.c, stageId, amount, districtCode: row.d };
    }
  }
  return best
    ? { period: latest, cropCode: best.cropCode, stageId: best.stageId, districtCode: best.districtCode, reductionPct: 30 }
    : { period: latest, cropCode: null, stageId: null, districtCode: null, reductionPct: 30 };
}

function getLossPlannerCachePath() {
  return cachePath;
}

module.exports = { LOSS_PLANNER_CALC_VERSION, MIN_PRICE_RECORDS, buildBaseline, getLossPlannerBaseline, getLossPlannerDefault, getLossPlannerCachePath, weightedMedian };