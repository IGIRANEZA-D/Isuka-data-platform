import {
  computeScenario,
  formatCount,
  formatRwf,
  formatSacks,
  formatTonnes,
  coverageBand,
  serializeScenarioState,
  parseScenarioState,
  stageIds
} from './lib/loss-scenario.js';
import { attachTooltip } from './chart-tooltip.js';

const stageGroups = [
  { id: 'field', label: 'In the field', members: ['pests', 'animals'], icon: '<path d="M12 21V9M12 14c-4 0-7-2.5-7-6 4 0 7 2.5 7 6ZM12 11c0-3.5 3-6 7-6 0 3.5-3 6-7 6Z"/>' },
  { id: 'harvest', label: 'Harvest', members: ['harvest'], icon: '<path d="M12 21V8m0 5c-4-1-6-3-6-7 4 0 6 2 6 7Zm0-3c0-4 2-7 6-8 0 4-2 7-6 8Z"/>' },
  { id: 'transport', label: 'Transport', members: ['transport'], icon: '<path d="M3 7h11v11H3zM14 11h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>' },
  { id: 'storage', label: 'Storage', members: ['storage'], icon: '<path d="M4 10 12 4l8 6v10H4zM9 20v-7h6v7M8 10h8"/>' },
  { id: 'processing', label: 'Processing and packaging', members: ['processing'], icon: '<path d="M4 8h16v12H4zM8 8V5h8v3M8 12h8M8 16h5"/>' },
  { id: 'sales', label: 'Sales', members: ['sales'], icon: '<path d="M4 10h16l-2-6H6zM6 10v10h12V10M9 20v-6h6v6"/>' },
  { id: 'other', label: 'Other', members: ['other'], icon: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>' }
];

const elements = {
  stage: document.getElementById('lp-stage'), crop: document.getElementById('lp-crop'), year: document.getElementById('lp-year'), season: document.getElementById('lp-season'),
  districtTrigger: document.getElementById('lp-district-trigger'), popover: document.querySelector('[data-district-popover]'), districtSearch: document.getElementById('lp-district-search'), districtOptions: document.querySelector('[data-district-options]'), districtCount: document.querySelector('[data-district-count]'),
  slider: document.getElementById('lp-reduction'), inlineReduction: document.querySelector('[data-inline-reduction]'),
  example: document.querySelector('[data-example-scenario]'), stateNote: document.querySelector('[data-state-note]'),
  answerCard: document.querySelector('.lp-answer'), answerSkeleton: document.querySelector('[data-answer-skeleton]'), answerTonnes: document.querySelector('[data-answer-tonnes]'), answerValue: document.querySelector('[data-answer-value]'), answerSacks: document.querySelector('[data-answer-sacks]'), answerSentence: document.querySelector('[data-answer-sentence]'), rangeLine: document.querySelector('[data-range-line]'), answerChips: document.querySelector('[data-answer-chips]'), lowCoverage: document.querySelector('[data-low-coverage]'), suppressed: document.querySelector('[data-suppressed]'), disclaimer: document.querySelector('[data-disclaimer]'), empty: document.querySelector('[data-empty]'),
  stagesCard: document.querySelector('.lp-stages'), stageSkeleton: document.querySelector('[data-stage-skeleton]'), stageChart: document.querySelector('[data-stage-chart]'), stageTable: document.querySelector('[data-stage-table]'), stageTableWrap: document.querySelector('[data-stage-table-wrap]'), stageTableToggle: document.querySelector('[data-stage-table-toggle]'), stageSummary: document.querySelector('[data-stage-summary]'),
  districtsCard: document.querySelector('.lp-districts'), districtSkeleton: document.querySelector('[data-district-skeleton]'), districtList: document.querySelector('[data-district-list]'), showAll: document.querySelector('[data-show-all]'), map: document.getElementById('lp-map'), method: document.querySelector('[data-method-content]'), live: document.querySelector('[data-live-region]'),
  reset: document.querySelector('[data-reset]'), copy: document.querySelector('[data-copy-link]'), download: document.querySelector('[data-download-csv]'),
  scenarioCard: document.querySelector('.lp-scenario'), mapNote: document.querySelector('[data-map-note]')
};

const stageToMembers = Object.fromEntries(stageGroups.map((group) => [group.id, group.members]));
const uiStageId = (stageId) => ['pests', 'animals'].includes(stageId) ? 'field' : stageId;
const toTonnes = (value) => formatTonnes(value).replace(/ t$/, ' tonnes');
const periodLabel = (periods) => periods?.length ? periods.map((period) => `${period.year} ${period.season}`).join(', ') : 'Not available';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const escapeCsv = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const normalizeDistrict = (value) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '').replace('nyarugenege', 'nyarugenge');
const titleCase = (value) => String(value ?? '').replace(/\b\w/g, (letter) => letter.toUpperCase());

let baseline = null;
let state = { cropCode: null, years: 'all', seasons: 'all', districts: 'all', stage: 'all', reductionPct: 30 };
let selectedDistricts = 'all';
let scenarioResult = null;
let range20 = null;
let range40 = null;
let showEveryDistrict = false;
let districtPage = 1;
const districtsPerPage = 5;
let openDistrict = null;
let currentMetric = 'tonnes';
let map = null;
let boundaryLayer = null;
let mapFeatures = [];
let announceTimer;
let animationFrame;
let previousRecoveredKg = null;
let liveLabel = '';

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request returned ${response.status}`);
  return result;
}

function requestedPeriods() {
  const params = new URLSearchParams();
  params.set('years', state.years);
  params.set('seasons', state.seasons);
  return params.toString();
}

function selectedPeriodKeys() {
  return new Set((baseline?.meta?.periods || []).map((period) => `${period.year}-${period.season}`));
}

function stageAvailable(group) {
  const selected = selectedPeriodKeys();
  const stageMeta = new Map((baseline?.stages || []).map((stage) => [stage.id, stage]));
  const members = stageToMembers[group.id] || [];
  const memberStages = members.map((id) => stageMeta.get(id));
  if (!memberStages.length || memberStages.some((stage) => !stage || stage.unitStatus !== 'confirmed')) return false;
  return [...selected].some((periodKey) => memberStages.every((stage) => stage.availablePeriods.some((period) => `${period.year}-${period.season}` === periodKey)));
}

function selectedStageIds(stage = state.stage) {
  if (stage === 'all') return stageGroups.filter(stageAvailable).flatMap((group) => group.members);
  return stageToMembers[stage] || [];
}

function selectedDistrictFilter() {
  return selectedDistricts === 'all' ? 'all' : [...selectedDistricts];
}

function calculate(reductionPct = state.reductionPct) {
  if (!baseline || !state.cropCode) return null;
  return computeScenario({
    rows: baseline.rows,
    cropCode: state.cropCode,
    districtCodes: selectedDistrictFilter(),
    stageIds: selectedStageIds(),
    availableStageIds: baseline.stages.filter((stage) => stage.unitStatus === 'confirmed').map((stage) => stage.id),
    reductionPct,
    minRecords: baseline.meta.minRecords
  });
}

function updateUrl() {
  const stageIdsForUrl = state.stage === 'all' ? ['all'] : [state.stage];
  const query = serializeScenarioState({
    cropCode: state.cropCode,
    years: state.years,
    seasons: state.seasons,
    districtCodes: selectedDistricts,
    stageIds: stageIdsForUrl,
    reductionPct: state.reductionPct
  });
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { elements.live.textContent = message; }, 180);
}

function setLoading(loading) {
  elements.answerSkeleton.hidden = !loading;
  elements.stageSkeleton.hidden = !loading;
  elements.districtSkeleton.hidden = !loading;
  for (const card of [elements.answerCard, elements.stagesCard, elements.districtsCard]) {
    card.setAttribute('aria-busy', String(loading));
    card.classList.toggle('is-loading', loading);
  }
}

function setError(error) {
  elements.stateNote.hidden = false;
  elements.stateNote.className = 'lp-error';
  elements.stateNote.innerHTML = `<span>${escapeHtml(error.message || 'Data could not be loaded.')}</span><button type="button" data-retry>Retry</button>`;
  elements.stateNote.querySelector('[data-retry]').addEventListener('click', () => loadBaseline());
  elements.answerTonnes.textContent = 'Not available';
  elements.answerValue.textContent = 'Value not available';
  elements.answerSacks.textContent = 'Not available';
  elements.stageChart.replaceChildren();
  elements.districtList.replaceChildren();
  scenarioResult = null;
}

async function loadBaseline({ keepCrop = true } = {}) {
  setLoading(true);
  elements.stateNote.hidden = true;
  try {
    baseline = await getJson(`/api/loss-planner/baseline?${requestedPeriods()}`);
    const validCrops = new Set(baseline.crops.map((crop) => crop.code));
    if (!validCrops.has(state.cropCode) || !keepCrop) {
      const defaultState = await getJson(`/api/loss-planner/default?${requestedPeriods()}`);
      const invalidCrop = Boolean(state.cropCode && !validCrops.has(state.cropCode));
      state.cropCode = defaultState.cropCode || baseline.crops[0]?.code || null;
      if (!state.stage || state.stage === 'all') state.stage = uiStageId(defaultState.stageId) || 'all';
      if (invalidCrop && new URLSearchParams(location.search).has('crop')) {
        elements.stateNote.hidden = false;
        elements.stateNote.className = 'lp-state-note';
        elements.stateNote.textContent = 'The crop in this shared link is unavailable for these periods; the default scenario was restored.';
      }
      if (!new URLSearchParams(location.search).has('crop') && defaultState.period) {
        state.years = String(defaultState.period.year);
        state.seasons = defaultState.period.season;
        baseline = await getJson(`/api/loss-planner/baseline?${requestedPeriods()}`);
      }
    }
    populateControls();
    renderScenario();
    updateUrl();
    elements.example.hidden = liveLabel !== '';
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}

function aggregateCropProduction() {
  const totals = new Map();
  for (const row of baseline?.rows || []) {
    if (selectedDistricts !== 'all' && !selectedDistricts.has(row.d)) continue;
    totals.set(row.c, (totals.get(row.c) || 0) + (Number(row.productionKg) || 0));
  }
  return totals;
}

function populateCrops() {
  const production = aggregateCropProduction();
  const crops = [...baseline.crops].sort((a, b) => a.name.localeCompare(b.name));
  const largest = [...crops].sort((a, b) => (production.get(b.code) || 0) - (production.get(a.code) || 0)).slice(0, 8);
  const largestCodes = new Set(largest.map((crop) => crop.code));
  const allOther = crops.filter((crop) => !largestCodes.has(crop.code));
  const option = (crop) => `<option value="${escapeHtml(crop.code)}">${escapeHtml(crop.name)}</option>`;
  elements.crop.innerHTML = `<optgroup label="Largest crops">${largest.map(option).join('')}</optgroup><optgroup label="All crops (A to Z)">${allOther.map(option).join('')}</optgroup>`;
  if (crops.some((crop) => crop.code === state.cropCode)) elements.crop.value = state.cropCode;
  else if (crops[0]) {
    state.cropCode = crops[0].code;
    elements.crop.value = state.cropCode;
  }
}

function renderDistrictPicker() {
  const districts = baseline?.districts || [];
  const query = elements.districtSearch.value.trim().toLowerCase();
  const visible = districts.filter((district) => !query || district.name.toLowerCase().includes(query) || district.code.toLowerCase().includes(query));
  elements.districtOptions.innerHTML = visible.map((district) => {
    const checked = selectedDistricts === 'all' || selectedDistricts.has(district.code);
    return `<label class="lp-district-option"><input type="checkbox" value="${escapeHtml(district.code)}" ${checked ? 'checked' : ''}><span>${escapeHtml(district.name)}</span></label>`;
  }).join('') || '<p class="lp-subtitle">No matching districts.</p>';
  elements.districtOptions.querySelectorAll('input').forEach((checkbox) => checkbox.addEventListener('change', () => {
    if (selectedDistricts === 'all') selectedDistricts = new Set(districts.map((district) => district.code));
    if (checkbox.checked) selectedDistricts.add(checkbox.value);
    else selectedDistricts.delete(checkbox.value);
    if (selectedDistricts.size === districts.length) selectedDistricts = 'all';
    refreshDistrictButton();
    renderStageOptions(calculate(0));
    renderScenario();
    updateUrl();
  }));
}

function refreshDistrictButton() {
  if (selectedDistricts === 'all') {
    elements.districtTrigger.innerHTML = 'All districts <span aria-hidden="true">⌄</span>';
    elements.districtCount.textContent = 'All districts';
  } else {
    elements.districtTrigger.innerHTML = `${selectedDistricts.size} districts <span aria-hidden="true">⌄</span>`;
    elements.districtCount.textContent = `${selectedDistricts.size} selected`;
  }
}

function setupPinnedFilters() {
  const toolbar = document.querySelector('.lp-filter-toolbar');
  const slot = document.querySelector('.lp-filter-slot');
  const sentinel = document.querySelector('.lp-filter-sentinel');
  let pinned = false;
  const setPinned = (shouldPin) => {
    const canPin = shouldPin && !window.matchMedia('(max-width: 640px)').matches;
    pinned = canPin;
    toolbar.classList.toggle('is-pinned', canPin);
    if (!canPin) {
      slot.style.minHeight = '';
      toolbar.style.removeProperty('left');
      toolbar.style.removeProperty('width');
      return;
    }
    slot.style.minHeight = `${toolbar.offsetHeight}px`;
    const main = document.querySelector('.lp-main');
    const bounds = main.getBoundingClientRect();
    const style = getComputedStyle(main);
    toolbar.style.left = `${bounds.left + parseFloat(style.paddingLeft)}px`;
    toolbar.style.width = `${bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`;
  };
  const syncPinned = () => setPinned(sentinel.getBoundingClientRect().top < 8);
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      syncPinned();
      scheduled = false;
    });
  }, { passive: true });
  window.addEventListener('resize', syncPinned);
  syncPinned();
}

function positionDistrictPopover() {
  if (elements.popover.parentElement !== document.body) document.body.append(elements.popover);
  const trigger = elements.districtTrigger.getBoundingClientRect();
  const margin = 12;
  const width = Math.min(360, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(trigger.left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(trigger.bottom + 6, window.innerHeight - elements.popover.offsetHeight - margin));
  elements.popover.style.left = `${left}px`;
  elements.popover.style.top = `${top}px`;
}

function renderStageOptions(shareResult) {
  const rows = new Map((shareResult?.totals?.stageRows || []).map((row) => [row.id, row]));
  const options = stageGroups.map((group) => {
    const available = stageAvailable(group);
    const stageRow = rows.get(group.id);
    const share = stageRow && Number.isFinite(stageRow.recordedLossSharePct) ? ` (${stageRow.recordedLossSharePct.toFixed(1)}% of recorded loss)` : '';
    let reason = '';
    if (!available) {
      const members = group.members.map((id) => baseline.stages.find((stage) => stage.id === id));
      reason = members.some((stage) => !stage || stage.unitStatus !== 'confirmed') ? ' — unit unconfirmed' : ' — not recorded for this period';
    }
    return `<option value="${group.id}" ${available ? '' : 'disabled'}>${escapeHtml(group.label + share + reason)}</option>`;
  }).join('');
  elements.stage.innerHTML = `<option value="all">All stages</option>${options}`;
  if (state.stage !== 'all' && stageAvailable(stageGroups.find((group) => group.id === state.stage) || { id: state.stage })) elements.stage.value = state.stage;
  else {
    state.stage = 'all';
    elements.stage.value = 'all';
  }
}

function populateControls() {
  elements.year.value = state.years;
  elements.season.value = state.seasons;
  populateCrops();
  const confirmedStageIds = baseline.stages.filter((stage) => stage.unitStatus === 'confirmed').map((stage) => stage.id);
  renderStageOptions(computeScenario({ rows: baseline.rows, cropCode: state.cropCode, districtCodes: selectedDistrictFilter(), stageIds: confirmedStageIds, availableStageIds: confirmedStageIds, reductionPct: 0, minRecords: baseline.meta.minRecords }));
  elements.slider.value = String(state.reductionPct);
  elements.slider.setAttribute('aria-valuetext', `${state.reductionPct} percent`);
  elements.inlineReduction.textContent = `${state.reductionPct}%`;
  const position = `${state.reductionPct}%`;
  elements.slider.style.setProperty('--lp-thumb-position', position);
  elements.slider.parentElement.style.setProperty('--lp-thumb-position', position);
  refreshDistrictButton();
  renderDistrictPicker();
}

function currentPeriodText() {
  return periodLabel(baseline?.meta?.periods);
}

function formatMoneyLabel(result) {
  if (result.totals.priceBasis === 'district') return 'District median price';
  if (result.totals.priceBasis === 'national') return 'National crop price';
  if (result.totals.priceBasis === 'mixed') return 'District and national prices';
  return 'No price available';
}

function animateTonnes(value) {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  if (!Number.isFinite(value)) {
    elements.answerTonnes.textContent = 'Not available';
    previousRecoveredKg = null;
    return;
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = previousRecoveredKg ?? 0;
  const end = value;
  previousRecoveredKg = value;
  if (reduceMotion || start === end) {
    elements.answerTonnes.textContent = toTonnes(end);
    return;
  }
  const startTime = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startTime) / 700);
    const eased = 1 - Math.pow(1 - progress, 3);
    elements.answerTonnes.textContent = toTonnes(start + (end - start) * eased);
    if (progress < 1) animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function renderAnswer(result) {
  const selectedName = baseline.crops.find((crop) => crop.code === state.cropCode)?.name || 'Not available';
  const stageName = stageGroups.find((group) => group.id === state.stage)?.label || 'all recorded stages';
  const districtText = selectedDistricts === 'all' ? 'all districts' : `${selectedDistricts.size} districts`;
  const totals = result.totals;
  const empty = !totals.hasSelectedLoss;
  elements.empty.hidden = !empty;
  elements.slider.disabled = empty;
  animateTonnes(empty ? null : totals.recoveredKg);
  elements.answerValue.textContent = totals.valueRwf === null ? 'Value not available' : `about ${formatRwf(totals.valueRwf)}`;
  elements.answerValue.classList.toggle('is-muted', totals.valueRwf === null);
  elements.answerSacks.textContent = totals.recoveredKg >= 0 ? `about ${formatSacks(totals.recoveredKg)} of 50 kg` : 'Not available';
  elements.answerSentence.textContent = `Cutting ${stageName} loss in ${selectedName} by ${state.reductionPct}% across ${districtText}, based on ${currentPeriodText()} survey data.`;
  elements.rangeLine.textContent = `A 20% cut saves about ${toTonnes(range20?.totals.recoveredKg)}. A 40% cut about ${toTonnes(range40?.totals.recoveredKg)}.`;
  const band = coverageBand(totals.coveragePct);
  const coverageText = Number.isFinite(totals.coveragePct) ? `${band[0].toUpperCase()}${band.slice(1)} · ${totals.coveragePct.toFixed(1)}% stage-data coverage` : 'Coverage not available';
  elements.answerChips.innerHTML = `<span class="lp-chip ${band === 'high' ? 'is-high' : band === 'unavailable' ? '' : 'is-medium'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6l7-3Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/></svg>Coverage: ${escapeHtml(coverageText)}</span><span class="lp-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v10m3-7H9m6 4H9"/></svg>${escapeHtml(formatMoneyLabel(result))}</span><span class="lp-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>${escapeHtml(formatCount(totals.includedRecords))} survey records</span>`;
  elements.lowCoverage.hidden = band !== 'low';
  elements.suppressed.hidden = totals.suppressedCount === 0;
  if (totals.suppressedCount) elements.suppressed.textContent = `${formatCount(totals.suppressedCount)} district-crop combinations excluded (fewer than ${baseline.meta.minRecords} survey records).`;
  elements.disclaimer.textContent = `What-if estimate based on NISR survey data (${currentPeriodText()}). Not a forecast or a guarantee.`;
  announce(`${elements.answerTonnes.textContent} estimated harvest saved. Coverage ${coverageText}.`);
}

function stageIcon(groupId) {
  const group = stageGroups.find((entry) => entry.id === groupId);
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${group?.icon || ''}</svg>`;
}

function renderStageTable(result) {
  elements.stageTable.innerHTML = result.totals.stageRows.filter((row) => row.available).map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(toTonnes(row.lossKg))}</td><td>${Number.isFinite(row.productionSharePct) ? `${row.productionSharePct.toFixed(1)}%` : 'Not available'}</td><td>${escapeHtml(formatCount(row.records))}</td></tr>`).join('');
  const unattrTonnes = toTonnes(result.totals.unattributedKg);
  elements.stageTable.insertAdjacentHTML('beforeend', `<tr><th scope="row">Not attributed to a stage</th><td>${escapeHtml(unattrTonnes)}</td><td>${Number.isFinite(result.totals.unattributedSharePct) ? `${result.totals.unattributedSharePct.toFixed(1)}%` : 'Not available'}</td><td>${escapeHtml(formatCount(result.totals.includedRecords))}</td></tr>`);
}

function renderStages(result) {
  const selected = new Set(selectedStageIds());
  const availableStageRows = result.totals.stageRows.filter((row) => row.available);
  const stageRows = availableStageRows.map((row) => {
    const selectedGroup = row.id === 'field' ? selected.has('pests') || selected.has('animals') : selected.has(row.id);
    const width = row.barWidthPct;
    const lossPart = selectedGroup ? `<span class="lp-stage-fill is-saved" style="width:${row.savedBarPct}%"></span><span class="lp-stage-fill is-remaining" style="width:${row.remainingBarPct}%"></span>` : `<span class="lp-stage-fill is-neutral" style="width:${width}%"></span>`;
    const value = `<span>${Number.isFinite(row.productionSharePct) ? `${row.productionSharePct.toFixed(1)}%` : 'Not available'} · ${toTonnes(row.lossKg)}</span><small>${escapeHtml(formatCount(row.records))} survey records with stage data</small>`;
    const tooltip = `${row.label}; ${toTonnes(row.lossKg)}; ${Number.isFinite(row.productionSharePct) ? `${row.productionSharePct.toFixed(1)}% of total production` : 'share not available'}; ${formatCount(row.records)} survey records with stage data`;
    return `<div class="lp-stage-row" title="${escapeHtml(tooltip)}"><span class="lp-stage-label">${stageIcon(row.id)}${escapeHtml(row.label)}</span><div class="lp-stage-track" aria-label="${escapeHtml(tooltip)}">${lossPart}</div><span class="lp-stage-value">${value}</span></div>`;
  });
  stageRows.push(`<div class="lp-stage-row" title="Not attributed to a stage; ${toTonnes(result.totals.unattributedKg)}"><span class="lp-stage-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 10h16M10 4v16"/></svg>Not attributed to a stage</span><div class="lp-stage-track"><span class="lp-stage-fill is-unattributed" style="width:${result.totals.unattributedBarPct}%"></span></div><span class="lp-stage-value">${escapeHtml(result.totals.includedProductionKg > 0 ? `${(result.totals.unattributedKg / result.totals.includedProductionKg * 100).toFixed(1)}%` : 'Not available')} | ${escapeHtml(toTonnes(result.totals.unattributedKg))}</span></div>`);
  elements.stageChart.innerHTML = stageRows.join('');
  elements.stageChart.querySelectorAll('.lp-stage-row').forEach((row, index) => {
    const item = availableStageRows[index];
    if (!item) return;
    attachTooltip(row, `<strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(toTonnes(item.lossKg))} · ${Number.isFinite(item.productionSharePct) ? `${item.productionSharePct.toFixed(1)}% of production` : 'Not recorded'}</span><b>${escapeHtml(formatCount(item.records))} survey records</b>`);
  });
  elements.stageSummary.textContent = Number.isFinite(result.totals.recordedLossPct) && Number.isFinite(result.totals.lossAfterPct)
    ? `Recorded loss: ${result.totals.recordedLossPct.toFixed(1)}% of production; ${result.totals.lossAfterPct.toFixed(1)}% after this change. ${availableStageRows.length} of 7 reported stages shown.`
    : `${availableStageRows.length} of 7 reported stages shown.`;
  renderStageTable(result);
}

function districtName(code) {
  return baseline.districts.find((district) => district.code === code)?.name || titleCase(code);
}

function metricValue(row) {
  return currentMetric === 'rwf' ? row.valueRwf : row.recoveredKg;
}

function metricText(row) {
  return row.suppressed ? 'Insufficient data' : currentMetric === 'rwf' ? formatRwf(row.valueRwf) : toTonnes(row.recoveredKg);
}

function renderDistrictDetails(row) {
  const mix = stageIds.map((id) => {
    const percent = row.stageMixPct?.[id];
    if (!Number.isFinite(percent)) return '';
    return `<span title="${escapeHtml(id)}" style="width:${percent}%"></span>`;
  }).join('');
  const price = row.priceRwfPerKg === null ? 'Value not available' : formatRwf(row.priceRwfPerKg);
  const basis = row.priceBasis === 'district' ? 'District median price' : row.priceBasis === 'national' ? 'National crop price' : 'No price available';
  return `<div class="lp-district-details"><span>Stage mix <span class="lp-mix">${mix}</span></span><span><strong>${escapeHtml(formatCount(row.records))}</strong> survey records</span><span><strong>${Number.isFinite(row.coveragePct) ? `${row.coveragePct.toFixed(1)}%` : 'Not available'}</strong> coverage</span><span><strong>${escapeHtml(price)}</strong> · ${escapeHtml(basis)}</span><span>Harvest saved <strong>${escapeHtml(toTonnes(row.recoveredKg))}</strong></span></div>`;
}

function renderDistrictList(result) {
  const names = new Map(baseline.districts.map((district) => [district.code, district.name]));
  const byCode = new Map(result.byDistrict.map((row) => [row.code, { ...row, name: names.get(row.code) || titleCase(row.code) }]));
  const targetDistricts = selectedDistricts === 'all' ? baseline.districts : baseline.districts.filter((district) => selectedDistricts.has(district.code));
  const rows = targetDistricts.map((district) => byCode.get(district.code) || {
    code: district.code,
    name: district.name,
    recoveredKg: null,
    valueRwf: null,
    records: null,
    coveragePct: null,
    stageKg: {},
    suppressed: true
  });
  const ranked = [...rows].filter((row) => !row.suppressed).sort((a, b) => (metricValue(b) ?? -1) - (metricValue(a) ?? -1));
  const orderedRows = ranked;
  const pageCount = Math.max(1, Math.ceil(orderedRows.length / districtsPerPage));
  districtPage = Math.min(districtPage, pageCount);
  const startIndex = showEveryDistrict ? 0 : (districtPage - 1) * districtsPerPage;
  const displayed = showEveryDistrict ? orderedRows : orderedRows.slice(startIndex, startIndex + districtsPerPage);
  const rankByCode = new Map(ranked.map((row, index) => [row.code, index + 1]));
  elements.districtList.innerHTML = displayed.map((row) => {
    const isOpen = openDistrict === row.code;
    const value = metricValue(row);
    const width = currentMetric === 'rwf' ? row.valueBarPct : row.tonnesBarPct;
    const bar = row.suppressed ? '<span class="lp-insufficient-marker" aria-hidden="true"></span>' : `<span class="lp-district-bar"><span style="width:${width ?? 0}%"></span></span>`;
    const rank = row.suppressed ? '—' : String(rankByCode.get(row.code));
    const item = `<div class="lp-district-row ${isOpen ? 'is-selected' : ''}" data-district-row="${escapeHtml(row.code)}"><button type="button" class="lp-district-row-main" aria-expanded="${isOpen}" aria-label="${escapeHtml(row.name)}: ${escapeHtml(metricText(row))}, open details"><span class="lp-rank">${rank}</span><span class="lp-district-name">${escapeHtml(row.name)}</span>${bar}<span class="lp-district-metric">${escapeHtml(metricText(row))}</span></button>${isOpen ? renderDistrictDetails(row) : ''}</div>`;
    return item;
  }).join('') || '<p class="lp-empty-state">No district results for this selection.</p>';
  elements.showAll.hidden = orderedRows.length <= districtsPerPage;
  elements.showAll.textContent = showEveryDistrict ? 'Show pages' : `Show all ${formatCount(orderedRows.length)}`;
  const previousPage = document.querySelector('[data-previous-page]');
  const nextPage = document.querySelector('[data-next-page]');
  const pageStatus = document.querySelector('[data-page-status]');
  previousPage.disabled = showEveryDistrict || districtPage <= 1;
  nextPage.disabled = showEveryDistrict || districtPage >= pageCount;
  pageStatus.textContent = showEveryDistrict ? `${formatCount(ranked.length)} districts shown` : `Page ${districtPage} of ${pageCount}`;
  elements.districtList.querySelectorAll('[data-district-row]').forEach((node) => {
    const code = node.dataset.districtRow;
    const rowData = result.byDistrict.find((entry) => entry.code === code);
    if (rowData && !rowData.suppressed) attachTooltip(node.querySelector('button'), `<strong>${escapeHtml(districtName(code))}</strong><span>${escapeHtml(toTonnes(rowData.recoveredKg))} saved · ${escapeHtml(formatRwf(rowData.valueRwf))}</span><b>${escapeHtml(formatCount(rowData.records))} records · ${Number.isFinite(rowData.coveragePct) ? `${rowData.coveragePct.toFixed(1)}% coverage` : 'coverage not available'}</b>`);
    node.querySelector('button').addEventListener('click', () => {
      const item = result.byDistrict.find((entry) => entry.code === code);
      if (item?.suppressed) return;
      openDistrict = openDistrict === code ? null : code;
      renderDistrictList(result);
      updateMapStyles(result);
    });
    node.addEventListener('mouseenter', () => highlightMapDistrict(code, true));
    node.addEventListener('mouseleave', () => highlightMapDistrict(code, false));
  });
}

function resultValueForCode(result, code) {
  const row = result.byDistrict.find((entry) => normalizeDistrict(entry.code) === normalizeDistrict(code));
  return row ? { row, value: metricValue(row) } : null;
}

function updateMapStyles(result) {
  if (!boundaryLayer) return;
  const bounds = result.totals.metricBounds[currentMetric];
  boundaryLayer.eachLayer((layer) => {
    const feature = layer.feature;
    const code = feature.properties.__lpCode;
    const found = resultValueForCode(result, code);
    const unavailable = !found || found.row.suppressed || !Number.isFinite(found.value);
    layer.setStyle({
      color: normalizeDistrict(code) === normalizeDistrict(openDistrict) ? '#254318' : '#FFFFFF',
      weight: normalizeDistrict(code) === normalizeDistrict(openDistrict) ? 2.5 : 1.5,
      fillColor: unavailable ? '#D9DDD3' : (currentMetric === 'rwf' ? found.row.valueMapColor : found.row.tonnesMapColor),
      fillOpacity: 1,
      opacity: 1
    });
    layer.options.interactive = !unavailable;
    const district = baseline.districts.find((item) => normalizeDistrict(item.code) === normalizeDistrict(code));
    const coverage = found && Number.isFinite(found.row.coveragePct) ? `${found.row.coveragePct.toFixed(1)}%` : 'Not available';
    if (unavailable) {
      layer.unbindTooltip();
    } else {
      layer.setTooltipContent(`${district?.name || titleCase(code)}<br>${escapeHtml(toTonnes(found.row.recoveredKg))} saved<br>${escapeHtml(formatRwf(found.row.valueRwf))}<br>${escapeHtml(formatCount(found.row.records))} records · ${coverage} coverage`);
    }
  });
  const shownDistricts = result.byDistrict.filter((row) => !row.suppressed && Number.isFinite(metricValue(row))).length;
  const omittedDistricts = Math.max(0, baseline.districts.length - shownDistricts);
  elements.mapNote.textContent = `Showing ${formatCount(shownDistricts)} districts with at least ${formatCount(baseline.meta.minRecords)} survey records; ${formatCount(omittedDistricts)} omitted.`;
  const legend = elements.map.parentElement.querySelector('.lp-map-legend');
  if (legend) {
    const labels = legend.querySelectorAll(':scope > span');
    if (labels.length >= 2) {
      labels[0].textContent = bounds ? (currentMetric === 'rwf' ? formatRwf(bounds.min) : toTonnes(bounds.min)) : 'Not available';
      labels[1].textContent = bounds ? (currentMetric === 'rwf' ? formatRwf(bounds.max) : toTonnes(bounds.max)) : 'Not available';
    }
    boundaryLayer.eachLayer((layer) => {
      const path = layer.getElement?.();
      if (path) path.style.pointerEvents = layer.options.interactive ? '' : 'none';
    });
  }
}

function installHatchPattern() {
  const svg = elements.map.querySelector('.leaflet-overlay-pane svg');
  if (!svg || svg.querySelector('#lp-insufficient-hatch')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<pattern id="lp-insufficient-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#D9DDD3"/><rect width="2" height="7" fill="#F4F6F1"/></pattern>';
  svg.prepend(defs);
}

async function ensureMap(result) {
  if (!window.L) return;
  if (!map) {
    map = window.L.map(elements.map, { zoomControl: true, attributionControl: false, minZoom: 7, maxZoom: 11 }).setView([-1.94, 29.87], 8);
    try {
      const geojson = await getJson('/api/rwanda-districts');
      const names = new Map(baseline.districts.map((district) => [normalizeDistrict(district.name), district]));
      boundaryLayer = window.L.geoJSON(geojson, {
        style: () => ({ color: '#fff', weight: 1, fillColor: '#D9DDD3', fillOpacity: .9 }),
        onEachFeature: (feature, layer) => {
          const rawName = feature.properties.__isukaDistrict || feature.properties.district || feature.properties.name;
          const district = names.get(normalizeDistrict(rawName));
          const code = district?.code || normalizeDistrict(rawName);
          feature.properties.__lpCode = code;
          layer.on({
            mouseover: () => { highlightMapDistrict(code, true); },
            mouseout: () => { highlightMapDistrict(code, false); },
            click: () => {
              const row = result.byDistrict.find((entry) => normalizeDistrict(entry.code) === normalizeDistrict(code));
              if (row && !row.suppressed) {
                openDistrict = row.code;
                const sortedIndex = [...result.byDistrict]
                  .filter((entry) => !entry.suppressed)
                  .sort((a, b) => (metricValue(b) ?? -1) - (metricValue(a) ?? -1))
                  .findIndex((entry) => entry.code === row.code);
                showEveryDistrict = false;
                districtPage = Math.floor(sortedIndex / districtsPerPage) + 1;
                renderDistrictList(result);
                updateMapStyles(result);
              }
            }
          });
          layer.bindTooltip('District data loading', { sticky: true });
        }
      }).addTo(map);
      installHatchPattern();
      requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(boundaryLayer.getBounds(), { padding: [8, 8] }); });
    } catch {
      elements.map.innerHTML = '<p class="lp-subtitle">District boundary map is not available. The ranked list remains available.</p>';
      return;
    }
  }
  updateMapStyles(result);
}

function highlightMapDistrict(code, active) {
  if (!boundaryLayer) return;
  boundaryLayer.eachLayer((layer) => {
    if (normalizeDistrict(layer.feature.properties.__lpCode) !== normalizeDistrict(code)) return;
    if (active) layer.setStyle({ weight: 2.4, color: '#1F2E17' });
    else updateMapStyles(scenarioResult);
  });
}

function renderMethod() {
  const excluded = formatCount(scenarioResult?.totals?.suppressedCount);
  elements.method.innerHTML = `<p><strong>Estimate:</strong> measured loss × selected reduction. RWF uses self-reported prices when available.</p><p><strong>Included:</strong> district–crop groups with at least ${escapeHtml(formatCount(baseline.meta.minRecords))} survey records. ${escapeHtml(excluded)} lower-count groups are omitted; missing or unconfirmed stage data is not estimated.</p><p><strong>Limits:</strong> coverage is the share of production with reported stage data, not a confidence level. NISR Seasonal Agricultural Survey · ${escapeHtml(currentPeriodText())} · ${escapeHtml(baseline.meta.calcVersion)}. Storage reporting is incomplete.</p>`;
}

function renderScenario() {
  if (!baseline || !state.cropCode) return;
  const stageIdsForScenario = selectedStageIds();
  scenarioResult = calculate(state.reductionPct);
  range20 = calculate(20);
  range40 = calculate(40);
  renderAnswer(scenarioResult);
  renderStages(scenarioResult);
  renderDistrictList(scenarioResult);
  ensureMap(scenarioResult);
  renderMethod();
  elements.example.hidden = liveLabel !== '';
}

function markChanged() {
  if (!liveLabel) liveLabel = 'changed';
  elements.example.hidden = true;
}

async function changePeriod() {
  state.years = elements.year.value;
  state.seasons = elements.season.value;
  selectedDistricts = 'all';
  districtPage = 1;
  showEveryDistrict = false;
  openDistrict = null;
  markChanged();
  updateUrl();
  await loadBaseline({ keepCrop: true });
}

function openDistrictPopover() {
  const opening = elements.popover.hidden;
  elements.popover.hidden = !opening;
  elements.districtTrigger.setAttribute('aria-expanded', String(opening));
  if (opening) {
    positionDistrictPopover();
    renderDistrictPicker();
    elements.districtSearch.focus();
  } else elements.districtTrigger.focus();
}

async function startOver() {
  selectedDistricts = 'all';
  state = { cropCode: null, years: 'all', seasons: 'all', districts: 'all', stage: 'all', reductionPct: 30 };
  liveLabel = '';
  openDistrict = null;
  try {
    const defaultState = await getJson('/api/loss-planner/default?years=all&seasons=all');
    state.years = String(defaultState.period?.year || 2025);
    state.seasons = defaultState.period?.season || 'C';
    state.cropCode = defaultState.cropCode;
    state.stage = uiStageId(defaultState.stageId) || 'all';
  } catch {
    state.years = '2025';
    state.seasons = 'C';
  }
  updateUrl();
  await loadBaseline({ keepCrop: true });
}

function downloadCsv() {
  if (!scenarioResult || !baseline) return;
  const periods = currentPeriodText();
  const crop = baseline.crops.find((item) => item.code === state.cropCode)?.name || 'Not available';
  const stage = stageGroups.find((item) => item.id === state.stage)?.label || 'All stages';
  const districts = selectedDistricts === 'all' ? 'All districts' : [...selectedDistricts].map(districtName).join('; ');
  const fields = [
    ['crop', crop], ['periods', periods], ['districts', districts], ['stage', stage], ['reduction_percent', `${state.reductionPct}%`],
    ['price_basis', formatMoneyLabel(scenarioResult)], ['exclusion_count', scenarioResult.totals.suppressedCount], ['calcVersion', baseline.meta.calcVersion],
    ['disclaimer', `What-if estimate based on NISR survey data (${periods}). Not a forecast or a guarantee.`]
  ];
  const headers = ['district', 'tonnes_saved', 'value_rwf', 'survey_records', 'coverage_percent'];
  const records = scenarioResult.byDistrict.map((row) => [districtName(row.code), toTonnes(row.recoveredKg), row.valueRwf === null ? 'Value not available' : formatRwf(row.valueRwf), row.suppressed ? 'Insufficient data' : formatCount(row.records), row.suppressed || !Number.isFinite(row.coveragePct) ? 'Insufficient data' : `${row.coveragePct.toFixed(1)}%`]);
  const csv = [...fields.map((row) => row.map(escapeCsv).join(',')), '', headers.map(escapeCsv).join(','), ...records.map((row) => row.map(escapeCsv).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'isuka-loss-recovery-scenario.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function wireEvents() {
  elements.year.addEventListener('change', changePeriod);
  elements.season.addEventListener('change', changePeriod);
  elements.crop.addEventListener('change', () => {
    state.cropCode = elements.crop.value;
    districtPage = 1;
    showEveryDistrict = false;
    renderStageOptions(calculate(0));
    markChanged();
    updateUrl();
    renderScenario();
  });
  elements.stage.addEventListener('change', () => { state.stage = elements.stage.value; districtPage = 1; showEveryDistrict = false; markChanged(); updateUrl(); renderScenario(); });
  elements.slider.addEventListener('input', () => {
    state.reductionPct = Number(elements.slider.value);
    elements.inlineReduction.textContent = `${state.reductionPct}%`;
    const position = `${state.reductionPct}%`;
    elements.slider.style.setProperty('--lp-thumb-position', position);
    elements.slider.parentElement.style.setProperty('--lp-thumb-position', position);
    elements.slider.setAttribute('aria-valuetext', `${state.reductionPct} percent`);
    markChanged();
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => { updateUrl(); renderScenario(); });
  });
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => {
    state.reductionPct = Number(button.dataset.preset);
    elements.slider.value = String(state.reductionPct);
    elements.slider.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  elements.districtTrigger.addEventListener('click', openDistrictPopover);
  elements.districtSearch.addEventListener('input', renderDistrictPicker);
  document.querySelector('[data-select-all]').addEventListener('click', () => {
    selectedDistricts = 'all'; districtPage = 1; showEveryDistrict = false; refreshDistrictButton(); renderDistrictPicker(); renderStageOptions(calculate(0)); renderScenario(); updateUrl(); markChanged();
  });
  document.querySelector('[data-clear-districts]').addEventListener('click', () => {
    selectedDistricts = new Set(); districtPage = 1; showEveryDistrict = false; refreshDistrictButton(); renderDistrictPicker(); renderStageOptions(calculate(0)); renderScenario(); updateUrl(); markChanged();
  });
  document.querySelector('[data-district-done]').addEventListener('click', openDistrictPopover);
  document.addEventListener('click', (event) => {
    if (!elements.popover.hidden && !elements.popover.contains(event.target) && !elements.districtTrigger.contains(event.target)) {
      elements.popover.hidden = true;
      elements.districtTrigger.setAttribute('aria-expanded', 'false');
      elements.districtTrigger.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.popover.hidden) {
      elements.popover.hidden = true;
      elements.districtTrigger.setAttribute('aria-expanded', 'false');
      elements.districtTrigger.focus();
    }
  });
  elements.reset.addEventListener('click', startOver);
  elements.stageTableToggle.addEventListener('click', () => {
    const open = elements.stageTableWrap.hidden;
    elements.stageTableWrap.hidden = !open;
    elements.stageTableToggle.textContent = open ? 'Hide table' : 'View as table';
    elements.stageTableToggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('[data-metric]').forEach((button) => button.addEventListener('click', () => {
    currentMetric = button.dataset.metric;
    districtPage = 1;
    showEveryDistrict = false;
    document.querySelectorAll('[data-metric]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderDistrictList(scenarioResult);
    updateMapStyles(scenarioResult);
  }));
  document.querySelector('[data-previous-page]').addEventListener('click', () => {
    districtPage = Math.max(1, districtPage - 1);
    renderDistrictList(scenarioResult);
  });
  document.querySelector('[data-next-page]').addEventListener('click', () => {
    districtPage += 1;
    renderDistrictList(scenarioResult);
  });
  elements.showAll.addEventListener('click', () => {
    showEveryDistrict = !showEveryDistrict;
    districtPage = 1;
    renderDistrictList(scenarioResult);
  });
  elements.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      elements.copy.querySelector('span').textContent = 'Copied';
      setTimeout(() => { elements.copy.querySelector('span').textContent = 'Copy link'; }, 1200);
    } catch {
      elements.stateNote.hidden = false;
      elements.stateNote.className = 'lp-state-note';
      elements.stateNote.textContent = 'Copy link is unavailable in this browser.';
    }
  });
  elements.download.addEventListener('click', downloadCsv);
}

async function init() {
  wireEvents();
  setupPinnedFilters();
  const query = new URLSearchParams(location.search);
  const hasUrlState = ['crop', 'years', 'seasons', 'districts', 'stage', 'pct'].some((key) => query.has(key));
  try {
    const defaultState = await getJson('/api/loss-planner/default?years=all&seasons=all');
    state.years = String(defaultState.period?.year || 2025);
    state.seasons = defaultState.period?.season || 'C';
    state.cropCode = defaultState.cropCode;
    state.stage = uiStageId(defaultState.stageId) || 'all';
    if (hasUrlState) {
      const parsed = parseScenarioState(location.search);
      const rawYears = Array.isArray(parsed.years) ? parsed.years : parsed.years;
      const rawSeasons = Array.isArray(parsed.seasons) ? parsed.seasons : parsed.seasons;
      state.years = Array.isArray(rawYears) ? (rawYears.length === 1 ? rawYears[0] : 'all') : rawYears;
      state.seasons = Array.isArray(rawSeasons) ? (rawSeasons.length === 1 ? rawSeasons[0] : 'all') : rawSeasons;
      state.cropCode = parsed.cropCode || state.cropCode;
      state.stage = parsed.stageIds[0] && parsed.stageIds[0] !== 'all' ? uiStageId(parsed.stageIds[0]) : 'all';
      state.reductionPct = parsed.reductionPct;
      selectedDistricts = parsed.districtCodes === 'all' ? 'all' : new Set(parsed.districtCodes);
      if ((Array.isArray(rawYears) && rawYears.length > 1) || (Array.isArray(rawSeasons) && rawSeasons.length > 1)) {
        elements.stateNote.hidden = false;
        elements.stateNote.className = 'lp-state-note';
        elements.stateNote.textContent = 'This page accepts one year and one season at a time; the shared link was adjusted to all periods.';
      }
    }
    const yearValid = state.years === 'all' || [...elements.year.options].some((option) => option.value === state.years);
    const seasonValid = state.seasons === 'all' || [...elements.season.options].some((option) => option.value === state.seasons);
    if (!yearValid || !seasonValid) {
      state.years = String(defaultState.period?.year || 2025);
      state.seasons = defaultState.period?.season || 'C';
      elements.stateNote.hidden = false;
      elements.stateNote.className = 'lp-state-note';
      elements.stateNote.textContent = 'Some values in this shared link were invalid; the default scenario was restored.';
    }
    if (state.stage !== 'all' && !stageGroups.some((group) => group.id === state.stage)) {
      state.stage = 'all';
      elements.stateNote.hidden = false;
      elements.stateNote.className = 'lp-state-note';
      elements.stateNote.textContent = 'The stage in this shared link was invalid; all recorded stages are selected.';
    }
    await loadBaseline({ keepCrop: true });
    if (selectedDistricts !== 'all') {
      const districtCodes = new Set(baseline.districts.map((district) => district.code));
      const requestedDistrictCount = selectedDistricts.size;
      selectedDistricts = new Set([...selectedDistricts].filter((code) => districtCodes.has(code)));
      if (selectedDistricts.size !== requestedDistrictCount) {
        elements.stateNote.hidden = false;
        elements.stateNote.className = 'lp-state-note';
        elements.stateNote.textContent = 'Some districts in this shared link were unavailable for these periods and were removed.';
      }
    }
  } catch (error) {
    setError(error);
  }
}

init();