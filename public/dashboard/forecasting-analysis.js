const years = Array.from({ length: 6 }, (_, index) => 2020 + index);
const library = document.getElementById('library-years');

function formatRows(value) {
  return Number.isFinite(value) ? `${value.toLocaleString()} cleaned rows` : 'Cleaned export';
}

function renderLibrary(metadata) {
  const periods = metadata?.supportedPeriods || [];
  library.innerHTML = years.map((year) => {
    const rows = periods.filter((period) => period.year === year).reduce((sum, period) => sum + (period.rows || 0), 0);
    return `<a class="library-card" href="/api/data-export/${year}" download><span class="library-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5z"/><path d="M14 3v6h5M8 15h8M8 18h6"/></svg></span><span><strong>${year}</strong><small>${formatRows(rows || null)}</small></span><span class="library-download" aria-hidden="true">&#8595;</span></a>`;
  }).join('');
}

function renderFallbackLibrary() {
  library.innerHTML = years.map((year) => `<a class="library-card" href="/api/data-export/${year}" download><span class="library-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5z"/><path d="M14 3v6h5M8 15h8M8 18h6"/></svg></span><span><strong>${year}</strong><small>Cleaned export</small></span><span class="library-download" aria-hidden="true">&#8595;</span></a>`).join('');
}

function revealCards() {
  const cards = [...document.querySelectorAll('[data-reveal]')];
  document.body.classList.add('reveal-ready');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    cards.forEach((card) => card.classList.add('is-visible'));
    return;
  }
  const revealInView = () => cards.forEach((card) => {
    const bounds = card.getBoundingClientRect();
    if (bounds.top < window.innerHeight && bounds.bottom > 0) card.classList.add('is-visible');
  });
  revealInView();
  window.addEventListener('scroll', revealInView, { passive: true });
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const index = cards.indexOf(entry.target);
    entry.target.style.transitionDelay = `${Math.min(index * 70, 350)}ms`;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  }), { threshold: 0.12 });
  cards.forEach((card) => observer.observe(card));
}

function displayPercent(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : 'Not available';
}

function renderForecastStatistics(cache) {
  const backtest = cache.backtest || {};
  const horizon = cache.horizon || {};
  const seasons = Array.isArray(horizon.seasons) ? horizon.seasons : [];
  const periodLabel = horizon.startYear === horizon.endYear && seasons.length === 1
    ? `${horizon.startYear}-${seasons[0]}`
    : 'the next supported period';
  const count = (cache.forecasts || []).length;
  const firstPeriod = (cache.forecasts || []).map((entry) => (entry.future || []).find((period) => period.year === horizon.startYear && period.season === seasons[0])).filter(Boolean);
  const clamped = firstPeriod.filter((period) => period.clamping?.applied).length;
  const lowConfidence = (cache.forecasts || []).filter((entry) => entry.lowConfidenceCapped).length;
  const seasonProduction = cache.featureImportances?.find((entry) => entry.target === 'production' && /season/i.test(entry.feature))?.importance;
  const seasonLoss = cache.featureImportances?.find((entry) => entry.target === 'loss' && /season/i.test(entry.feature))?.importance;
  const baselines = backtest.naiveBaselines || {};
  const commonTier = baselines.mostCommonRiskTier || {};
  const lastObserved = baselines.lastObservedLoss || {};

  document.querySelectorAll('[data-forecast-period], [data-forecast-period-inline]').forEach((element) => { element.textContent = periodLabel; });
  document.querySelector('[data-clamping-note]').textContent = `The ensemble is capped at each pair's historical maximum plus one standard deviation when it exceeds that limit. The cap applies to ${clamped.toLocaleString()} of ${count.toLocaleString()} ${periodLabel} estimates.`;
  document.querySelector('[data-backtest-tier-match]').textContent = displayPercent(backtest.riskTierMatchPercent, 4);
  document.querySelector('[data-backtest-loss-mae]').textContent = Number.isFinite(backtest.lossMaePercent) ? `${backtest.lossMaePercent.toFixed(4)} pp` : 'Not available';
  document.querySelector('[data-backtest-count]').textContent = Number.isFinite(backtest.predictionCount) ? backtest.predictionCount.toLocaleString() : 'Not available';
  document.querySelector('[data-backtest-holdout]').textContent = backtest.holdoutPeriods || 'Holdout';
  document.querySelector('[data-backtest-period]').textContent = `${backtest.predictionCount?.toLocaleString?.() || '—'} observations`;
  document.querySelector('[data-clamp-distribution]').textContent = `${(count - clamped).toLocaleString()} of ${count.toLocaleString()} ${periodLabel} estimates were not capped; ${clamped.toLocaleString()} required the cap.`;
  document.querySelector('[data-production-season-importance]').textContent = displayPercent(Number.isFinite(seasonProduction) ? seasonProduction * 100 : null, 4);
  document.querySelector('[data-loss-season-importance]').textContent = displayPercent(Number.isFinite(seasonLoss) ? seasonLoss * 100 : null, 4);
  document.querySelector('[data-low-confidence-count]').textContent = Number.isFinite(lowConfidence) ? lowConfidence.toLocaleString() : 'Not available';
  document.querySelector('[data-naive-baseline-note]').textContent = `On the ${backtest.holdoutPeriods || '2025 holdout'}, the ensemble matched ${displayPercent(backtest.riskTierMatchPercent, 2)} of risk tiers with ${Number.isFinite(backtest.lossMaePercent) ? `${backtest.lossMaePercent.toFixed(2)} pp` : 'Not available'} loss MAE; the most-common-tier baseline matched ${displayPercent(commonTier.tierMatchPercent, 2)} with ${Number.isFinite(commonTier.lossMaePercent) ? `${commonTier.lossMaePercent.toFixed(2)} pp` : 'Not available'} MAE, and the last-observed baseline matched ${displayPercent(lastObserved.tierMatchPercent, 2)} with ${Number.isFinite(lastObserved.lossMaePercent) ? `${lastObserved.lossMaePercent.toFixed(2)} pp` : 'Not available'} MAE.`;
}

document.querySelector('.collapse-toggle')?.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('collapsed'));
revealCards();
fetch('/api/metadata').then((response) => response.ok ? response.json() : Promise.reject(new Error('Metadata unavailable'))).then(renderLibrary).catch(renderFallbackLibrary);
fetch('/api/forecast?model=ensemble').then((response) => response.ok ? response.json() : Promise.reject(new Error('Forecast statistics unavailable'))).then(renderForecastStatistics).catch(() => {});
