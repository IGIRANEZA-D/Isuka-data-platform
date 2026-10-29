import { attachTooltip } from './chart-tooltip.js';
import { animateMetric } from '/lib/metric-animation.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';

const chartPalette = ['#6FA83C', '#C08A3E', '#3D6B1F', '#A83C3C', '#5D7E9B'];
const riskPalette = { low: '#6FA83C', moderate: '#C08A3E', high: '#A83C3C' };

const elements = {
  sidebar: document.querySelector('.sidebar'),
  collapseToggle: document.querySelector('.collapse-toggle'),
  yearFilter: document.getElementById('year-filter'),
  districtFilter: document.getElementById('district-filter'),
  forecastPeriod: document.getElementById('forecast-period'),
  chartLegend: document.getElementById('chart-legend'),
  donutLegend: document.getElementById('donut-legend'),
  donutChart: document.getElementById('donut-chart'),
  donutCenterValue: document.getElementById('donut-center-value'),
  yieldChart: document.getElementById('yield-chart'),
  filterBar: document.querySelector('.overview-filters'),
  filterSummary: document.querySelector('[data-filter-summary]'),
  filterStatus: document.querySelector('[data-filter-status]'),
  filterReset: document.querySelector('[data-filter-reset]')
};

let overviewRequestController;

function formatCompact(value, suffix = '') {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M ${suffix}`.trim();
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K ${suffix}`.trim();
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${suffix}`.trim();
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function trendBadge(value, lowerIsBetter = false) {
  if (!Number.isFinite(value)) return { text: '—', tone: 'neutral' };
  const positive = lowerIsBetter ? value <= 0 : value >= 0;
  return { text: `${value >= 0 ? '↗' : '↘'} ${Math.abs(value).toFixed(1)}%`, tone: positive ? 'positive' : 'negative' };
}

function setCardValue(cardKey, numericValue, formatter, trend) {
  const card = document.querySelector(`.kpi-card[data-card="${cardKey}"]`);
  if (!card) return;
  const value = card.querySelector('[data-value]');
  const trendElement = card.querySelector('[data-type="trend"]');
  animateMetric(value, numericValue, formatter);
  value.title = Number.isFinite(Number(numericValue)) ? '' : 'Data unavailable for this period';
  trendElement.textContent = trend.text;
  trendElement.classList.remove('trend-positive', 'trend-negative');
  if (trend.tone !== 'neutral') trendElement.classList.add(`trend-${trend.tone}`);
}

function renderKpis(overview) {
  const { kpis, trends } = overview;
  setCardValue('land', kpis.arableLandHa, (value) => formatCompact(value, 'Ha'), trendBadge(trends.arableLandPercent));
  setCardValue('harvest', kpis.weightedProductionKg / 1000, (value) => formatCompact(value, 'Tons'), trendBadge(trends.weightedProductionPercent));
  setCardValue('loss', kpis.postHarvestLossPercent, formatPercent, trendBadge(trends.postHarvestLossPercent, true));
  setCardValue('risk', kpis.highRiskDistrictCount, (value) => Number.isFinite(value) ? String(Math.round(value)) : '—', { text: 'Reported tier', tone: 'neutral' });
}

function renderChart(overview) {
  const entries = overview.productionByCrop.slice(0, 5);
  const svg = elements.yieldChart;
  const width = 760;
  const height = 260;
  const left = 150;
  const right = 20;
  const top = 24;
  const rowHeight = entries.length ? (height - top - 20) / entries.length : 40;
  const maxValue = Math.max(...entries.map((entry) => entry.productionKg), 1);
  svg.innerHTML = '';

  entries.forEach((entry, index) => {
    const y = top + index * rowHeight + 8;
    const barWidth = (entry.productionKg / maxValue) * (width - left - right);
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', left);
    background.setAttribute('y', y);
    background.setAttribute('width', width - left - right);
    background.setAttribute('height', 18);
    background.setAttribute('rx', 4);
    background.setAttribute('fill', '#E5E9E0');
    svg.appendChild(background);

    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.classList.add('yield-chart-bar');
    bar.style.setProperty('--chart-index', index);
    bar.setAttribute('x', left);
    bar.setAttribute('y', y);
    bar.setAttribute('width', barWidth);
    bar.setAttribute('height', 18);
    bar.setAttribute('rx', 4);
    bar.setAttribute('fill', chartPalette[index % chartPalette.length]);
    svg.appendChild(bar);
    attachTooltip(bar, `<strong>Actual: ${formatCompact(entry.productionKg / 1000, 'T')}</strong><span>${entry.crop} · ${overview.period.year} Season ${overview.period.season}</span><b>Weighted production</b>`);

    const valueLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const valueX = Math.min(left + barWidth + 8, width - right - 4);
    valueLabel.setAttribute('x', valueX);
    valueLabel.setAttribute('y', y + 13);
    valueLabel.setAttribute('fill', '#1F2E17');
    valueLabel.setAttribute('font-size', '11');
    valueLabel.setAttribute('font-weight', '700');
    valueLabel.setAttribute('text-anchor', valueX >= width - right - 8 ? 'end' : 'start');
    valueLabel.textContent = formatCompact(entry.productionKg / 1000, 'T');
    valueLabel.setAttribute('aria-label', `${entry.crop}: ${valueLabel.textContent}`);
    svg.appendChild(valueLabel);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', left - 12);
    label.setAttribute('y', y + 13);
    label.setAttribute('fill', '#1F2E17');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'end');
    label.textContent = entry.crop;
    svg.appendChild(label);
  });

  elements.chartLegend.innerHTML = entries.length
    ? `<span class="legend-item">Top ${entries.length} crops by weighted production</span>`
    : '<span class="legend-item">No production data available</span>';
}

function renderDonut(overview) {
  const entries = overview.riskDistribution;
  const total = entries.reduce((sum, entry) => sum + entry.districtCount, 0);
  const safeTotal = total || 1;
  let offset = 0;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 220 220');
  svg.setAttribute('width', '220');
  svg.setAttribute('height', '220');

  entries.forEach((entry) => {
    const fraction = entry.districtCount / safeTotal;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    path.classList.add('risk-segment');
    path.setAttribute('cx', '110');
    path.setAttribute('cy', '110');
    path.setAttribute('r', '72');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', riskPalette[entry.tier] || '#6B7566');
    path.setAttribute('stroke-width', '22');
    path.setAttribute('stroke-dasharray', `${fraction * 452} 452`);
    path.setAttribute('stroke-dashoffset', `${-offset * 452}`);
    path.setAttribute('transform', 'rotate(-90 110 110)');
    svg.appendChild(path);
    attachTooltip(path, `<strong>Actual: ${entry.districtCount} districts</strong><span>${entry.tier[0].toUpperCase()}${entry.tier.slice(1)} risk · ${overview.period.year} Season ${overview.period.season}</span><b>${total ? ((entry.districtCount / total) * 100).toFixed(1) : '0.0'}% of districts</b>`);
    offset += fraction;
  });

  elements.donutChart.innerHTML = '';
  elements.donutChart.appendChild(svg);
  const center = document.createElement('div');
  center.className = 'donut-center';
  const centerValue = document.createElement('span');
  centerValue.id = 'donut-center-value';
  center.appendChild(centerValue);
  elements.donutChart.appendChild(center);
  elements.donutChart.classList.add('has-rendered');
  elements.donutCenterValue = centerValue;
  animateMetric(elements.donutCenterValue, total || Number.NaN, (value) => Number.isFinite(value) ? String(Math.round(value)) : '—');
  elements.donutLegend.innerHTML = entries.map((entry) => `
    <div class="donut-row">
      <span class="legend-swatch" style="background:${riskPalette[entry.tier] || '#6B7566'};"></span>
      <span class="donut-label">${entry.tier[0].toUpperCase()}${entry.tier.slice(1)} risk</span>
      <span class="donut-percent">${entry.districtCount} (${total ? ((entry.districtCount / total) * 100).toFixed(1) : '0.0'}%)</span>
    </div>
  `).join('') || '<span class="legend-item">No district risk data available</span>';
}

function applyLoadingState() {
  document.querySelectorAll('.kpi-card, .panel, .donut-chart').forEach((item) => item.classList.add('skeleton'));
}

function removeLoadingState() {
  document.querySelectorAll('.kpi-card, .panel, .donut-chart').forEach((item) => item.classList.remove('skeleton'));
}

function showError(message) {
  elements.forecastPeriod.textContent = '(unavailable)';
  elements.chartLegend.textContent = message;
  elements.donutLegend.innerHTML = '<span class="legend-item">Data unavailable</span>';
  ['land', 'harvest', 'loss', 'risk'].forEach((key) => setCardValue(key, Number.NaN, () => '—', { text: 'Unavailable', tone: 'neutral' }));
}

async function loadOverview() {
  overviewRequestController?.abort();
  overviewRequestController = new AbortController();
  const params = new URLSearchParams({
    year: elements.yearFilter.value,
    district: elements.districtFilter.value
  });
  const response = await fetch(`${apiBaseUrl}/api/overview?${params.toString()}`, {
    cache: 'no-store',
    signal: overviewRequestController.signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error('Dashboard data is temporarily unavailable. Please try again.');
  return result;
}

function formatDistrictName(district) {
  return district.replace(/\b\w/g, (character) => character.toUpperCase());
}

function updateYearOptions(years, selectedYear) {
  const options = [
    '<option value="all">All years</option>',
    ...years.map((year) => `<option value="${year}">${year}</option>`)
  ].join('');
  elements.yearFilter.innerHTML = options;
  elements.yearFilter.value = years.includes(Number(selectedYear)) ? selectedYear : 'all';
}

function updateDistrictOptions(districts, selectedDistrict) {
  const options = [
    '<option value="all">All districts</option>',
    ...districts.map((district) => `<option value="${district}">${formatDistrictName(district)}</option>`)
  ].join('');
  elements.districtFilter.innerHTML = options;
  elements.districtFilter.value = districts.includes(selectedDistrict) ? selectedDistrict : 'all';
}

function updateFilterContext() {
  const year = elements.yearFilter.selectedOptions[0]?.textContent || 'All years';
  const district = elements.districtFilter.selectedOptions[0]?.textContent || 'All districts';
  elements.filterSummary.textContent = `${year} · ${district}`;
}

function renderOverview(overview) {
  elements.forecastPeriod.textContent = `(${overview.period.year} ${overview.period.season})`;
  updateYearOptions(overview.filters.availableYears, overview.filters.year);
  updateDistrictOptions(overview.filters.availableDistricts, overview.filters.district);
  updateFilterContext();
  renderKpis(overview);
  renderChart(overview);
  renderDonut(overview);
}

function setupSidebar() {
  elements.collapseToggle.addEventListener('click', () => elements.sidebar.classList.toggle('collapsed'));
  const refresh = async () => {
    elements.filterBar.classList.add('is-loading');
    elements.filterStatus.textContent = 'Updating insights...';
    applyLoadingState();
    try {
      renderOverview(await loadOverview());
      elements.filterStatus.textContent = 'Updated just now';
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      showError(error.message || 'Filtered data unavailable. Check the backend service.');
      elements.filterStatus.textContent = 'Update failed';
    } finally {
      removeLoadingState();
      elements.filterBar.classList.remove('is-loading');
    }
  };
  elements.yearFilter.addEventListener('change', refresh);
  elements.districtFilter.addEventListener('change', refresh);
  elements.filterReset.addEventListener('click', () => {
    elements.yearFilter.value = 'all';
    elements.districtFilter.value = 'all';
    refresh();
  });
}

async function init() {
  applyLoadingState();
  setupSidebar();
  try {
    renderOverview(await loadOverview());
  } catch (error) {
    console.error(error);
    showError(error.message || 'Overview data unavailable. Check the backend service.');
    elements.filterStatus.textContent = 'Data unavailable';
  } finally {
    removeLoadingState();
  }
}

init();
