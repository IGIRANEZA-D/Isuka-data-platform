import { animateMetric } from './lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
const elements = {
  year:document.getElementById('inputs-year'), district:document.getElementById('inputs-district'),
  rows:document.getElementById('inputs-rows'), districts:document.getElementById('inputs-district-count'), crops:document.getElementById('inputs-crop-count'), production:document.getElementById('inputs-production'),
  charts:document.getElementById('inputs-charts'), table:document.getElementById('inputs-table'), status:document.getElementById('inputs-register-status'), range:document.getElementById('inputs-register-range'), previous:document.getElementById('inputs-prev-page'), next:document.getElementById('inputs-next-page'),
  filterBar:document.querySelector('.inputs-controls'), filterStatus:document.querySelector('[data-shared-filter-status]'), filterReset:document.querySelector('[data-shared-filter-reset]')
};
elements.filterBar.insertAdjacentHTML('beforeend','<div class="shared-filter-actions"><span data-shared-filter-status>Ready</span><button type="button" data-shared-filter-reset>Reset</button></div>');
elements.filterStatus=elements.filterBar.querySelector('[data-shared-filter-status]');
elements.filterReset=elements.filterBar.querySelector('[data-shared-filter-reset]');
const compact = chartFormat.compact;
let entries = [], page = 0, controller;
const pageSize = 5;
const title = (value) => String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());

function setOptions(filters) {
  elements.year.innerHTML = `<option value="all">All years</option>${filters.availableYears.map((year) => `<option value="${year}">${year}</option>`).join('')}`;
  elements.year.value = filters.year;
  elements.district.innerHTML = `<option value="all">All districts</option>${filters.availableDistricts.map((district) => `<option value="${district}">${title(district)}</option>`).join('')}`;
  elements.district.value = filters.district;
}
function renderTable() {
  const start = page * pageSize, visible = entries.slice(start, start + pageSize);
  elements.table.innerHTML = visible.map((entry) => `<tr><td>${title(entry.district)}</td><td>${compact(entry.productionKg / 1000, 'T')}</td><td>${Number(entry.rows || 0).toLocaleString()}</td><td>${title(entry.primaryCrop)}</td><td>${Number.isFinite(entry.lossPercent) ? `${entry.lossPercent.toFixed(1)}%` : '—'}</td></tr>`).join('') || '<tr><td colspan="5">No districts in view.</td></tr>';
  elements.status.textContent = `${entries.length} districts in view`;
  elements.range.textContent = entries.length ? `Showing ${start + 1}–${Math.min(start + pageSize, entries.length)} of ${entries.length} districts` : 'No districts in view';
  elements.previous.disabled = page === 0; elements.next.disabled = start + pageSize >= entries.length;
}
function renderCharts(overview, districtSeries) {
  const context = `${elements.year.selectedOptions[0].textContent} · ${elements.district.selectedOptions[0].textContent}`;
  const crops = overview.productionByCrop.slice(0, 8);
  const rankedDistricts = entries.slice().sort((a,b) => b.productionKg - a.productionKg);
  const trend = districtSeries.filter((row) => elements.year.value === 'all' || String(row.year) === elements.year.value).map((row) => ({ label:`${String(row.year).slice(-2)} ${row.season}`, period:`${row.year} Season ${row.season}`, value:row.weightedProductionKg / 1000 }));
  renderChartGrid(elements.charts, [
    { type:'bar', title:'Top 10 Crops by Weighted Production', eyebrow:'CROP OUTPUT', description:'Leading crop categories ranked by weighted production.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:crops.slice(0,10).map((row) => ({ label:row.crop, value:row.productionKg / 1000 })) },
    { type:'donut', title:'Production Share by Crop', eyebrow:'CROP SHARE', description:'Contribution of leading crops to weighted production.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', centerLabel:'TONNES', context, data:crops.slice(0,5).map((row) => ({ label:row.crop, value:row.productionKg / 1000 })) },
    { type:'bar', title:'Top 10 Districts by Production', eyebrow:'DISTRICT COMPARISON', description:'Leading districts ranked by weighted production.', categoryLabel:'District', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:rankedDistricts.slice(0,10).map((row) => ({ label:title(row.district), value:row.productionKg / 1000 })) },
    { type:'line', title:'Production by Survey Season', eyebrow:'SURVEY TREND', description:'Observed production across available survey periods.', categoryLabel:'Year and season', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:trend }
  ]);
}
async function load() {
  controller?.abort(); controller = new AbortController();
  elements.filterBar.classList.add('is-loading'); elements.filterStatus.textContent = 'Updating insights…';
  try {
    const query = new URLSearchParams({ year:elements.year.value, district:elements.district.value });
    const trendQuery = new URLSearchParams({ districtCode:elements.district.value });
    const overviewResponse = await fetch(`${apiBaseUrl}/api/overview?${query}`, { signal:controller.signal });
    if (!overviewResponse.ok) throw new Error(`Survey data returned ${overviewResponse.status}.`);
    const overview = await overviewResponse.json();
    setOptions(overview.filters); entries = overview.districtPerformance; page = 0;
    animateMetric(elements.rows, overview.dataQuality.rowsUsed, (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—');
    animateMetric(elements.districts, entries.length); animateMetric(elements.crops, overview.productionByCrop.length);
    animateMetric(elements.production, overview.kpis.weightedProductionKg / 1000, (value) => compact(value, 'T'));
    renderTable(); renderCharts(overview, []);
    elements.filterStatus.textContent = 'Updated just now';
    fetch(`${apiBaseUrl}/api/timeseries?${trendQuery}`, { signal:controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Survey trend returned ${response.status}.`)))
      .then((series) => { if (!controller.signal.aborted) renderCharts(overview, series); })
      .catch((error) => { if (error.name !== 'AbortError') console.warn('Farm production trend is unavailable; current survey data remains visible.', error); });
  } catch (error) { if (error.name !== 'AbortError') { console.error('Farm production data could not be loaded.', error); elements.filterStatus.textContent = 'Data unavailable'; elements.status.textContent = error.message; } }
  finally { elements.filterBar.classList.remove('is-loading'); }
}
elements.year.addEventListener('change', load); elements.district.addEventListener('change', load);
elements.filterReset.addEventListener('click', () => { elements.year.value = 'all'; elements.district.value = 'all'; load(); });
elements.previous.addEventListener('click', () => { page -= 1; renderTable(); }); elements.next.addEventListener('click', () => { page += 1; renderTable(); });
load();
