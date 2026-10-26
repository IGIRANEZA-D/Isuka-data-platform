const { findRwandaDistrict } = require('./rwanda-locations');

const weatherCache = new Map();
const maxWeatherCacheEntries = 256;
const cacheTtlMs = { current: 15 * 60 * 1000, forecast: 3 * 60 * 60 * 1000 };
const weatherCodes = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail' };
const thresholds = { temperature: { heatStress: 32, coldStress: 10 }, rainfall: { heavyRain24h: 20, drought7d: 5 }, wind: { strongKmh: 50 } };

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Latitude must be between -90 and 90 and longitude between -180 and 180.');
  return { latitude: lat, longitude: lon };
}

function cacheKey(latitude, longitude) { return `${latitude.toFixed(4)},${longitude.toFixed(4)}`; }

async function fetchOpenMeteo(latitude, longitude) {
  const params = new URLSearchParams({
    latitude, longitude, timezone: 'auto', forecast_days: 7,
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,uv_index',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index,et0_fao_evapotranspiration,soil_temperature_6cm,soil_moisture_3_to_9cm',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunshine_duration,et0_fao_evapotranspiration'
  });
  const response = await fetch(`${process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1/forecast'}?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}.`);
  return response.json();
}

function interpretWeather(weather) {
  const current = weather.current || {};
  const daily = weather.daily || {};
  const rain24h = Number(daily.precipitation_sum?.[0] ?? current.precipitation ?? 0);
  const temperature = Number(current.temperature_2m);
  const windKmh = Number(current.wind_speed_10m);
  const rainRisk = rain24h >= thresholds.rainfall.heavyRain24h ? 'high' : rain24h > 5 ? 'moderate' : 'low';
  const alerts = [];
  if (rainRisk !== 'low') alerts.push({ type: 'heavy_rain', severity: rainRisk, title: 'Rainfall risk', message: `${rain24h.toFixed(1)} mm of precipitation is forecast for the next daily period.`, recommendation: 'Consider drainage and postpone field work if the ground is saturated.' });
  if (temperature >= thresholds.temperature.heatStress) alerts.push({ type: 'heat', severity: 'moderate', title: 'Heat stress watch', message: 'Current temperature is above the configurable general heat threshold.', recommendation: 'Provide shade and water; crop-specific thresholds must be validated.' });
  if (windKmh >= thresholds.wind.strongKmh) alerts.push({ type: 'wind', severity: 'moderate', title: 'Strong wind watch', message: 'Wind speed is above the configurable warning threshold.', recommendation: 'Secure equipment and check vulnerable crops and animal shelters.' });
  return { agriculture: { rainfallRisk: rainRisk, droughtRisk: rain24h < thresholds.rainfall.drought7d ? 'watch' : 'low', irrigation: rain24h < thresholds.rainfall.drought7d ? 'Monitor soil moisture' : 'No general irrigation signal', fieldWork: rainRisk === 'high' ? 'Postpone if soil is saturated' : 'Weather conditions appear suitable', thresholds }, livestock: { heatStress: temperature >= thresholds.temperature.heatStress ? 'watch' : 'low', windExposure: windKmh >= thresholds.wind.strongKmh ? 'watch' : 'low', shelter: windKmh >= thresholds.wind.strongKmh ? 'Check shelter' : 'No general shelter warning', thresholds }, alerts };
}

function normalizeWeather(raw, location) {
  const current = raw.current || {};
  const daily = raw.daily || {};
  return { provider: 'open-meteo', location, units: raw.current_units || {}, current: { temperature: current.temperature_2m ?? null, humidity: current.relative_humidity_2m ?? null, rainfall: current.precipitation ?? null, rain: current.rain ?? null, windSpeed: current.wind_speed_10m ?? null, windDirection: current.wind_direction_10m ?? null, uvIndex: current.uv_index ?? null, weatherCode: current.weather_code ?? null, weatherCondition: weatherCodes[current.weather_code] || 'Unknown' }, forecast: { daily: (daily.time || []).map((date, index) => ({ date, weatherCode: daily.weather_code?.[index] ?? null, weatherCondition: weatherCodes[daily.weather_code?.[index]] || 'Unknown', temperatureMax: daily.temperature_2m_max?.[index] ?? null, temperatureMin: daily.temperature_2m_min?.[index] ?? null, rainfall: daily.precipitation_sum?.[index] ?? null, rainProbability: daily.precipitation_probability_max?.[index] ?? null, windSpeedMax: daily.wind_speed_10m_max?.[index] ?? null, uvIndexMax: daily.uv_index_max?.[index] ?? null, sunshineDuration: daily.sunshine_duration?.[index] ?? null, evapotranspiration: daily.et0_fao_evapotranspiration?.[index] ?? null })), hourly: raw.hourly || {} }, ...interpretWeather(raw) };
}

async function getWeatherForecast(latitude, longitude, location = {}) {
  const coordinates = validateCoordinates(latitude, longitude);
  const key = cacheKey(coordinates.latitude, coordinates.longitude);
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = normalizeWeather(await fetchOpenMeteo(coordinates.latitude, coordinates.longitude), { ...location, ...coordinates });
  if (weatherCache.size >= maxWeatherCacheEntries) weatherCache.delete(weatherCache.keys().next().value);
  weatherCache.set(key, { value, expiresAt: Date.now() + cacheTtlMs.forecast });
  return value;
}

async function getRwandaWeather(district) {
  const location = findRwandaDistrict(district);
  if (!location) throw new Error(`Unknown Rwanda district: ${district}.`);
  return getWeatherForecast(location.latitude, location.longitude, { name: location.district, country: location.country, province: location.province });
}

module.exports = { getWeatherForecast, getRwandaWeather, validateCoordinates, interpretWeather, weatherCodes, thresholds };
