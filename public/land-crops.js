import { animateMetric } from './lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
const elements = {
  year:document.getElementById('land-year-filter'), district:document.getElementById('land-district-filter'),
  area:document.getElementById('land-area'), production:document.getElementById('land-production'), rows:document.getElementById('land-rows'), crops:document.getElementById('land-crops-count'),
  chartGrid:document.getElementById('land-charts'), table:document.getElementById('land-table-body'), status:document.getElementById('land-table-status'), range:document.getElementById('land-table-range'),
  previous:document.getElementById('land-prev-page'), next:document.getElementById('land-next-page'), filterBar:document.querySelector('.land-controls'), filterSummary:document.querySelector('[data-land-filter-summary]'), filterStatus:document.querySelector('[data-land-filter-status]'), filterReset:document.querySelector('[data-land-filter-reset]')
};
let controller;
let tableEntries = [];
let tablePage = 0;
const tablePageSize = 5;
const compact = chartFormat.compact;
const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const districtName = (value) => String(value).replace(/\b\w/g, (character) => character.toUpperCase());

function updateFilters(filters) {
  elements.year.innerHTML = `<option value="all">All years</option>${filters.availableYears.map((year) => `<option value="${year}">${year}</option>`).join('')}`;
  elements.year.value = filters.year;
  elements.district.innerHTML = `<option value="all">All districts</option>${filters.availableDistricts.map((district) => `<option value="${district}">${districtName(district)}</option>`).join('')}`;
  elements.district.value = filters.district;
  elements.filterSummary.textContent = `${elements.year.selectedOptions[0].textContent} · ${elements.district.selectedOptions[0].textContent}`;
}
function renderTable() {
  const start = tablePage * tablePageSize, visible = tableEntries.slice(start, start + tablePageSize);
  elements.table.innerHTML = visible.length ? visible.map((entry) => `<tr><td>${districtName(entry.district)}</td><td>${entry.primaryCrop}</td><td>${compact(entry.areaHa, 'Ha')}</td><td>${compact(entry.productionKg / 1000, 'T')}</td><td>${percent(entry.lossPercent)}</td></tr>`).join('') : '<tr><td colspan="5">No district records for this selection.</td></tr>';
  elements.status.textContent = `${tableEntries.length} district${tableEntries.length === 1 ? '' : 's'} in view`;
  elements.range.textContent = tableEntries.length ? `Showing ${start + 1}–${Math.min(start + tablePageSize, tableEntries.length)} of ${tableEntries.length} districts` : 'No districts in view';
  elements.previous.disabled = tablePage === 0; elements.next.disabled = start + tablePageSize >= tableEntries.length;
}
function renderCharts(overview, series) {
  const context = elements.filterSummary.textContent;
  const crops = overview.productionByCrop.slice(0, 8);
  const districtRows = overview.districtPerformance.slice().sort((a, b) => b.productionKg - a.productionKg);
  const year = elements.year.value;
  const trend = (series || []).filter((row) => year === 'all' || String(row.year) === year).map((row) => ({ label:`${String(row.year).slice(-2)} ${row.season}`, period:`${row.year} Season ${row.season}`, value:row.weightedProductionKg / 1000 }));
  renderChartGrid(elements.chartGrid, [
    { type:'bar', title:'Top 10 Crops by Weighted Production', eyebrow:'CROP OUTPUT', description:'Leading crop categories ranked by weighted production.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:crops.slice(0,10).map((entry) => ({ label:entry.crop, value:entry.productionKg / 1000 })) },
    { type:'donut', title:'Production Share by Crop', eyebrow:'CROP MIX', description:'Share of weighted production across the leading crop categories.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', centerLabel:'TONNES', context, data:crops.slice(0, 5).map((entry) => ({ label:entry.crop, value:entry.productionKg / 1000 })) },
    { type:'bar', title:'Top 10 Districts by Cultivated Area', eyebrow:'LAND BY DISTRICT', description:'Leading districts ranked by weighted cultivated area.', categoryLabel:'District', measureLabel:'Cultivated area (hectares)', unit:'Ha', context, data:districtRows.slice(0, 10).map((entry) => ({ label:districtName(entry.district), value:entry.areaHa || 0 })) },
    { type:'line', title:'Production by Survey Season', eyebrow:'PRODUCTION TREND', description:'Observed production across available survey periods.', categoryLabel:'Year and season', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:trend }
  ]);
}
function render(overview, series) {
  updateFilters(overview.filters);
  tableEntries = overview.districtPerformance;
  tablePage = 0;
  animateMetric(elements.area, overview.kpis.arableLandHa, (value) => compact(value, 'Ha'));
  animateMetric(elements.production, overview.kpis.weightedProductionKg / 1000, (value) => compact(value, 'T'));
  animateMetric(elements.rows, overview.dataQuality.rowsUsed, (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—');
  animateMetric(elements.crops, overview.productionByCrop.length, (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—');
  renderCharts(overview, series); renderTable();
}
async function load() {
  controller?.abort(); controller = new AbortController();
  document.body.classList.add('is-loading'); elements.filterBar.classList.add('is-loading'); elements.filterStatus.textContent = 'Updating insights…';
  try {
    const overviewParams = new URLSearchParams({ year:elements.year.value, district:elements.district.value });
    const seriesParams = new URLSearchParams({ districtCode:elements.district.value });
    const [overviewResponse, seriesResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/overview?${overviewParams}`, { signal:controller.signal }),
      fetch(`${apiBaseUrl}/api/timeseries?${seriesParams}`, { signal:controller.signal })
    ]);
    if (!overviewResponse.ok || !seriesResponse.ok) throw new Error('Survey charts could not be updated.');
    render(await overviewResponse.json(), await seriesResponse.json());
  } catch (error) {
    if (error.name !== 'AbortError') { elements.status.textContent = 'Data unavailable'; elements.table.innerHTML = '<tr><td colspan="5">The selected data could not be loaded.</td></tr>'; }
  } finally { document.body.classList.remove('is-loading'); elements.filterBar.classList.remove('is-loading'); elements.filterStatus.textContent = 'Updated just now'; }
}
elements.year.addEventListener('change', load); elements.district.addEventListener('change', load);
elements.filterReset.addEventListener('click', () => { elements.year.value = 'all'; elements.district.value = 'all'; load(); });
elements.previous.addEventListener('click', () => { tablePage -= 1; renderTable(); }); elements.next.addEventListener('click', () => { tablePage += 1; renderTable(); });
load();
