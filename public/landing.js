const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-navigation');

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  navigation?.classList.toggle('is-open', isOpen);
});

navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', 'Open navigation');
  navigation.classList.remove('is-open');
}));

const heroEnding = document.querySelector('[data-hero-ending]');
const heroMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
if (heroEnding && !heroMotionPreference.matches) {
  const heroPhrases = [
    'Know where the harvest goes.',
    'See what Rwanda grows.',
    'Track how seasons shift.',
    'Plan for better harvests.'
  ];
  const typeDelay = 88;
  const eraseDelay = 14;
  const pause = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
  const writeText = async (element, value, delay) => {
    for (const character of Array.from(value)) {
      element.textContent += character;
      await pause(delay);
    }
  };
  const eraseText = async (element, delay) => {
    const characters = Array.from(element.textContent);
    while (characters.length) {
      characters.pop();
      element.textContent = characters.join('');
      await pause(delay);
    }
  };
  const cycleHeroLines = async () => {
    let lineIndex = 0;
    while (true) {
      await pause(2400);
      await eraseText(heroEnding, eraseDelay);
      await pause(100);
      lineIndex = (lineIndex + 1) % heroPhrases.length;
      heroEnding.textContent = '';
      await writeText(heroEnding, heroPhrases[lineIndex], typeDelay);
    }
  };
  cycleHeroLines();
}

const revealTargets = document.querySelectorAll('[data-reveal]:not(.journey)');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('has-scroll-reveal');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  revealTargets.forEach((target) => revealObserver.observe(target));
}
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const journeyObserver = new IntersectionObserver((entries, observer) => { entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  const journey = document.querySelector('.journey');
  if (journey) journeyObserver.observe(journey);
}

const heroMap = document.querySelector('[data-hero-map]');
const heroDistrictLayer = document.querySelector('[data-hero-districts]');
const heroTerrain = document.querySelector('[data-hero-terrain]');
const heroLabels = document.querySelector('[data-hero-labels]');
const heroStatus = document.querySelector('[data-hero-status]');
const heroRetry = document.querySelector('[data-hero-retry]');
const districtSelection = document.querySelector('[data-district-selection]');
const lossTiles = document.querySelector('[data-loss-tiles]');
const lossStatus = document.querySelector('[data-loss-status]');
const lossYear = document.querySelector('[data-loss-year]');
const lossYearValue = document.querySelector('[data-loss-year-value]');
const lossYearSelect = document.querySelector('[data-loss-year-select]');
const lossSeasonButtons = [...document.querySelectorAll('[data-loss-season]')];
const lossTableToggle = document.querySelector('[data-loss-table-toggle]');
const lossTableWrap = document.querySelector('[data-loss-table-wrap]');
const lossTableBody = document.querySelector('[data-loss-table-body]');
const lossPlay = document.querySelector('[data-loss-play]');
let landingSummary = null;
let landingArt = null;
let selectedLossSeason = 'all';
let lossPlayTimer = null;
if (navigator.connection?.saveData) document.documentElement.dataset.saveData = 'true';

function collectCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') { output.push(value); return output; }
  value.forEach((item) => collectCoordinates(item, output));
  return output;
}

function polygonPath(geometry, project) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) => polygon.map((ring) => {
    const points = ring.map(project);
    return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z';
  }).join(' ')).join(' ');
}

function featureName(feature) { return feature.name || feature.properties?.district || feature.properties?.name || 'District'; }
function featureCode(feature) { return String(feature.code ?? feature.properties?.code_dist ?? ''); }
function normalizeDistrictCode(value) { return String(value ?? '').trim().toLowerCase(); }
function currentLossView() {
  const year = String(lossYear?.value || landingSummary?.latest?.year || '2025');
  return landingSummary?.periods?.[`${year}-${selectedLossSeason}`] || null;
}
function formatLoss(value) { return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Unavailable'; }
function formatArea(value) { return Number.isFinite(value) ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)} ha` : 'Unavailable'; }
function districtExplorerUrl() { return '/dashboard/district-explorer/'; }
function setSelection(name, value, year, rank) {
  if (districtSelection) districtSelection.textContent = `${name} \u00b7 ${formatLoss(value)} recorded loss \u00b7 ${year} \u00b7 ${Number.isFinite(rank) ? `rank ${rank} of 30` : 'rank unavailable'}. Open the District Explorer to inspect this district.`;
}
function appendSvg(parent, tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  parent.append(element);
  return element;
}
function artProject([x, y]) {
  const map = landingArt?.viewBox?.map || { left: 500, top: 120, width: 555, height: 560 };
  return [map.left + x * map.width, map.top + y * map.height];
}
function createHeroLabel(parent, district, point) {
  const rank = district.productionRank;
  const chipPositions = window.matchMedia('(max-width: 560px)').matches
    ? [[270, 45], [780, 75], [520, 600], [320, 618], [945, 658]]
    : [[324, 52], [1012, 82], [1010, 272], [320, 618], [945, 658]];
  const [x, y] = chipPositions[rank - 1];
  const group = appendSvg(parent, 'g', { class: 'hero-production-chip', transform: `translate(${x} ${y})`, style: `--chip-order:${rank}` });
  appendSvg(group, 'path', { class: 'hero-leader', d: `M${x < 600 ? 178 : 0} 17 L${point[0] - x} ${point[1] - y}` });
  appendSvg(group, 'circle', { class: 'hero-leader-dot', cx: point[0] - x, cy: point[1] - y, r: 5 });
  appendSvg(group, 'rect', { x: 0, y: 0, width: 218, height: 42, rx: 4 });
  const text = appendSvg(group, 'text', { x: 10, y: 16, class: 'hero-production-chip-name' });
  text.textContent = district.name;
  const detail = appendSvg(group, 'text', { x: 10, y: 32, class: 'hero-production-chip-detail' });
  detail.textContent = `${district.primaryCrop || 'Leading crop unavailable'} leads · ${formatProduction(district.productionKg)} total`;
}
function renderHeroMap(view) {
  if (!heroMap || !heroDistrictLayer || !landingArt) return;
  heroMap.classList.remove('is-ready');
  heroDistrictLayer.replaceChildren();
  heroLabels?.replaceChildren();
  heroTerrain?.replaceChildren();
  landingArt.terrainLayers.forEach((layer, depth) => {
    const group = appendSvg(heroTerrain, 'g', { class: `terrain-depth terrain-depth-${depth}`, style: `--terrain-depth:${depth}` });
    layer.paths.forEach(({ d }) => appendSvg(group, 'path', { d }));
  });
  const byCode = new Map((view?.districts || []).map((district) => [normalizeDistrictCode(district.code), district]));
  const topFive = [...byCode.values()].filter((district) => Number.isFinite(district.productionKg)).sort((a, b) => b.productionKg - a.productionKg).slice(0, 5);
  topFive.forEach((district, index) => { district.productionRank = index + 1; });
  const topCodes = new Set(topFive.map((district) => normalizeDistrictCode(district.code)));
  const productionValues = [...byCode.values()].map((district) => district.productionKg).filter(Number.isFinite);
  const minProduction = productionValues.length ? Math.min(...productionValues) : null;
  const maxProduction = productionValues.length ? Math.max(...productionValues) : null;
  const districts = [...landingArt.districts].sort((a, b) => a.centroid[0] - b.centroid[0]);
  districts.forEach((district, index) => {
    const code = normalizeDistrictCode(district.code);
    const result = byCode.get(code);
    const point = artProject(district.labelPoint);
    const group = appendSvg(heroDistrictLayer, 'g', { class: 'hero-district-point', style: `--dot-order:${index}` });
    const shape = appendSvg(group, 'path', { class: 'hero-district-shape', d: district.path, tabindex: view ? index + 1 : -1, role: 'link' });
    if (result && minProduction !== null) shape.style.setProperty('--district-fill', heroProductionFill(result.productionKg, minProduction, maxProduction));
    if (!view) return;
    const isTopProducer = topCodes.has(code);
    if (isTopProducer) group.classList.add('has-gold-dot');
    if (isTopProducer) appendSvg(group, 'circle', { class: 'hero-gold-ripple', cx: point[0], cy: point[1], r: 8, 'aria-hidden': 'true' });
    appendSvg(group, 'circle', { class: `hero-district-dot${isTopProducer ? ' is-gold' : ''}`, cx: point[0], cy: point[1], r: isTopProducer ? 8 : 6.5, 'aria-hidden': 'true' });
    const aria = `${district.name} · leading crop ${result?.primaryCrop || 'unavailable'} · district output ${formatProduction(result?.productionKg)} · weighted area ${formatArea(result?.areaHa)} · ${view?.year ?? 'latest'}`;
    shape.setAttribute('aria-label', aria);
    shape.setAttribute('data-tooltip', aria);
    appendSvg(group, 'title').textContent = aria;
    const showDistrict = () => {
      const detail = `${district.name} · Leading crop: ${result?.primaryCrop || 'unavailable'} · District output: ${formatProduction(result?.productionKg)} · Weighted area: ${formatArea(result?.areaHa)} · ${view?.year ?? 'latest'}`;
      group.classList.add('is-active');
      if (heroStatus) { heroStatus.textContent = detail; heroStatus.hidden = false; heroStatus.dataset.active = 'true'; }
    };
    const hideDistrict = () => {
      group.classList.remove('is-active');
      if (heroStatus) { heroStatus.hidden = true; delete heroStatus.dataset.active; }
    };
    group.addEventListener('pointerenter', showDistrict);
    group.addEventListener('pointerleave', hideDistrict);
    shape.addEventListener('focus', showDistrict);
    group.addEventListener('focusout', (event) => { if (!group.contains(event.relatedTarget)) hideDistrict(); });
    shape.addEventListener('click', () => { window.location.href = districtExplorerUrl(); });
    shape.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.location.href = districtExplorerUrl(); } });
  });
  topFive.forEach((district) => {
    const artDistrict = landingArt.districts.find((item) => normalizeDistrictCode(item.code) === normalizeDistrictCode(district.code));
    if (artDistrict) createHeroLabel(heroLabels, district, artProject(artDistrict.labelPoint));
  });
  const caption = document.querySelector('[data-hero-caption]');
  if (caption) caption.textContent = `Weighted crop production, ${view?.year ?? 'latest available year'}.`;
  window.requestAnimationFrame(() => heroMap.classList.add('is-ready'));
}
function hexPath(cx, cy, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index - 30) * Math.PI / 180;
    return `${index ? 'L' : 'M'}${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(' ') + 'Z';
}
function lossFill(value, minimum, maximum) {
  if (!Number.isFinite(value)) return '#dfe7d8';
  const t = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const pale = '#E3EFD3', green = '#6FA83C', gold = '#C08A3E';
  return t < 0.72
    ? `color-mix(in oklab, ${pale} ${(1 - t / 0.72) * 100}%, ${green} ${t / 0.72 * 100}%)`
    : `color-mix(in oklab, ${green} ${((1 - t) / 0.28) * 100}%, ${gold} ${((t - 0.72) / 0.28 * 100)}%)`;
}
function heroProductionFill(value, minimum, maximum) {
  if (!Number.isFinite(value)) return '#dfe7d8';
  const t = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return `color-mix(in srgb, #E3EFD3 ${(1 - t) * 100}%, #315C2A ${t * 100}%)`;
}
function renderLossTiles(view) {
  if (!lossTiles || !landingArt) return;
  if (!view) {
    lossTiles.replaceChildren();
    ['[data-loss-national]', '[data-loss-highest]', '[data-loss-records]', '[data-loss-range]'].forEach((selector) => { const node = document.querySelector(selector); if (node) node.textContent = 'Unavailable'; });
    if (lossStatus) lossStatus.textContent = 'No survey records are available for this year and season.';
    return;
  }
  lossTiles.replaceChildren();
  const records = new Map(view.districts.map((district) => [normalizeDistrictCode(district.code), district]));
  const valid = view.districts.map((district) => district.lossPercent).filter(Number.isFinite);
  const min = valid.length ? Math.min(...valid) : null, max = valid.length ? Math.max(...valid) : null;
  const districts = [...landingArt.districts].sort((a, b) => a.hex.x - b.hex.x || a.hex.y - b.hex.y);
  districts.forEach((artDistrict, index) => {
    const record = records.get(normalizeDistrictCode(artDistrict.code));
    const name = record?.name || artDistrict.name;
    const value = record?.lossPercent;
    const point = { x: 76 + artDistrict.hex.x * 560, y: 36 + artDistrict.hex.y * 440 };
    const group = appendSvg(lossTiles, 'g', { class: 'loss-tile', transform: `translate(${point.x} ${point.y})`, tabindex: index + 1, role: 'link', style: `--tile-order:${index}` });
    const label = `${name} \u00b7 ${formatLoss(value)} \u00b7 rank ${record?.rank ?? 'unavailable'} of 30`;
    group.setAttribute('aria-label', label);
    group.setAttribute('data-tooltip', label);
    appendSvg(group, 'path', { class: 'loss-tile-shape', d: hexPath(0, 0, 43), fill: lossFill(value, min, max), 'aria-hidden': 'true' });
    appendSvg(group, 'title').textContent = label;
    appendSvg(group, 'text', { class: 'loss-tile-value', x: 0, y: 4, 'text-anchor': 'middle', 'aria-hidden': 'true' }).textContent = Number.isFinite(value) ? formatLoss(value) : '\u2014';
    const open = () => { window.location.href = districtExplorerUrl(); };
    group.addEventListener('click', open);
    group.addEventListener('mouseenter', () => setSelection(name, value, view.year, record?.rank));
    group.addEventListener('mouseleave', () => { if (districtSelection) districtSelection.textContent = 'Hover over or focus a district tile to read its loss rate and rank.'; });
    group.addEventListener('focus', () => setSelection(name, value, view.year, record?.rank));
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  if (districtSelection) districtSelection.textContent = 'Hover over or focus a district tile to read its loss rate and rank.';
  const range = document.querySelector('[data-loss-range]');
  if (range) range.textContent = min === null ? 'No figures available' : `${formatLoss(min)} \u2014 ${formatLoss(max)}`;
  const national = document.querySelector('[data-loss-national]');
  const highest = document.querySelector('[data-loss-highest]');
  const recordCount = document.querySelector('[data-loss-records]');
  if (national) national.textContent = formatLoss(view.nationalLossPercent);
  const top = view.districts.find((district) => district.rank === 1);
  if (highest) highest.textContent = top ? `${top.name} \u00b7 ${formatLoss(top.lossPercent)}` : 'Unavailable';
  if (recordCount) recordCount.textContent = Number.isFinite(view.recordCount) ? new Intl.NumberFormat().format(view.recordCount) : 'Unavailable';
  if (lossStatus) lossStatus.textContent = `Survey records \u00b7 ${view.year === 'all' ? 'all years' : view.year} \u00b7 ${view.season === 'all' ? 'all seasons' : `Season ${view.season}`}`;
  if (lossTableBody) {
    lossTableBody.replaceChildren(...view.districts.map((district) => {
      const row = document.createElement('tr');
      [district.name, formatLoss(district.lossPercent), district.rank ?? 'Unavailable'].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
      return row;
    }));
  }
}
function renderSelectedLossPeriod() {
  if (!landingSummary || !landingArt || !lossYear) return;
  const available = landingSummary.meta.years.map(String);
  const selected = available.includes(lossYear.value) ? lossYear.value : String(landingSummary.latest.year);
  lossYear.value = selected;
  if (lossYearSelect) lossYearSelect.value = selected;
  if (lossYearValue) lossYearValue.value = selected;
  const view = currentLossView();
  renderLossTiles(view);
}
function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // Revalidate cached summaries so a browser cannot keep using the old
      // loss-only payload after the landing summary adds production values.
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Request returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(350 * (2 ** attempt));
    }
  }
  throw lastError;
}
async function loadLandingVisuals() {
  if (!heroMap && !lossTiles) return;
  let loadingStage = 'district map data';
  [heroRetry].filter(Boolean).forEach((button) => { button.hidden = true; });
  if (heroStatus) heroStatus.textContent = 'Loading district production...';
  if (lossStatus) lossStatus.textContent = 'Loading recorded district losses...';
  try {
    landingArt = await fetchJsonWithRetry('/data/landing-art.json');
    renderHeroMap(null);
    landingSummary = await fetchJsonWithRetry('/api/landing/summary');
    if (!landingSummary.production?.districts?.some((district) => Number.isFinite(district.productionKg))) {
      throw new Error('The production summary contains no usable district values.');
    }
    // Paint the live production layer before updating the loss chart so an issue
    // in the separate chart cannot leave the hero stuck on its empty map.
    renderHeroMap(landingSummary.production);
    if (heroStatus) heroStatus.hidden = true;
    loadingStage = 'loss explorer';
    lossYear.min = String(landingSummary.meta.years[0]);
    lossYear.max = String(landingSummary.meta.years.at(-1));
    lossYear.value = String(landingSummary.latest.year);
    if (lossYearSelect) lossYearSelect.replaceChildren(...landingSummary.meta.years.map((year) => new Option(String(year), String(year))));
    if (lossYearSelect) lossYearSelect.value = String(landingSummary.latest.year);
    lossPlay.disabled = window.matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true;
    renderSelectedLossPeriod();
    if (heroStatus) heroStatus.hidden = true;
    if (lossStatus) lossStatus.dataset.ready = 'true';
    document.documentElement.dataset.landingDataReady = 'true';
  } catch (error) {
    console.error(`Landing ${loadingStage} failed to load:`, error);
    if (loadingStage === 'district map data') {
      if (heroStatus) { heroStatus.textContent = 'District production is temporarily unavailable.'; heroStatus.hidden = false; }
      if (heroRetry) heroRetry.hidden = false;
    }
    if (lossStatus) lossStatus.textContent = 'Live loss figures are temporarily unavailable.';
    ['[data-loss-national]', '[data-loss-highest]', '[data-loss-records]'].forEach((selector) => { const node = document.querySelector(selector); if (node) node.textContent = '\u2014'; });
    document.documentElement.dataset.landingDataReady = 'error';
  }
}
heroRetry?.addEventListener('click', loadLandingVisuals);
lossYear?.addEventListener('input', renderSelectedLossPeriod);
lossYearSelect?.addEventListener('change', () => { if (lossYear) lossYear.value = lossYearSelect.value; renderSelectedLossPeriod(); });
lossSeasonButtons.forEach((button) => button.addEventListener('click', () => {
  selectedLossSeason = button.dataset.lossSeason;
  lossSeasonButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  renderSelectedLossPeriod();
}));
lossTableToggle?.addEventListener('click', () => {
  const isOpen = lossTableToggle.getAttribute('aria-expanded') === 'true';
  lossTableToggle.setAttribute('aria-expanded', String(!isOpen));
  lossTableWrap.hidden = isOpen;
  lossTableToggle.textContent = isOpen ? 'View as table' : 'Hide table';
});
lossPlay?.addEventListener('click', () => {
  if (lossPlayTimer) { window.clearInterval(lossPlayTimer); lossPlayTimer = null; lossPlay.textContent = 'Play years'; return; }
  lossPlay.textContent = 'Pause';
  lossPlayTimer = window.setInterval(() => {
    const next = Number(lossYear.value) + 1;
    if (next > Number(lossYear.max)) { window.clearInterval(lossPlayTimer); lossPlayTimer = null; lossPlay.textContent = 'Play years'; return; }
    lossYear.value = String(next);
    renderSelectedLossPeriod();
  }, 1200);
});

const yearSelect = document.querySelector('[data-year-select]');
const seasonSelect = document.querySelector('[data-season-select]');
const districtSelect = document.querySelector('[data-district-select]');
const resetFiltersButton = document.querySelector('[data-reset-filters]');
const periodLabel = document.querySelector('[data-period-label]');
const cropChart = document.querySelector('[data-crop-chart]');
const snapshot = document.querySelector('[data-snapshot]');
let overviewRequestSequence = 0;

function setText(selector, value) {
  const target = document.querySelector(selector);
  if (target) target.textContent = value;
}

function replaceFilterOptions(select, values, allLabel, labelForValue = String) {
  if (!select) return;
  const selectedValue = select.value;
  const options = [new Option(allLabel, 'all'), ...values.map((value) => new Option(labelForValue(value), String(value)))];
  select.replaceChildren(...options);
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : 'all';
}

function displayDistrict(value) {
  return String(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function selectedFilterSummary() {
  const values = [
    yearSelect?.value === 'all' ? 'All years' : yearSelect?.value,
    seasonSelect?.value === 'all' ? 'All seasons' : `Season ${seasonSelect?.value}`,
    districtSelect?.value === 'all' ? 'All districts' : displayDistrict(districtSelect?.value || '')
  ];
  return values.filter(Boolean).join(' · ');
}

function updateResetButton() {
  if (!resetFiltersButton) return;
  const isDefaultView = yearSelect?.value === 'all'
    && seasonSelect?.value === 'all'
    && districtSelect?.value === 'all';
  resetFiltersButton.disabled = isDefaultView;
}

function renderCropSkeleton() {
  cropChart.replaceChildren();
  Array.from({ length: 5 }, (_, index) => {
    const row = document.createElement('div');
    row.className = 'crop-skeleton';
    row.style.setProperty('--skeleton-delay', `${index * 55}ms`);
    ['span', 'i', 'b'].forEach((tag) => row.append(document.createElement(tag)));
    cropChart.append(row);
  });
}

function formatProduction(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B kg`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M kg`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K kg`;
  return `${Math.round(value)} kg`;
}

function renderCropChart(crops) {
  cropChart.replaceChildren();
  const validCrops = crops.filter((crop) => Number.isFinite(crop.productionKg)).slice(0, 5);
  if (!validCrops.length) {
    const message = document.createElement('p');
    message.className = 'chart-message';
    message.textContent = 'No production records are available for this selection.';
    cropChart.append(message);
    return;
  }
  const maximum = Math.max(...validCrops.map((crop) => crop.productionKg), 1);
  validCrops.forEach((crop) => {
    const row = document.createElement('div');
    row.className = 'crop-row';
    row.style.setProperty('--row-delay', `${cropChart.children.length * 55}ms`);
    const name = document.createElement('span');
    name.className = 'crop-name';
    name.textContent = crop.crop;
    const track = document.createElement('span');
    track.className = 'crop-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.className = 'crop-bar';
    bar.style.setProperty('--bar-width', `${Math.max(2, crop.productionKg / maximum * 100)}%`);
    track.append(bar);
    const value = document.createElement('span');
    value.className = 'crop-value';
    value.textContent = formatProduction(crop.productionKg);
    row.append(name, track, value);
    cropChart.append(row);
  });
}

async function loadOverview() {
  if (!cropChart || !yearSelect || !seasonSelect || !districtSelect) return;
  const requestSequence = ++overviewRequestSequence;
  const selectedYear = yearSelect.value;
  const selectedSeason = seasonSelect.value;
  const selectedDistrict = districtSelect.value;
  const selectedDistrictLabel = selectedDistrict === 'all' ? 'All districts' : displayDistrict(selectedDistrict);
  const pendingLabel = `Updating · ${selectedFilterSummary()}`;
  updateResetButton();
  snapshot?.classList.add('is-loading');
  snapshot?.setAttribute('aria-busy', 'true');
  document.querySelector('.signal-board')?.classList.add('is-loading');
  document.querySelector('.evidence-ledger')?.classList.add('is-loading');
  periodLabel.textContent = pendingLabel;
  setText('[data-signal-period]', pendingLabel);
  setText('[data-signal-place]', selectedDistrict === 'all' ? 'Rwanda' : selectedDistrictLabel);
  setText('[data-signal-scope]', selectedDistrict === 'all' ? 'Countrywide view' : 'Selected district view');
  setText('[data-signal-production]', '—');
  setText('[data-signal-districts]', '—');
  setText('[data-signal-crop]', '—');
  setText('[data-signal-crop-production]', 'Updating selected records');
  setText('[data-evidence-period]', pendingLabel);
  setText('[data-evidence-districts]', 'Updating selected view');
  setText('[data-snapshot-description]', `Updating · ${selectedFilterSummary()}`);
  renderCropSkeleton();
  try {
    const params = new URLSearchParams({ year: selectedYear, district: selectedDistrict, season: selectedSeason });
    const response = await fetch(`/api/overview?${params}`);
    if (!response.ok) throw new Error('Overview data are unavailable.');
    const data = await response.json();
    if (requestSequence !== overviewRequestSequence) return;
    const years = [...(data.filters?.availableYears || [])].sort((first, second) => first - second);
    const seasons = data.filters?.availableSeasons || [];
    const districts = data.filters?.availableDistricts || [];
    replaceFilterOptions(yearSelect, years, 'All years');
    replaceFilterOptions(seasonSelect, seasons, 'All seasons', (season) => `Season ${season}`);
    replaceFilterOptions(districtSelect, districts, 'All districts', displayDistrict);
    updateResetButton();
    const periodText = data.period ? `${data.period.year} · ${data.period.season} · ${selectedDistrictLabel}` : 'Available survey period';
    const leadingCrop = data.productionByCrop?.[0];
    periodLabel.textContent = periodText;
    setText('[data-signal-period]', periodText);
    setText('[data-signal-place]', districtSelect.value === 'all' ? 'Rwanda' : selectedDistrictLabel);
    setText('[data-signal-scope]', districtSelect.value === 'all' ? 'Countrywide view' : 'Selected district view');
    setText('[data-signal-production]', formatProduction(data.kpis?.weightedProductionKg));
    setText('[data-signal-districts]', Number.isFinite(data.kpis?.districtCount) ? String(data.kpis.districtCount) : 'Unavailable');
    setText('[data-signal-crop]', leadingCrop?.crop || 'Unavailable');
    setText('[data-signal-crop-production]', leadingCrop ? `${formatProduction(leadingCrop.productionKg)} weighted production` : 'No crop records for this period');
    setText('[data-evidence-period]', periodText);
    setText('[data-evidence-years]', years.length ? `${years[0]}–${years.at(-1)}` : 'Unavailable');
    setText('[data-evidence-districts]', Number.isFinite(data.kpis?.districtCount) ? `${data.kpis.districtCount} in this view` : 'Unavailable');
    setText('[data-snapshot-description]', `Weighted production · ${selectedFilterSummary()}`);
    renderCropChart(data.productionByCrop || []);
    snapshot?.classList.remove('is-loading');
    snapshot?.setAttribute('aria-busy', 'false');
    document.querySelector('.signal-board')?.classList.remove('is-loading');
    document.querySelector('.evidence-ledger')?.classList.remove('is-loading');
  } catch {
    if (requestSequence !== overviewRequestSequence) return;
    periodLabel.textContent = 'Published data status';
    ['[data-signal-period]', '[data-signal-production]', '[data-signal-districts]', '[data-signal-crop]', '[data-signal-crop-production]', '[data-evidence-period]', '[data-evidence-years]', '[data-evidence-districts]'].forEach((selector) => setText(selector, 'Unavailable'));
    const message = document.createElement('p');
    message.className = 'chart-message';
    message.textContent = 'No published records are available for this selection. Change a filter or open the full Data Hub.';
    cropChart.replaceChildren(message);
    snapshot?.classList.remove('is-loading');
    snapshot?.setAttribute('aria-busy', 'false');
    document.querySelector('.signal-board')?.classList.remove('is-loading');
    document.querySelector('.evidence-ledger')?.classList.remove('is-loading');
    updateResetButton();
  }
}

yearSelect?.addEventListener('change', loadOverview);
seasonSelect?.addEventListener('change', loadOverview);
districtSelect?.addEventListener('change', loadOverview);
resetFiltersButton?.addEventListener('click', () => {
  yearSelect.value = 'all';
  seasonSelect.value = 'all';
  districtSelect.value = 'all';
  loadOverview();
});
loadLandingVisuals();
loadOverview();
