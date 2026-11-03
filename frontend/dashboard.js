import { animateMetric } from '/lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
const elements = {
  sidebar: document.querySelector('.sidebar'), collapseToggle: document.querySelector('.collapse-toggle'),
  yearFilter: document.getElementById('year-filter'), districtFilter: document.getElementById('district-filter'),
  charts: document.getElementById('overview-charts'), filterBar: document.querySelector('.overview-filters'),
  filterSummary: document.querySelector('[data-filter-summary]'), filterStatus: document.querySelector('[data-filter-status]'),
  filterReset: document.querySelector('[data-filter-reset]')
};
let requestController;

function compact(value, suffix = '') { return chartFormat.compact(value, suffix); }
function percent(value) { return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'; }
function setCardValue(key, value, formatter) {
  const target = document.querySelector(`.kpi-card[data-card="${key}"] [data-value]`);
  if (target) animateMetric(target, value, formatter);
}
function renderKpis(overview) {
  const k = overview.kpis;
  setCardValue('land', k.arableLandHa, (value) => compact(value, 'Ha'));
  setCardValue('harvest', k.weightedProductionKg / 1000, (value) => compact(value, 'T'));
  setCardValue('loss', k.postHarvestLossPercent, percent);
  setCardValue('risk', k.highRiskDistrictCount, (value) => Number.isFinite(value) ? String(Math.round(value)) : '—');
}
function formatDistrict(value) { return String(value).replace(/\b\w/g, (character) => character.toUpperCase()); }
function updateOptions(select, values, selected, label) {
  select.innerHTML = `<option value="all">All ${label}</option>${values.map((value) => `<option value="${value}">${formatDistrict(value)}</option>`).join('')}`;
  select.value = values.map(String).includes(String(selected)) ? String(selected) : 'all';
}
function updateContext(overview) {
  const year = elements.yearFilter.selectedOptions[0]?.textContent || 'All years';
  const district = elements.districtFilter.selectedOptions[0]?.textContent || 'All districts';
  elements.filterSummary.textContent = `${year} · ${district}`;
  return `${year} · ${district}`;
}
function renderCharts(overview, series) {
  const context = updateContext(overview);
  const filteredSeries = (series || []).filter((row) => elements.yearFilter.value === 'all' || String(row.year) === elements.yearFilter.value);
  const seasonLabels = filteredSeries.map((row) => ({ label: `${String(row.year).slice(-2)} ${row.season}`, period: `${row.year} Season ${row.season}`, value: row.weightedProductionKg / 1000 }));
  const crops = overview.productionByCrop.slice(0, 8).map((entry) => ({ label: entry.crop, value: entry.productionKg / 1000, period: `${overview.period.year} · ${overview.period.season}` }));
  const districts = overview.districtPerformance.slice().sort((a, b) => b.productionKg - a.productionKg).slice(0, 10).map((entry) => ({ label: formatDistrict(entry.district), value: entry.productionKg / 1000, period: `${overview.period.year} · ${overview.period.season}` }));
  renderChartGrid(elements.charts, [
    { type:'bar', title:'Top 10 Crops by Weighted Production', eyebrow:'CROP PRODUCTION', description:'Leading crops ranked by weighted production.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:crops.slice(0,10) },
    { type:'donut', title:'Districts by Risk Tier', eyebrow:'OBSERVED LOSS', description:'District counts grouped by the dashboard risk thresholds.', categoryLabel:'Risk tier', measureLabel:'Districts', unit:'districts', centerLabel:'DISTRICTS', context, data:overview.riskDistribution.map((entry) => ({ label:`${formatDistrict(entry.tier)} risk`, value:entry.districtCount, color:({low:'#6fa83c',moderate:'#c08a3e',high:'#a83c3c'})[entry.tier] })) },
    { type:'bar', title:'Top 10 Districts by Production', eyebrow:'DISTRICT COMPARISON', description:'Leading districts ranked by weighted production.', categoryLabel:'District', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:districts.slice(0,10) },
    { type:'line', title:'Production by Survey Season', eyebrow:'SURVEY TREND', description:'Observed production for each available survey season.', categoryLabel:'Year and season', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:seasonLabels }
  ]);
}
function applyLoading(loading) {
  elements.filterBar.classList.toggle('is-loading', loading);
  elements.filterStatus.textContent = loading ? 'Updating insights…' : 'Updated just now';
}
async function loadData() {
  requestController?.abort();
  requestController = new AbortController();
  const query = new URLSearchParams({ year:elements.yearFilter.value, district:elements.districtFilter.value });
  const seriesQuery = new URLSearchParams({ districtCode:elements.districtFilter.value });
  const [overviewResponse, seriesResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/api/overview?${query}`, { signal:requestController.signal, cache:'no-store' }),
    fetch(`${apiBaseUrl}/api/timeseries?${seriesQuery}`, { signal:requestController.signal, cache:'no-store' })
  ]);
  if (!overviewResponse.ok || !seriesResponse.ok) throw new Error('Dashboard data is temporarily unavailable. Please try again.');
  const [overview, series] = await Promise.all([overviewResponse.json(), seriesResponse.json()]);
  updateOptions(elements.yearFilter, overview.filters.availableYears, overview.filters.year, 'years');
  updateOptions(elements.districtFilter, overview.filters.availableDistricts, overview.filters.district, 'districts');
  renderKpis(overview);
  renderCharts(overview, series);
}
async function refresh() {
  applyLoading(true);
  try { await loadData(); }
  catch (error) { if (error.name !== 'AbortError') { console.error(error); elements.filterStatus.textContent = 'Update failed'; } }
  finally { if (requestController && !requestController.signal.aborted) applyLoading(false); }
}
elements.yearFilter.addEventListener('change', refresh);
elements.districtFilter.addEventListener('change', refresh);
elements.filterReset.addEventListener('click', () => { elements.yearFilter.value = 'all'; elements.districtFilter.value = 'all'; refresh(); });
applyLoading(true);
loadData().catch((error) => { if (error.name !== 'AbortError') { console.error(error); elements.filterStatus.textContent = 'Data unavailable'; } }).finally(() => applyLoading(false));
