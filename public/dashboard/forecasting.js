const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
import { attachTooltip } from './chart-tooltip.js';
const elements = {
  sidebar: document.querySelector('.sidebar'), collapse: document.querySelector('.collapse-toggle'), district: document.getElementById('forecast-district'), crop: document.getElementById('forecast-crop'), accuracy: document.getElementById('forecast-accuracy'), districts: document.getElementById('forecast-districts'), horizon: document.getElementById('forecast-horizon'), model: document.getElementById('forecast-model'), title: document.getElementById('selected-title'), status: document.getElementById('forecast-status'), chart: document.getElementById('forecast-chart'), metrics: document.getElementById('backtest-metrics'), backtest: document.getElementById('backtest-table'), importance: document.getElementById('feature-importance'), analysis: document.getElementById('forecast-analysis'), map: document.getElementById('forecast-map'), mapStatus: document.getElementById('map-status')
};
const forecastControls = document.querySelector('.forecast-controls');
forecastControls.insertAdjacentHTML('beforeend', '<div class="shared-filter-actions"><span data-shared-filter-status>Ready</span><button type="button" data-shared-filter-reset>Reset</button></div>');
const forecastFilterStatus = forecastControls.querySelector('[data-shared-filter-status]');
const forecastFilterReset = forecastControls.querySelector('[data-shared-filter-reset]');
let cache;
let activeModel = 'ensemble';
let map;
let boundaryLayer;

function format(value, suffix = '') { if (!Number.isFinite(value)) return '—'; if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M ${suffix}`.trim(); if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K ${suffix}`.trim(); return `${value.toFixed(value >= 100 ? 0 : 1)} ${suffix}`.trim(); }
function percent(value) { return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'; }
function title(value) { return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function districtKey(value) { return String(value || '').toLowerCase().replace(/[^a-z]/g, '').replace('nyarugenege', 'nyarugenge'); }
function riskColor(tier) { return tier === 'high' ? '#a83c3c' : tier === 'moderate' ? '#c08a3e' : '#6fa83c'; }
function selectedForecast() { return cache.forecasts.find((entry) => (elements.district.value === 'all' || entry.districtCode === elements.district.value) && (elements.crop.value === 'all' || entry.cropCode === elements.crop.value)) || cache.forecasts[0]; }
function modelEntry(entry) { return entry?.models?.[activeModel] || {}; }
function futureModel(period) { return period?.productionKg !== undefined ? period : period?.models?.[activeModel] || {}; }

function updateSelectors() {
  const districts = [...new Set(cache.forecasts.map((entry) => entry.districtCode))].sort();
  const crops = [...new Map(cache.forecasts.map((entry) => [entry.cropCode, entry.cropName || entry.cropCode])).entries()].sort((left, right) => left[1].localeCompare(right[1]));
  elements.district.innerHTML = '<option value="all">All districts</option>' + districts.map((value) => `<option value="${value}">${title(value)}</option>`).join('');
  elements.crop.innerHTML = '<option value="all">All crops</option>' + crops.map(([value, label]) => `<option value="${value}">${title(label)}</option>`).join('');
}

function renderKpis() {
  const match = cache.backtest?.riskTierMatchPercent;
  elements.accuracy.textContent = percent(match);
  elements.districts.textContent = new Set(cache.forecasts.map((entry) => entry.districtCode)).size.toLocaleString();
  elements.horizon.textContent = `${cache.horizon.startYear}–${cache.horizon.endYear}`;
  elements.model.textContent = activeModel[0].toUpperCase() + activeModel.slice(1);
}

function renderMetrics() {
  const backtest = cache.backtest || {};
  elements.metrics.innerHTML = [['Tier match', percent(backtest.riskTierMatchPercent)], ['Loss MAE', percent(backtest.lossMaePercent)], ['Production RMSE', format(backtest.productionRmseKg, 'kg')]].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  const selected = selectedForecast();
  const comparisons = (backtest.comparisons || []).filter((row) => (!selected || row.districtCode === selected.districtCode) && (!selected || row.cropCode === selected.cropCode));
  elements.backtest.innerHTML = comparisons.length ? `<table><thead><tr><th>Season</th><th>Predicted</th><th>Actual</th><th>Loss tier</th></tr></thead><tbody>${comparisons.map((row) => `<tr><td>${row.season} 2025</td><td>${format(row.predicted?.productionKg, 'kg')}</td><td>${format(row.actual?.weightedProductionKg, 'kg')}</td><td>${row.predicted?.lossPercent == null ? '—' : `${percent(row.predicted.lossPercent)} → ${row.actual?.lossPercent == null ? '—' : percent(row.actual.lossPercent)}`}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-state">No 2025 holdout comparison is available for this district-crop pair.</p>';
}

function renderImportance() {
  const entries = cache.featureImportances || [];
  const max = Math.max(...entries.map((entry) => entry.importance), 1);
  elements.importance.innerHTML = entries.length ? `<p class="importance-note">The trained model compares recent loss, recent production, and season patterns. Bars are model signals, not proof that one factor causes the outcome.</p>${entries.map((entry) => `<div class="importance-row"><span>${entry.feature} <small>${entry.target || 'model'}</small></span><span class="importance-track"><i style="width:${(entry.importance / max) * 100}%"></i></span><span class="importance-value">${(entry.importance * 100).toFixed(1)}%</span></div>`).join('')}` : '<p class="empty-state">No model signal metadata is available in the forecast artifact.</p>';
}

function renderAnalysis(forecast, series) {
  const future = (forecast.future || []).map((row) => ({ ...row, model: futureModel(row) })).filter((row) => Number.isFinite(row.model.productionKg));
  const actual = series.filter((row) => Number.isFinite(row.weightedProductionKg));
  const first = future[0]?.model;
  const last = future.at(-1)?.model;
  const latestActual = actual.at(-1);
  const movement = first && last && Number.isFinite(first.productionKg) && Number.isFinite(last.productionKg)
    ? last.productionKg > first.productionKg * 1.05 ? 'The model expects production to rise gradually across the forecast horizon.' : last.productionKg < first.productionKg * 0.95 ? 'The model expects production to fall across the forecast horizon.' : 'The model expects production to stay broadly stable across the forecast horizon.'
    : 'There is not enough supported history to describe a future movement.';
  const confidence = forecast.lowHistory ? 'This selection has limited history, so its uncertainty is higher.' : `This selection has ${forecast.yearsAvailable} years of usable history.`;
  elements.analysis.innerHTML = `<div class="analysis-summary"><strong>${movement}</strong><span>${confidence}</span></div><div class="analysis-grid"><div><span>Recent observed production</span><strong>${format(latestActual?.weightedProductionKg, 'kg')}</strong><small>${latestActual ? `${latestActual.year} Season ${latestActual.season}` : 'Unavailable'}</small></div><div><span>First forecast loss</span><strong>${percent(first?.lossPercent)}</strong><small>${future[0] ? `${future[0].year} Season ${future[0].season}` : 'Unavailable'}</small></div><div><span>Last forecast loss</span><strong>${percent(last?.lossPercent)}</strong><small>${future.at(-1) ? `${future.at(-1).year} Season ${future.at(-1).season}` : 'Unavailable'}</small></div><div><span>Risk interpretation</span><strong>${first?.riskTier ? `${title(first.riskTier)} risk` : 'Unavailable'}</strong><small>15% and 30% fixed thresholds</small></div></div><p>The forecast learns repeated patterns in the historical records. It does not know future weather, pests, prices, or policy changes unless those variables are included in the data. A large rise or drop should therefore be read as a signal to investigate, not as a guaranteed event.</p>`;
}

function renderChart(series, forecast) {
  const future = (forecast.future || []).map((row) => {
    const source = futureModel(row);
    return { label: `${row.year} ${row.season}`, value: Number.isFinite(source.productionKg) ? source.productionKg / 1000 : null, source, clamping: row.clamping };
  }).filter((row) => Number.isFinite(row.value));
  if (!future.length) { elements.chart.innerHTML = '<p class="empty-state">No forecast is available for this selection.</p>'; return; }
  const width = 1000;
  const rowHeight = 28;
  const height = Math.max(220, future.length * rowHeight + 36);
  const pad = { left: 92, right: 90, top: 18, bottom: 18 };
  const max = Math.max(...future.map((row) => row.value), 1);
  const barWidth = width - pad.left - pad.right;
  const x = (value) => pad.left + (value / max) * barWidth;
  const rows = future.map((row, index) => {
    const y = pad.top + index * rowHeight + 5;
    const valueX = x(row.value);
    const label = `<text class="forecast-bar-label" x="${pad.left - 12}" y="${y + 13}" text-anchor="end">${row.label}</text>`;
    const track = `<rect class="forecast-bar-track" x="${pad.left}" y="${y}" width="${barWidth}" height="16" rx="4"/>`;
    const bar = `<rect class="forecast-bar" x="${pad.left}" y="${y}" width="${Math.max(2, valueX - pad.left)}" height="16" rx="4"/>`;
    const value = `<text class="forecast-bar-value" x="${Math.min(valueX + 9, width - 4)}" y="${y + 13}" text-anchor="start">${format(row.value * 1000, 'kg')}</text>`;
    const hit = `<rect class="forecast-bar-hit" x="${pad.left}" y="${y - 5}" width="${barWidth}" height="26" data-kind="Forecast" data-period="${row.label}" data-value="${row.value * 1000}" data-band-low="${row.source?.confidenceBand?.productionKg?.[0] ?? ''}" data-band-high="${row.source?.confidenceBand?.productionKg?.[1] ?? ''}" data-clamp-reason="${row.clamping?.lowConfidence ? 'Low confidence: limited history variation.' : row.clamping?.applied ? 'Capped estimate: ensemble exceeded the historical cap.' : ''}" tabindex="0"/>`;
    return `${label}${track}${bar}${value}${hit}`;
  }).join('');
  elements.chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Forecast production by future season"><text class="forecast-chart-axis-title" x="${pad.left}" y="12">Forecast production</text>${rows}</svg>`;
  elements.chart.querySelectorAll('.forecast-bar-hit').forEach((point) => {
    const kind = point.dataset.kind;
    const range = point.dataset.bandLow && point.dataset.bandHigh ? `<span>Confidence: ±${format((Number(point.dataset.bandHigh) - Number(point.dataset.bandLow)) / 2, 'kg')}</span>` : '';
    const forecastLabel = kind === 'Forecast' ? `<b>Forecast: ${format(Number(point.dataset.value), 'kg')}</b>` : `<b>Actual: ${format(Number(point.dataset.value), 'kg')}</b>`;
    const reason = point.dataset.clampReason ? `<span>${point.dataset.clampReason}</span>` : '';
    attachTooltip(point, `<strong>${kind}</strong><span>${point.dataset.period} · Production</span>${forecastLabel}${range}${reason}`);
  });
}

async function renderSelection() {
  const forecast = selectedForecast();
  if (!forecast) return;
  const selectedDistrict = forecast.districtCode; const selectedCrop = forecast.cropCode;
  elements.title.textContent = `${title(forecast.cropName || selectedCrop)} · ${title(selectedDistrict)}`;
  const firstForecast = forecast.future?.[0];
  elements.status.textContent = firstForecast?.clamping?.lowConfidence ? 'Low confidence' : firstForecast?.clamping?.applied ? 'Capped estimate' : forecast.lowHistory ? 'Limited history' : `${forecast.yearsAvailable} years available`;
  const response = await fetch(`${apiBaseUrl}/api/timeseries?districtCode=${encodeURIComponent(selectedDistrict)}&cropCode=${encodeURIComponent(selectedCrop)}`);
  if (!response.ok) throw new Error(`Historical series returned ${response.status}`);
  const series = await response.json();
  renderChart(series, forecast);
  renderMetrics();
  renderAnalysis(forecast, series);
}

async function renderMap() {
  const response = await fetch('/api/rwanda-districts');
  if (!response.ok) throw new Error('Boundary service unavailable');
  const geojson = await response.json();
  const districtTotals = new Map();
  cache.forecasts.forEach((entry) => {
    const period = entry.future?.[0];
    const next = period || modelEntry(entry);
    const productionKg = Number(next.productionKg);
    const lossPercent = Number(next.lossPercent);
    if (!Number.isFinite(productionKg) || !Number.isFinite(lossPercent)) return;
    const key = districtKey(entry.districtCode);
    const current = districtTotals.get(key) || { productionKg: 0, weightedLoss: 0, cropCount: 0 };
    current.productionKg += productionKg;
    current.weightedLoss += productionKg * lossPercent;
    current.cropCount += 1;
    districtTotals.set(key, current);
  });
  const districtForecasts = new Map([...districtTotals.entries()].map(([key, value]) => {
    const lossPercent = value.productionKg > 0 ? value.weightedLoss / value.productionKg : null;
    return [key, { ...value, lossPercent, riskTier: lossPercent >= 30 ? 'high' : lossPercent >= 15 ? 'moderate' : 'low' }];
  }));
  if (!map) map = L.map(elements.map, { zoomControl: true, minZoom: 7, maxZoom: 11 }).setView([-1.94, 29.87], 8);
  if (boundaryLayer) boundaryLayer.remove();
  boundaryLayer = L.geoJSON(geojson, { style: (feature) => { const key = districtKey(feature.properties.district || feature.properties.name); const entry = districtForecasts.get(key); return { color:'#fff', weight:1.2, fillColor:riskColor(entry?.riskTier), fillOpacity:.78 }; }, onEachFeature: (feature, layer) => { const key = districtKey(feature.properties.district || feature.properties.name); const entry = districtForecasts.get(key); layer.bindTooltip(`<strong>${title(feature.properties.district || feature.properties.name)}</strong><br>Weighted forecast loss: ${percent(entry?.lossPercent)}<br>Risk: ${entry?.riskTier || 'Unavailable'}<br>${entry?.cropCount || 0} crop forecasts included`, { sticky:true }); } }).addTo(map);
  window.requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(boundaryLayer.getBounds(), { padding: [12, 12] }); });
  elements.mapStatus.textContent = `${districtForecasts.size} districts forecasted`;
}

async function init() {
  elements.collapse.addEventListener('click', () => elements.sidebar.classList.toggle('collapsed'));
  elements.district.addEventListener('change', () => renderSelection().catch(showError));
  elements.crop.addEventListener('change', () => renderSelection().catch(showError));
  forecastFilterReset.addEventListener('click', () => { elements.district.value = 'all'; elements.crop.value = 'all'; forecastFilterStatus.textContent = 'Reset to national view'; renderSelection().catch(showError); });
  document.querySelectorAll('[data-model]').forEach((button) => button.addEventListener('click', () => { activeModel = button.dataset.model; document.querySelectorAll('[data-model]').forEach((item) => item.classList.toggle('is-active', item === button)); renderKpis(); renderSelection().catch(showError); renderMap().catch(showError); }));
  const response = await fetch(`${apiBaseUrl}/api/forecast?model=${activeModel}`);
  if (!response.ok) throw new Error(`Forecast cache returned ${response.status}`);
  cache = await response.json();
  updateSelectors(); renderKpis(); renderImportance(); await renderSelection(); await renderMap();
}
function showError(error) { elements.status.textContent = 'Data unavailable'; elements.mapStatus.textContent = error.message; elements.chart.innerHTML = `<p class="empty-state">${error.message}</p>`; }
init().catch(showError);
