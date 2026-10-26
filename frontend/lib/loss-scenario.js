const stageIds = ['pests', 'animals', 'harvest', 'transport', 'storage', 'processing', 'sales', 'other'];
const coverageThresholds = Object.freeze({ high: 70, medium: 40 });
const displayStageGroups = Object.freeze([
  { id: 'field', label: 'In the field', members: ['pests', 'animals'] },
  { id: 'harvest', label: 'Harvest', members: ['harvest'] },
  { id: 'transport', label: 'Transport', members: ['transport'] },
  { id: 'storage', label: 'Storage', members: ['storage'] },
  { id: 'processing', label: 'Processing and packaging', members: ['processing'] },
  { id: 'sales', label: 'Sales', members: ['sales'] },
  { id: 'other', label: 'Other', members: ['other'] }
]);

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatTonnes(kilograms) {
  if (!finiteNumber(kilograms)) return 'Not available';
  const tonnes = kilograms / 1000;
  const digits = Math.abs(tonnes) >= 100 ? 0 : 1;
  return `${tonnes.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} t`;
}

function formatRwf(value) {
  if (!finiteNumber(value)) return 'Value not available';
  const amount = Math.abs(value);
  if (amount >= 1e9) return `RWF ${(value / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `RWF ${(value / 1e6).toFixed(0)}M`;
  if (amount >= 1e3) return `RWF ${(value / 1e3).toFixed(0)}K`;
  return `RWF ${Math.round(value).toLocaleString()}`;
}

function formatSacks(kilograms) {
  if (!finiteNumber(kilograms)) return 'Not available';
  const sacks = kilograms / 50;
  return `${sacks.toLocaleString(undefined, { maximumFractionDigits: 0 })} sacks`;
}

function coverageBand(value) {
  if (!finiteNumber(value)) return 'unavailable';
  if (value >= coverageThresholds.high) return 'high';
  if (value >= coverageThresholds.medium) return 'medium';
  return 'low';
}

function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : 'Not available';
}

function serializeScenarioState({ cropCode, years = 'all', seasons = 'all', districtCodes = 'all', stageIds: selectedStageIds = [], reductionPct = 30 } = {}) {
  const params = new URLSearchParams();
  if (cropCode) params.set('crop', cropCode);
  params.set('years', Array.isArray(years) ? years.join(',') : years);
  params.set('seasons', Array.isArray(seasons) ? seasons.join(',') : seasons);
  params.set('districts', districtCodes === 'all' ? 'all' : [...new Set(districtCodes || [])].sort().join(',') || 'none');
  params.set('stage', [...new Set(selectedStageIds)].sort().join(','));
  params.set('pct', String(Math.max(0, Math.min(100, Number(reductionPct) || 0))));
  return params.toString();
}

function parseScenarioState(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const list = (value, fallback) => !value || value === 'all' ? fallback : value.split(',').map((item) => item.trim()).filter(Boolean);
  const rawPct = Number(params.get('pct'));
  return {
    cropCode: params.get('crop') || null,
    years: list(params.get('years'), 'all'),
    seasons: list(params.get('seasons'), 'all'),
    districtCodes: params.get('districts') === 'none' ? [] : params.get('districts') === 'all' || !params.get('districts') ? 'all' : list(params.get('districts'), []),
    stageIds: list(params.get('stage'), []),
    reductionPct: Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 30
  };
}

function afterLossRate({ recordedLossKg, recoveredKg, productionKg }) {
  if (!finiteNumber(recordedLossKg) || !finiteNumber(recoveredKg) || !finiteNumber(productionKg) || productionKg <= 0) return null;
  return Math.max(0, recordedLossKg - recoveredKg) / productionKg * 100;
}

function recoveryColor(value, maximum) {
  if (!finiteNumber(value) || !finiteNumber(maximum) || maximum <= 0) return '#D9DDD3';
  const ratio = Math.sqrt(Math.max(0, Math.min(1, value / maximum)));
  const pale = [213, 231, 193];
  const deep = [61, 107, 31];
  return `rgb(${pale.map((channel, index) => Math.round(channel + (deep[index] - channel) * ratio)).join(',')})`;
}

function computeScenario({ rows = [], cropCode, districtCodes = 'all', stageIds: selectedStageIds = [], availableStageIds = stageIds, reductionPct = 30, minRecords = 30 } = {}) {
  const selectedDistricts = districtCodes === 'all' || districtCodes == null
    ? null
    : new Set(Array.isArray(districtCodes) ? districtCodes : [districtCodes]);
  const reduction = Math.max(0, Math.min(100, Number(reductionPct) || 0)) / 100;
  const selectedRows = rows.filter((row) => row.c === cropCode && (!selectedDistricts || selectedDistricts.has(row.d)));
  const availableStageSet = new Set(availableStageIds.filter((id) => stageIds.includes(id)));
  const selectedStageSet = new Set(selectedStageIds.filter((id) => stageIds.includes(id) && availableStageSet.has(id)));
  const allStageTotals = Object.fromEntries(stageIds.map((id) => [id, 0]));
  const recoveryTotals = Object.fromEntries(stageIds.map((id) => [id, 0]));
  const districtStageTotals = new Map();
  const byDistrictMap = new Map();
  let selectedProductionKg = 0;
  let includedProductionKg = 0;
  let coveredProductionKg = 0;
  let recordedLossKg = 0;
  let unattributedKg = 0;
  let suppressedCount = 0;
  let includedCount = 0;
  let includedRecords = 0;
  let missingIncludedPrice = false;
  const usedPriceBases = new Set();

  for (const row of selectedRows) {
    const productionKg = finiteNumber(row.productionKg) && row.productionKg > 0 ? row.productionKg : 0;
    selectedProductionKg += productionKg;
    const isSuppressed = !Number.isFinite(row.records) || row.records < minRecords;
    const cell = byDistrictMap.get(row.d) || {
      code: row.d,
      recoveredKg: 0,
      pricedValueRwf: 0,
      records: 0,
      selectedProductionKg: 0,
      includedProductionKg: 0,
      coveredProductionKg: 0,
      stageKg: Object.fromEntries(stageIds.map((id) => [id, 0])),
      recordedLossKg: 0,
      missingIncludedPrice: false,
      suppressed: true,
      missingPrice: false,
      hasIncluded: false
    };
    cell.records += Number(row.records) || 0;
    cell.selectedProductionKg += productionKg;
    if (isSuppressed) {
      suppressedCount += 1;
      byDistrictMap.set(row.d, cell);
      continue;
    }
    includedCount += 1;
    includedRecords += Number(row.records) || 0;
    cell.suppressed = false;
    cell.hasIncluded = true;
    cell.includedProductionKg += productionKg;
    includedProductionKg += productionKg;
    if (finiteNumber(row.totalLossKg) && row.totalLossKg >= 0) {
      cell.recordedLossKg += row.totalLossKg;
      recordedLossKg += row.totalLossKg;
    }
    if (finiteNumber(row.unattributedKg) && row.unattributedKg >= 0) unattributedKg += row.unattributedKg;
    const coverage = finiteNumber(row.stageCoveragePct) ? Math.max(0, Math.min(100, row.stageCoveragePct)) / 100 : 0;
    cell.coveredProductionKg += productionKg * coverage;
    coveredProductionKg += productionKg * coverage;

    const stageValues = row.stageKg || {};
    for (const stageId of stageIds) {
      const stageKg = stageValues[stageId];
      if (!finiteNumber(stageKg) || stageKg < 0) continue;
      allStageTotals[stageId] += stageKg;
      cell.stageKg[stageId] += stageKg;
      if (!selectedStageSet.has(stageId)) continue;
      const recoveredKg = stageKg * reduction;
      recoveryTotals[stageId] += recoveredKg;
      cell.recoveredKg += recoveredKg;
    }
    const rowStageExposureKg = [...selectedStageSet].reduce((sum, id) => {
      const stageValue = stageValues[id];
      return sum + (finiteNumber(stageValue) && stageValue >= 0 ? stageValue : 0);
    }, 0);
    if (rowStageExposureKg > 0) {
      if (finiteNumber(row.priceRwfPerKg) && row.priceRwfPerKg > 0) {
        if (row.priceBasis === 'district' || row.priceBasis === 'national') usedPriceBases.add(row.priceBasis);
        const rowRecoveredKg = rowStageExposureKg * reduction;
        cell.pricedValueRwf += rowRecoveredKg * row.priceRwfPerKg;
        cell.pricedRecoveredKg = (cell.pricedRecoveredKg || 0) + rowRecoveredKg;
      } else {
        cell.missingPrice = true;
        cell.missingIncludedPrice = true;
        missingIncludedPrice = true;
      }
    }
    const districtStage = districtStageTotals.get(row.d) || Object.fromEntries(stageIds.map((id) => [id, 0]));
    for (const stageId of stageIds) {
      if (finiteNumber(stageValues[stageId]) && stageValues[stageId] >= 0) districtStage[stageId] += stageValues[stageId];
    }
    districtStageTotals.set(row.d, districtStage);
    byDistrictMap.set(row.d, cell);
  }

  const totalStageLossKg = Object.values(allStageTotals).reduce((sum, value) => sum + value, 0);
  const stageShare = Object.fromEntries(stageIds.map((id) => [id, recordedLossKg > 0 ? allStageTotals[id] / recordedLossKg * 100 : null]));
  const recoveredKg = Object.values(recoveryTotals).reduce((sum, value) => sum + value, 0);
  const stageBreakdown = Object.fromEntries(stageIds.map((id) => {
    const lossKg = allStageTotals[id];
    const savedKg = recoveryTotals[id];
    return [id, {
      lossKg: availableStageSet.has(id) ? lossKg : null,
      savedKg: availableStageSet.has(id) ? savedKg : null,
      remainingKg: availableStageSet.has(id) ? Math.max(0, lossKg - savedKg) : null,
      productionSharePct: availableStageSet.has(id) && includedProductionKg > 0 ? lossKg / includedProductionKg * 100 : null,
      recordedLossSharePct: availableStageSet.has(id) ? stageShare[id] : null,
      available: availableStageSet.has(id),
      records: selectedRows.filter((row) => row.records >= minRecords && finiteNumber(row.stageKg?.[id])).reduce((sum, row) => sum + (Number(row.stageRecords) || 0), 0)
    }];
  }));
  const selectedStageLossKg = [...selectedStageSet].reduce((sum, id) => sum + (stageBreakdown[id]?.lossKg || 0), 0);
  const stageRows = displayStageGroups.map((group) => {
    const memberRows = group.members.map((id) => stageBreakdown[id]);
    const available = memberRows.every((row) => row?.available && finiteNumber(row.lossKg));
    const lossKg = available ? memberRows.reduce((sum, row) => sum + row.lossKg, 0) : null;
    const savedKg = available ? memberRows.reduce((sum, row) => sum + row.savedKg, 0) : null;
    const records = selectedRows.filter((row) => row.records >= minRecords && group.members.some((id) => finiteNumber(row.stageKg?.[id]))).reduce((sum, row) => sum + (Number(row.records) || 0), 0);
    return {
      id: group.id,
      label: group.label,
      lossKg,
      savedKg,
      remainingKg: available ? Math.max(0, lossKg - savedKg) : null,
      productionSharePct: available && includedProductionKg > 0 ? lossKg / includedProductionKg * 100 : null,
      barWidthPct: available && includedProductionKg > 0 ? Math.min(100, lossKg / includedProductionKg * 100) : null,
      savedBarPct: available && includedProductionKg > 0 ? Math.min(100, savedKg / includedProductionKg * 100) : null,
      remainingBarPct: available && includedProductionKg > 0 ? Math.min(100, Math.max(0, lossKg - savedKg) / includedProductionKg * 100) : null,
      recordedLossSharePct: available && recordedLossKg > 0 ? lossKg / recordedLossKg * 100 : null,
      records,
      available
    };
  });
  const valueRwf = missingIncludedPrice ? null : [...byDistrictMap.values()].reduce((sum, entry) => sum + entry.pricedValueRwf, 0);
  const byDistrict = [...byDistrictMap.values()].map((entry) => ({
    code: entry.code,
    recoveredKg: entry.suppressed ? null : entry.recoveredKg,
    valueRwf: entry.suppressed || entry.missingIncludedPrice ? null : entry.pricedValueRwf,
    records: entry.records,
    coveragePct: entry.selectedProductionKg > 0 ? entry.coveredProductionKg / entry.selectedProductionKg * 100 : null,
    stageKg: districtStageTotals.get(entry.code) || Object.fromEntries(stageIds.map((id) => [id, 0])),
    recordedLossKg: entry.hasIncluded ? entry.recordedLossKg : null,
    productionKg: entry.hasIncluded ? entry.includedProductionKg : null,
    suppressed: !entry.hasIncluded
  })).sort((left, right) => (right.recoveredKg ?? -1) - (left.recoveredKg ?? -1));
  const maxTonnesRecovery = Math.max(0, ...byDistrict.map((entry) => entry.recoveredKg ?? 0));
  const maxValueRecovery = Math.max(0, ...byDistrict.map((entry) => entry.valueRwf ?? 0));
  byDistrict.forEach((entry) => {
    entry.tonnesBarPct = finiteNumber(entry.recoveredKg) && maxTonnesRecovery > 0 ? entry.recoveredKg / maxTonnesRecovery * 100 : null;
    entry.valueBarPct = finiteNumber(entry.valueRwf) && maxValueRecovery > 0 ? entry.valueRwf / maxValueRecovery * 100 : null;
    entry.tonnesMapColor = recoveryColor(entry.recoveredKg, maxTonnesRecovery);
    entry.valueMapColor = recoveryColor(entry.valueRwf, maxValueRecovery);
    const mixTotal = Object.values(entry.stageKg).filter(finiteNumber).reduce((sum, value) => sum + value, 0);
    entry.stageMixPct = Object.fromEntries(stageIds.map((id) => [id, finiteNumber(entry.stageKg[id]) && mixTotal > 0 ? entry.stageKg[id] / mixTotal * 100 : null]));
  });
  const tonnesValues = byDistrict.map((entry) => entry.recoveredKg).filter(finiteNumber);
  const valueValues = byDistrict.map((entry) => entry.valueRwf).filter(finiteNumber);
  const metricBounds = {
    tonnes: tonnesValues.length ? { min: Math.min(...tonnesValues), max: Math.max(...tonnesValues) } : null,
    rwf: valueValues.length ? { min: Math.min(...valueValues), max: Math.max(...valueValues) } : null
  };
  const unattributedBarPct = includedProductionKg > 0 ? Math.min(100, unattributedKg / includedProductionKg * 100) : null;

  const topStage = Object.entries(stageShare).filter(([, share]) => finiteNumber(share)).sort((a, b) => b[1] - a[1])[0];
  const topDistrict = byDistrict.find((entry) => !entry.suppressed && finiteNumber(entry.recoveredKg));
  return {
    totals: {
      recoveredKg,
      hasSelectedLoss: [...selectedStageSet].some((id) => allStageTotals[id] > 0),
      valueRwf,
      priceBasis: usedPriceBases.size > 1 ? 'mixed' : usedPriceBases.values().next().value || 'none',
      includedRecords,
      selectedProductionKg,
      includedProductionKg,
      recordedLossKg,
      selectedStageLossKg,
      lossAfterKg: Math.max(0, recordedLossKg - recoveredKg),
      recordedLossPct: includedProductionKg > 0 ? recordedLossKg / includedProductionKg * 100 : null,
      lossAfterPct: afterLossRate({ recordedLossKg, recoveredKg, productionKg: includedProductionKg }),
      unattributedKg,
      unattributedSharePct: includedProductionKg > 0 ? unattributedKg / includedProductionKg * 100 : null,
      stageBreakdown,
      stageRows,
      unattributedBarPct,
      metricBounds,
      coveragePct: includedProductionKg > 0 ? coveredProductionKg / includedProductionKg * 100 : null,
      suppressedCount,
      includedCount
    },
    byDistrict,
    stageShare,
    unavailableStageIds: selectedStageIds.filter((id) => !availableStageSet.has(id)),
    topInsight: topStage && topDistrict
      ? { stageId: topStage[0], stageSharePct: topStage[1], districtCode: topDistrict.code, districtRecoveredKg: topDistrict.recoveredKg }
      : null
  };
}

export { computeScenario, formatTonnes, formatRwf, formatSacks, formatCount, coverageBand, afterLossRate, serializeScenarioState, parseScenarioState, coverageThresholds, stageIds, displayStageGroups };