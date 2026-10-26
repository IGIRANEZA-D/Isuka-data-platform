const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { repositoryRoot } = require('./dataset-config');

const forecastCachePath = path.join(repositoryRoot, 'backend', 'data', 'forecast-cache.json');

function loadForecastCache() {
  if (!fs.existsSync(forecastCachePath)) return null;
  return JSON.parse(fs.readFileSync(forecastCachePath, 'utf8'));
}

function getForecastSlice(cache, districtCode = 'all', cropCode = 'all', model = 'ensemble') {
  if (!cache) throw new Error('Forecast cache is not available. Run scripts/forecasting_pipeline.py first.');
  const selectedModel = ['statistical', 'ml', 'ensemble'].includes(model) ? model : 'ensemble';
  const forecasts = (cache.forecasts || []).filter((entry) =>
    (districtCode === 'all' || entry.districtCode === districtCode)
    && (cropCode === 'all' || entry.cropCode === cropCode)
  ).map((entry) => ({
    ...entry,
    model: selectedModel,
    productionKg: entry.models?.[selectedModel]?.productionKg ?? null,
    lossPercent: entry.models?.[selectedModel]?.lossPercent ?? null,
    confidenceBand: entry.models?.[selectedModel]?.confidenceBand || null,
    riskTier: entry.models?.[selectedModel]?.riskTier || null,
    future: (entry.future || []).map((period) => ({
      year: period.year,
      season: period.season,
      clamping: period.clamping || null,
      ...period.models?.[selectedModel]
    }))
  }));
  return {
    generatedAt: cache.generatedAt,
    horizon: cache.horizon,
    model: selectedModel,
    modelAvailable: cache.modelAvailable === true,
    forecasts,
    backtest: cache.backtest || null,
    featureImportances: cache.featureImportances || [],
    availableDistricts: cache.availableDistricts || [],
    availableCrops: cache.availableCrops || []
  };
}

function getForecastDownloadRows(cache, year = 'all', model = 'ensemble') {
  if (!cache) throw new Error('Forecast cache is not available.');
  const selectedModel = ['statistical', 'ml', 'ensemble'].includes(model) ? model : 'ensemble';
  return (cache.forecasts || []).flatMap((entry) => (entry.future || [])
    .filter((period) => year === 'all' || period.year === Number(year))
    .map((period) => {
      const values = period.models?.[selectedModel] || {};
      return {
        year: period.year,
        season: period.season,
        districtCode: entry.districtCode,
        cropCode: entry.cropCode,
        cropName: entry.cropName,
        yearsAvailable: entry.yearsAvailable,
        productionKg: values.productionKg ?? null,
        lossPercent: values.lossPercent ?? null,
        riskTier: values.riskTier ?? null,
        confidenceLowKg: values.confidenceBand?.productionKg?.[0] ?? null,
        confidenceHighKg: values.confidenceBand?.productionKg?.[1] ?? null
      };
    }));
}

let forecastRefreshPromise;

function refreshForecastCache({ apiUrl } = {}) {
  if (forecastRefreshPromise) return forecastRefreshPromise;
  const scriptPath = path.join(repositoryRoot, 'scripts', 'forecasting_pipeline.py');
  forecastRefreshPromise = new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [scriptPath], {
      env: { ...process.env, ...(apiUrl ? { ISUKA_API_URL: apiUrl } : {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ status: 'completed', output: output.trim() });
      else reject(new Error(errorOutput.trim() || `Forecast pipeline exited with code ${code}.`));
    });
  }).finally(() => { forecastRefreshPromise = undefined; });
  return forecastRefreshPromise;
}

module.exports = { forecastCachePath, loadForecastCache, getForecastSlice, getForecastDownloadRows, refreshForecastCache };
