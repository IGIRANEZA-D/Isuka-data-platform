if (!process.env.VERCEL) require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { datasetFiles, repositoryRoot, uploadsRoot, registerUploadedDataset } = require('./data/dataset-config');
const { loadPeriod, deserializeAggregate, buildFilteredOverview, buildTimeSeries, buildDetailedTimeSeries, AGGREGATE_CALC_VERSION } = require('./data/overview-service');
const { riskTier } = require('./data/risk-thresholds');
const { loadForecastCache, getForecastSlice, getForecastDownloadRows, refreshForecastCache } = require('./data/forecasting-service');
const { getLossPlannerBaseline, getLossPlannerDefault } = require('./data/loss-planner-service');
const { saveUpload, saveDatasetLifecycle, removeRejectedDataset, listDatasets, listValidationReports, listAdminValidationReports, listUserDatasets, getDatasetById, getDatasetValidationReport, getDatasetJob, saveDashboardSnapshot, getActiveDashboardSnapshot, seedConfiguredDatasets, createDatasetUploadRecord, buildDatasetVersionRecord, buildValidationReportRecord, buildAIReviewRecord, getSubmissionDecision } = require('./data/dataset-repository');
const {
  getDatabase,
  closeDatabase,
  getDatabaseConnectionStatus,
  validateProductionMongoConfiguration
} = require('./data/mongodb');
const { initializeDatabase } = require('./data/database');
const archiver = require('archiver');
const fs = require('node:fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { MongoRateLimitStore } = require('./data/mongo-rate-limit-store');
const helmet = require('helmet');
const {
  registerAccount,
  loginAccount,
  loginConfiguredAdmin,
  findSession,
  destroySession,
  requestPasswordReset,
  resetPassword,
  changePassword,
  deleteAccount,
  seedAdminUser,
  publicUser,
  classifyAuthenticationFailure,
  createAuthError,
  normalizeProfileUpdate
} = require('./data/auth-service');
const { sendPasswordResetEmail } = require('./data/mailer');
const { getWeather, askAssistant, reviewDatasetWithAI, saveAssistantMessage } = require('./data/providers');
const { buildLandingSummary } = require('./data/landing-summary');
const { getWeatherForecast, getRwandaWeather, validateCoordinates } = require('./data/weather-service');
const { findRwandaDistrict } = require('./data/rwanda-locations');
const { validateDatasetFile, remediateDatasetFile } = require('./data/dataset-validation');
const { enqueueDatasetValidation, recoverDatasetJobs } = require('./data/dataset-worker');
const { spawnSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { collectHistoricalDatasetTrainingRows } = require('./data/dataset-training');
const { validateRequest, makeCatalog, evaluate: evaluateDataRequest, parseQuestion, METRICS } = require('./data/query-engine');
const { parse: parseAssistantQuestion } = require('./assistant/parser');

// V3.8: Structured JSON log helper. Never log passwords, tokens, reset URLs,
// phone numbers, or email addresses.
const log = {
  info: (obj) => process.stdout.write(JSON.stringify({ level: 'info', ts: new Date().toISOString(), ...obj }) + '\n'),
  warn: (obj) => process.stderr.write(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), ...obj }) + '\n'),
  error: (obj) => process.stderr.write(JSON.stringify({ level: 'error', ts: new Date().toISOString(), ...obj }) + '\n')
};


const app = express();
const port = Number(process.env.PORT || 3000);

// V3.3: Trust proxy headers for correct client IP behind Vercel/load-balancer.
// TRUST_PROXY=1 means trust one hop (Vercel's edge). Local dev: 0 (no proxy).
const trustProxyValue = process.env.TRUST_PROXY !== undefined
  ? (Number.isInteger(Number(process.env.TRUST_PROXY)) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY)
  : (process.env.VERCEL ? 1 : 0);
app.set('trust proxy', trustProxyValue);

const asyncHandler = (handler) => function wrappedAsyncHandler(request, response, next) {
  return Promise.resolve(handler(request, response, next)).catch(next);
};
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => original(route, ...handlers.map((handler) => handler.length <= 2 ? asyncHandler(handler) : handler));
}
const requestId = (request, response, next) => {
  const supplied = request.get('x-request-id');
  const id = supplied && /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : crypto.randomUUID();
  request.requestId = id;
  response.set('x-request-id', id);
  next();
};
const frontendOrigin = process.env.FRONTEND_ORIGIN || (process.env.VERCEL ? '' : 'http://localhost:5173');
const frontendDirectory = path.join(repositoryRoot, 'frontend');
const periodCache = new Map();

function normalizedOrigin(value) {
  try { return new URL(value).origin; } catch { return null; }
}

function isAllowedRequestOrigin(request, origin) {
  const normalizedRequestOrigin = normalizedOrigin(origin);
  if (!normalizedRequestOrigin) return false;
  const configuredOrigins = [
    frontendOrigin,
    process.env.PUBLIC_BASE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
  ].map(normalizedOrigin).filter(Boolean);
  const requestHostOrigin = normalizedOrigin(`${request.protocol}://${request.get('host')}`);
  return configuredOrigins.includes(normalizedRequestOrigin) || normalizedRequestOrigin === requestHostOrigin;
}
const overviewCache = new Map();
const maxOverviewCacheEntries = 256;
let rwandaDistrictBoundaryCache;
let landingSummaryCacheKey;
let landingSummaryCacheBody;
const rwandaDistrictBoundaryUrl = 'https://gis.naeb.gov.rw/server/rest/services/Hosted/Administrative_Boundaries_WFL1/FeatureServer/0/query?where=1%3D1&outFields=district%2Ccode_dist%2Cname&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&f=geojson';
const defaultOverviewCachePath = path.join(repositoryRoot, 'backend', 'data', 'default-overview-cache.json');
const defaultOverviewCacheVersion = 1;
// Vercel functions have a read-only deployment filesystem, and the uploads
// directory is intentionally excluded from the bundle. Upload routes return
// 503 on Vercel, so use memory storage there to avoid Multer creating a
// missing /var/task/backend/data/uploads directory during module startup.
const uploadStorage = process.env.VERCEL
  ? multer.memoryStorage()
  : multer.diskStorage({
    destination: uploadsRoot,
    filename: (request, file, callback) => callback(null, `pending-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
  });
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (request, file, callback) => callback(null, /\.(csv|sav|dta|xlsx|xls|rds|rda|rdata)$/i.test(path.extname(file.originalname)))
});
const assistantUpload = multer({
  storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (request, file, callback) => callback(null, /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain)$/i.test(file.mimetype))
});

function getPeriod(year, season) {
  const key = `${year}-${season}`;
  if (!periodCache.has(key)) {
    const config = datasetFiles.find((item) => item.key === key);
    if (config) {
      if (process.env.VERCEL) {
        const artifactPath = path.join(repositoryRoot, 'backend', 'data', 'dist', 'periods', `${key}.json`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        if (artifact.calcVersion !== AGGREGATE_CALC_VERSION || artifact.key !== key) throw new Error(`Published data shard ${key} has an incompatible calculation version.`);
        periodCache.set(key, {
          ...config,
          available: true,
          rows: [],
          rowCount: artifact.rowCount,
          invalidRows: artifact.invalidRows,
          warnings: artifact.warnings || [],
          aggregate: deserializeAggregate(artifact.aggregate)
        });
      } else {
        periodCache.set(key, loadPeriod(config));
      }
    }
  }
  return periodCache.get(key);
}

function getOverviewPeriods(year, season) {
  return [getPeriod(year, season), getPeriod(year - 1, season)].filter(Boolean);
}

function datasetSourceSignature() {
  if (process.env.VERCEL) return AGGREGATE_CALC_VERSION;
  return datasetFiles.map(({ key, filePath }) => {
    try {
      const { size, mtimeMs } = fs.statSync(filePath);
      return `${key}:${size}:${mtimeMs}`;
    } catch {
      return `${key}:missing`;
    }
  }).join('|');
}

function getOverview(year, district, season = 'all') {
  const key = `${year}-${district}-${season}`;
  if (overviewCache.has(key)) return overviewCache.get(key);

  const isDefaultOverview = year === 'all' && district === 'all' && season === 'all';
  const sourceSignature = isDefaultOverview ? datasetSourceSignature() : null;
  if (isDefaultOverview && fs.existsSync(defaultOverviewCachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(defaultOverviewCachePath, 'utf8'));
      const validArtifact = process.env.VERCEL && cached.calcVersion === AGGREGATE_CALC_VERSION && cached.overview;
      if (validArtifact || (cached.version === defaultOverviewCacheVersion && cached.sourceSignature === sourceSignature && cached.overview)) {
        overviewCache.set(key, cached.overview);
        return cached.overview;
      }
    } catch {
      fs.rmSync(defaultOverviewCachePath, { force: true });
    }
  }

  if (overviewCache.size >= maxOverviewCacheEntries) overviewCache.delete(overviewCache.keys().next().value);
  const selectedConfigs = datasetFiles.filter((item) => year === 'all'
    || item.year === Number(year)
    || item.year === Number(year) - 1);
  const periods = selectedConfigs.map((item) => getPeriod(item.year, item.season)).filter(Boolean);
  const overview = buildFilteredOverview(periods, year, district, season);
  overviewCache.set(key, overview);
  if (isDefaultOverview && !process.env.VERCEL) {
    try {
      fs.writeFileSync(defaultOverviewCachePath, JSON.stringify({ version: defaultOverviewCacheVersion, sourceSignature, overview }));
    } catch (error) {
      process.stderr.write(JSON.stringify({ level: 'warn', event: 'overview_cache_write_failed', message: error.message }) + '\n');
    }
  }
  return overview;
}

function getAllPeriods() {
  return datasetFiles.map((item) => getPeriod(item.year, item.season)).filter(Boolean);
}

let assistantRowsCache;
let assistantRowsCacheSignature;
let assistantCatalogCache;
function assistantRows() {
  const signature = datasetSourceSignature();
  if (!assistantRowsCache || assistantRowsCacheSignature !== signature) {
    assistantRowsCache = buildDetailedTimeSeries(getAllPeriods());
    assistantRowsCacheSignature = signature;
    assistantCatalogCache = null;
  }
  return assistantRowsCache;
}
function assistantCatalog() { assistantRows(); if (!assistantCatalogCache) assistantCatalogCache = makeCatalog(assistantRowsCache); return assistantCatalogCache; }
function queryFromSearch(searchParams) {
  const decode = (key, fallback) => {
    const value = searchParams.get(key);
    if (value === null) return fallback;
    try { return JSON.parse(value); } catch { return value; }
  };
  return { metric:decode('metric',''), crop:decode('crop','all'), districts:decode('districts','all'), years:decode('years','all'), seasons:decode('seasons','all'), breakdown:decode('breakdown','none'), compare:decode('compare',undefined), format:decode('format','table') };
}
function requestQuery(input, httpRequest) {
  const baseUrl=httpRequest?`${httpRequest.protocol}://${httpRequest.get('host')}`:'';
  const checked=validateRequest(input);
  if(checked.errors)return {errors:checked.errors};
  if(checked.request.metric==='lossByStage'){
    const request=checked.request;
    const stageData=getLossPlannerBaseline({years:request.years.join(','),seasons:request.seasons.join(',')});
    const stageCoverage=[];
    for(const year of request.years)for(const season of request.seasons){
      const period=getLossPlannerBaseline({years:year,seasons:season});
      const selected=period.rows.filter(row=>(request.districts==='all'||request.districts.includes(row.d))&&(request.crop==='all'||request.crop===row.c));
      const count=selected.reduce((sum,row)=>sum+(row.stageRecords||0),0);
      const stageConfirmed=period.stages.some(stage=>stage.unitStatus==='confirmed');
      stageCoverage.push({year:Number(year),season,status:!stageConfirmed||count===0?'none':count<30?'insufficient':'ok',records:count<30?null:count});
    }
    return evaluateDataRequest(request,assistantRows(),{baseUrl,stageData,stageCoverage});
  }
  return evaluateDataRequest(checked.request, assistantRows(), { baseUrl });
}
function sendAssistantJson(request, response, body) {
  if (request.acceptsEncodings('gzip')) response.vary('Accept-Encoding').set('Content-Type','application/json; charset=utf-8').set('Content-Encoding','gzip').send(gzipSync(JSON.stringify(body)));
  else response.json(body);
}

function cleanedDataRowsForYear(year) {
  return buildDetailedTimeSeries(getAllPeriods())
    .filter((row) => row.year === Number(year))
    .map((row) => ({
      year: row.year,
      season: row.season,
      districtCode: row.districtCode,
      cropCode: row.cropCode,
      cropName: row.cropName,
      weightedProductionKg: row.weightedProductionKg,
      weightedAreaHa: row.weightedAreaHa,
      lossKg: row.lossKg,
      lossPercent: row.lossPercent,
      riskTier: row.riskTier,
      rowCount: row.rowCount
    }));
}

function rowsToCsv(rows) {
  const headers = ['year', 'season', 'districtCode', 'cropCode', 'cropName', 'weightedProductionKg', 'weightedAreaHa', 'lossKg', 'lossPercent', 'riskTier', 'rowCount'];
  const csvValue = (value) => { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n');
}

app.use(requestId);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'], mediaSrc: ["'self'"], connectSrc: ["'self'", 'https://api.open-meteo.com', 'https://generativelanguage.googleapis.com', 'https://api.meteomatics.com'], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'self'"] } } }));
app.use(cors((request, callback) => {
  const origin = request.get('origin');
  callback(null, {
    origin: origin && isAllowedRequestOrigin(request, origin) ? origin : false,
    credentials: true
  });
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((request, response, next) => {
  const originalStatus = response.status.bind(response);
  response.status = (statusCode) => {
    if (statusCode === 503 && !response.headersSent) response.set('Retry-After', '5');
    return originalStatus(statusCode);
  };
  const originalSend = response.send.bind(response);
  response.send = (body) => {
    const bodyBytes = Buffer.isBuffer(body) || typeof body === 'string' ? Buffer.byteLength(body) : 0;
    if (bodyBytes > 4 * 1024 * 1024) {
      response.statusCode = 413;
      response.type('application/json');
      return originalSend(JSON.stringify({ error: 'The response exceeds the 4 MB application limit. Narrow the selected period or filters.', requestId: request.requestId }));
    }
    return originalSend(body);
  };
  const originalJson = response.json.bind(response);
  response.json = (body) => {
    const serialized = JSON.stringify(body);
    if (!request.acceptsEncodings('gzip')) return originalJson(body);
    if (Buffer.byteLength(serialized) < 1024) return originalJson(body);
    const compressed = gzipSync(serialized);
    if (compressed.byteLength > 4 * 1024 * 1024) {
      return originalJson.call(response.status(413), { error: 'The response is too large. Narrow the selected period or filters.', requestId: request.requestId });
    }
    response.vary('Accept-Encoding').type('application/json').set('Content-Encoding', 'gzip').set('Content-Length', String(compressed.byteLength));
    return response.send(compressed);
  };
  next();
});
app.use('/api', (request, response, next) => {
  const isPrivate = /^\/(auth|admin|farm|farms|assistant|datasets|weather|data-export|refresh|data\/export)(\/|\.|$)/.test(request.path);
  response.set('Cache-Control', isPrivate ? 'private, no-store' : 'public, s-maxage=300, stale-while-revalidate=600');
  if (request.method === 'GET' && !isPrivate && !request.path.startsWith('/health')) {
    const cacheKey = `${AGGREGATE_CALC_VERSION}:${request.path}:${request.originalUrl.split('?')[1] || ''}`;
    const tag = crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 24);
    response.set('ETag', `"${tag}"`);
  }
  if (process.env.NODE_ENV === 'production' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.get('origin');
    if ((origin && !isAllowedRequestOrigin(request, origin)) || request.get('sec-fetch-site') === 'cross-site') {
      return response.status(403).json({ error: 'Cross-origin request rejected.', requestId: request.requestId });
    }
  }
  next();
});
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => log.info({ event: 'http_request', requestId: request.requestId, method: request.method, status: response.statusCode, durationMs: Date.now() - startedAt }));
  next();
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: 429,
  store: new MongoRateLimitStore('auth'),
  handler: (request, response) => {
    response.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
});
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: 429,
  store: new MongoRateLimitStore('registration'),
  handler: (request, response) => response.status(429).json({ error: 'Too many registration attempts. Please try again later.' })
});
const publicDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: 429,
  handler: (request, response) => response.status(429).json({ error: 'Please slow down and try again shortly.' })
});
const assistantLimiter = rateLimit({ windowMs: 60 * 1000, limit: 24, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please slow down and try again shortly.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, store: new MongoRateLimitStore('admin'), message: { error: 'Too many administrator requests. Please try again later.' } });
let accountsReadyPromise;
let adminSeedPromise;
function publicBaseUrlForRequest(request) {
  const configured = normalizedOrigin(process.env.PUBLIC_BASE_URL);
  if (configured && new URL(configured).protocol === 'https:') return configured;
  return normalizedOrigin(`${request.protocol}://${request.get('host')}`) || '';
}

function hasValidPublicBaseUrl(request) {
  try {
    const url = new URL(publicBaseUrlForRequest(request));
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
async function requireAccountFeatures(request, response, next) {
  response.set('Cache-Control', 'private, no-store');
  const required = ['MONGODB_URI', 'SESSION_SECRET'];
  const hasAdminCredentials = Boolean(
    (process.env.ADMIN_SEED_PHONE || process.env.ADMIN_EMAIL)
    && (process.env.ADMIN_SEED_PASSWORD || process.env.ADMIN_PASSWORD)
  );
  if ((process.env.NODE_ENV === 'production' || process.env.VERCEL)
    && (required.some((name) => !process.env[name]?.trim()) || !hasValidPublicBaseUrl(request)
      || (request.baseUrl === '/api/admin' && !hasAdminCredentials))) {
    return response.status(503).set('Retry-After', '60').json({ error: 'This account service is not configured yet.' });
  }
  try {
    if (!accountsReadyPromise) accountsReadyPromise = initializeDatabase();
    await accountsReadyPromise;
    if (request.baseUrl === '/api/admin' && request.path === '/login') {
      if (!adminSeedPromise) adminSeedPromise = seedAdminUser();
      await adminSeedPromise;
    }
    return next();
  } catch (error) {
    accountsReadyPromise = undefined;
    adminSeedPromise = undefined;
    log.warn({ event: 'account_service_unavailable', requestId: request.requestId, errorName: error?.name || 'Error' });
    return response.status(503).set('Retry-After', '5').json({ error: 'Account services are temporarily unavailable. Please try again shortly.' });
  }
}
app.use('/api/auth', requireAccountFeatures);
app.use('/api/admin', requireAccountFeatures);
app.use('/api/admin', adminLimiter);
app.get('/api/data/catalog', publicDataLimiter, (request, response) => sendAssistantJson(request,response,assistantCatalog()));
app.post('/api/data/query', publicDataLimiter, (request, response) => {
  const result = requestQuery(request.body || {}, request);
  if (result.errors) return response.status(400).json({ error:result.errors[0].code, errors:result.errors });
  response.set('Cache-Control','no-store'); sendAssistantJson(request,response,result);
});
app.get('/api/data/query', publicDataLimiter, (request, response) => {
  const result = requestQuery(queryFromSearch(new URL(request.originalUrl, 'http://localhost').searchParams), request);
  if (result.errors) return response.status(400).json({ error:result.errors[0].code, errors:result.errors });
  const sourceTag = crypto.createHash('sha1').update(assistantRowsCacheSignature || '').digest('hex').slice(0,12);
  const etag = `W/"${result.meta.calcVersion}-${sourceTag}-${require('./data/query-engine').permalinkHash(result.request)}"`;
  response.set('ETag',etag).set('Cache-Control','public, max-age=300');
  if (request.get('if-none-match') === etag) return response.status(304).end();
  sendAssistantJson(request,response,result);
});
app.get('/api/data/export.csv', publicDataLimiter, (request, response) => {
  const result = requestQuery(queryFromSearch(new URL(request.originalUrl, 'http://localhost').searchParams), request);
  if (result.errors) return response.status(400).json({ error:result.errors[0].code });
  const rows = result.rows.slice(0,5000);
  const safeCell = (value) => {
    let text=value==null?'':String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text=`'${text}`;
    return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
  };
  const metric=METRICS[result.request.metric];
  const cropName=result.request.crop==='all'?'All crops':assistantCatalog().crops.find(item=>item.code===result.request.crop)?.name||`Crop ${result.request.crop}`;
  const districtNames=result.request.districts==='all'?'All districts':result.request.districts.map(code=>assistantCatalog().districts.find(item=>item.code===code)?.name||code).join('; ');
  const selection=[cropName,districtNames,`${result.request.years.join('; ')} · ${result.request.seasons.join('; ')}`].join(' · ');
  const dimension=result.request.breakdown==='district'?'District':result.request.breakdown==='crop'?'Crop':result.request.breakdown==='year'?'Year':result.request.breakdown==='season'?'Season':result.request.breakdown==='stage'?'Post-harvest stage':'Selection';
  const tableHeader=result.request.metric==='lossByStage'?[dimension,'Recorded loss (tonnes)','Share of recorded loss (%)']:[dimension,`${metric.label} (${metric.unit})`];
  const tableRows=rows.map(row=>[
    result.request.metric==='lossByStage'?String(row.label).replace(/\s·\s[-\d.]+%$/,''):row.label,
    result.request.breakdown==='district'?String(row.label).replace(/\b\w/g,char=>char.toUpperCase()):row.label,
    row.status==='ok'?Number(row.value).toFixed(result.request.metric==='lossRate'?1:2):'Insufficient data',
    ...(result.request.metric==='lossByStage'?[row.status==='ok'&&Number.isFinite(row.shareOfRecordedLossPct)?Number(row.shareOfRecordedLossPct).toFixed(1):'Insufficient data']:[])
  ].map(safeCell).join(','));
  const header=[
    ['ISUKA | RWANDA AGRICULTURAL DATA'],
    ['Data request',`${metric.label} · ${selection}`],
    ['Periods',result.meta.periods.join(', ')||'No matching periods'],
    ['Records represented',result.meta.recordsUsed],
    ['Suppressed result cells',result.meta.suppressedCells],
    ['Calculation version',result.meta.calcVersion],
    ['Citation',result.citation],
    ['Disclaimer','Aggregate survey data only. Not an official NISR statement.'],
    [],
    tableHeader
  ].map(row=>row.map(safeCell).join(','));
  const csv=`\uFEFF${[...header,...tableRows].join('\r\n')}`;
  const slug=`isuka-${result.request.metric}-${result.request.years.join('-')}-${result.request.seasons.join('-')}`.toLowerCase().replace(/[^a-z0-9-]+/g,'-').slice(0,80);
  response.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="${slug}.csv"`);
  if(request.acceptsEncodings('gzip'))response.vary('Accept-Encoding').set('Content-Encoding','gzip').send(gzipSync(csv));else response.send(csv);
});
app.post('/api/assistant', assistantLimiter, async (request, response) => {
  const requestId = request.requestId;
  const text = typeof request.body?.text === 'string' ? request.body.text.trim().slice(0,300) : '';
  const parsedOutput = await parseAssistantQuestion(text, assistantCatalog());
  const parsed = parsedOutput.parsed;
  if (parsed.greeting) return sendAssistantJson(request,response,{ result:{ greeting:true, message:'Ask about NISR survey data (2020–2025): crops, districts, production, area, yield, or recorded loss.' }, parserUsed:'deterministic', requestId });
  if (parsed.refusal) return sendAssistantJson(request,response,{ result:{ refusal:true, message:'I can answer questions about NISR survey data 2020-2025. For farming advice, please contact your local RAB extension officer.' }, parserUsed:'deterministic', requestId });
  if (parsed.clarification) return sendAssistantJson(request,response,{ result:parsed.clarification, parserUsed:'deterministic', requestId });
  const result = requestQuery(parsed.request, request);
  if (result.errors) return response.status(400).json({ error:result.errors[0].code, requestId });
  if (parsedOutput.parserUsed === 'deterministic' && parsed.reviewNote) result.caveats.push(parsed.reviewNote);
  if (Array.isArray(parsed.related) && parsed.related.length) result.related = parsed.related;
  sendAssistantJson(request,response,{ result, parserUsed:parsedOutput.parserUsed, requestId });
});
const sessionCookie = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 14 * 24 * 60 * 60 * 1000, path: '/' };
function sessionToken(request) { return request.cookies.isukaSession; }
async function requireUser(request, response, next) {
  try {
    const result = await findSession(sessionToken(request));
    if (!result) {
      return response.status(401).json({ error: 'Authentication required.' });
    }
    request.user = result.user;
    return next();
  } catch (error) {
    log.warn({ event: 'authentication_unavailable', requestId: request.requestId, errorName: error?.name || 'Error' });
    return response.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
  }
}
function requireRole(...roles) {
  return (request, response, next) => roles.includes(request.user?.role) ? next() : response.status(403).json({ error: 'Insufficient permissions.' });
}

async function userFarmContext(user) {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const records = await databaseCollections.farmRecords.find({ userId: user._id }, { projection: { _id: 1, data: 1, recordType: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
  const profile = user.profile || {};
  let dashboard = null;
  try { dashboard = getOverview('all', profile.district || 'all'); } catch { dashboard = null; }
  const farm = records.map((record) => ({ ...record.data, id: record._id.toString(), recordType: record.recordType }));
  const locatedFarm = farm.find((record) => Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude)));
  const districtLocation = profile.district ? findRwandaDistrict(profile.district) : null;
  let weather = null;
  const latitude = locatedFarm?.latitude ?? profile.latitude ?? districtLocation?.latitude;
  const longitude = locatedFarm?.longitude ?? profile.longitude ?? districtLocation?.longitude;
  if (latitude !== undefined && longitude !== undefined) {
    try { weather = await getWeatherForecast(latitude, longitude, { name: locatedFarm?.farmName || profile.district || 'Account location', country: profile.country || 'Rwanda', district: profile.district || null }); } catch { weather = null; }
  }
  return { profile, farm, weather, farmAlerts: farmReminders(farm, weather), publicDashboard: dashboard ? { filters: dashboard.filters, kpis: dashboard.kpis, productionByCrop: dashboard.productionByCrop.slice(0, 10), riskDistribution: dashboard.riskDistribution } : null };
}

function farmReminders(records, weather) {
  const reminders = [];
  const today = new Date();
  const activeRecords = records.filter((record) => !record.archived);
  const crops = activeRecords.filter((record) => record.recordType === 'crop');
  const livestock = activeRecords.filter((record) => record.recordType === 'animal' || record.recordType === 'group');
  const add = (record, date, title, description, priority = 'medium') => {
    if (!date) return;
    const due = new Date(`${date}T00:00:00`);
    const days = Math.ceil((due - new Date(today.toDateString())) / 86400000);
    if (days < 0 || days > 30) return;
    reminders.push({ id: `${record.id || record._id || record.name}-${title}`, title, description, priority, read: false, dueDate: date, time: days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'}` });
  };
  activeRecords.forEach((record) => {
    const name = record.name || record.cropName || record.species || 'your farm';
    if (record.recordType === 'crop') {
      add(record, record.expectedHarvestDate, `${name} harvest approaching`, 'Review the field and prepare for harvest.');
      if (record.stage === 'failed' || Number.parseFloat(record.lossQuantity) > 0) reminders.push({ id: `${record.id || record._id || name}-crop-attention`, type: 'system', priority: 'high', title: `${name} needs review`, description: record.stage === 'failed' ? 'This crop is marked as failed. Review the cause and next action.' : 'A crop loss has been recorded. Review the cause and update the farm plan.', read: false, time: 'Farm record' });
    }
    if (record.recordType === 'animal' || record.recordType === 'group') {
      add(record, record.expectedBirthDate, `${name} birth expected`, 'Prepare a clean, safe place and monitor closely.', 'high');
      add(record, record.nextVaccinationDate, `${name} vaccination due`, 'Review the vaccination record and arrange follow-up.', 'high');
      if (record.status === 'sick') reminders.push({ id: `${record.id || record._id || name}-livestock-attention`, type: 'livestock', priority: 'high', title: `${name} needs attention`, description: 'This livestock record is marked sick. Check the animal and arrange local veterinary guidance.', read: false, time: 'Farm record' });
    }
  });
  (weather?.alerts || []).forEach((alert) => {
    const cropNames = crops.map((record) => record.cropName || record.name || 'your crop').filter(Boolean);
    const livestockNames = livestock.map((record) => record.name || record.species || 'your livestock').filter(Boolean);
    const affected = alert.type === 'heat' || alert.type === 'wind' ? livestockNames : cropNames;
    const recordContext = affected.length ? ` This applies to ${affected.slice(0, 3).join(', ')}${affected.length > 3 ? ' and other active farm records' : ''}.` : '';
    const action = alert.type === 'heat' && livestockNames.length
      ? 'Provide extra shade and clean water for livestock.'
      : alert.type === 'wind' && livestockNames.length
        ? 'Check livestock shelters and secure loose equipment.'
        : alert.type === 'heavy_rain' && cropNames.length
          ? 'Check field drainage and postpone work if soil is saturated.'
          : alert.recommendation || 'Review this weather notice.';
    const forecastDate = weather.forecast?.daily?.[0]?.date || 'current';
    reminders.push({ ...alert, id: `weather-${alert.type}-${forecastDate}`, type: 'weather', location: weather.location?.district || weather.location?.name || 'Your district', title: affected.length ? `${alert.title} for your farm` : alert.title, description: `${alert.message || 'Weather conditions may affect your farm.'}${recordContext} ${action}`.trim(), read: false, time: 'Forecast period' });
  });
  if (weather?.agriculture?.irrigation === 'Monitor soil moisture') reminders.push({ id: 'weather-irrigation', type: 'weather', severity: 'medium', title: 'Monitor irrigation needs', description: 'Recent or forecast rainfall is limited. Check soil moisture before irrigating.', priority: 'medium', read: false, time: 'Forecast period' });
  return reminders;
}
app.get('/', (request, response) => {
  response.sendFile(path.join(repositoryRoot, 'www', 'landing.html'));
});
app.use(express.static(path.join(repositoryRoot, 'www')));
app.use('/data', express.static(path.join(frontendDirectory, 'data'), { maxAge: '1h' }));
app.use(express.static(frontendDirectory));
app.use('/www', express.static(path.join(repositoryRoot, 'www')));
app.use('/assets', express.static(path.join(repositoryRoot, 'www')));
app.use('/dashboard', express.static(frontendDirectory));

app.get('/dashboard', (request, response) => response.redirect('/dashboard/'));

app.get('/dashboard/land-crops/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'land-crops.html'));
});
  
app.get('/dashboard/climate-risk/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'climate-risk.html'));
});

app.get('/dashboard/inputs-practices/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'inputs-practices.html'));
});
app.get('/dashboard/district-explorer/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'district-explorer.html'));
});

app.get('/dashboard/forecasting/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'forecasting.html'));
});
app.get('/dashboard/loss-planner/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'loss-planner.html'));
});

app.get('/dashboard/forecasting/analysis/', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'forecasting-analysis.html'));
});

app.get('/account/signup', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'account-signup.html'));
});

app.get('/account/login', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'account-login.html'));
});

app.get('/account/setup', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'account-setup.html'));
});

app.get('/account/dashboard', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'account-dashboard.html'));
});

app.get('/account/my-farm', (request, response) => response.sendFile(path.join(frontendDirectory, 'account-my-farm.html')));
app.get('/account/assistant', (request, response) => response.sendFile(path.join(frontendDirectory, 'account-assistant.html')));
app.get('/account/alerts', (request, response) => response.sendFile(path.join(frontendDirectory, 'account-alerts.html')));
app.get('/account/settings', (request, response) => response.sendFile(path.join(frontendDirectory, 'account-settings.html')));

app.get('/admin/login', (request, response) => response.sendFile(path.join(frontendDirectory, 'admin-login.html')));
app.get('/admin', requireUser, requireRole('admin', 'analyst'), (request, response) => response.sendFile(path.join(frontendDirectory, 'admin-dashboard.html')));
app.get('/admin/datasets', requireUser, requireRole('admin', 'analyst'), (request, response) => response.sendFile(path.join(frontendDirectory, 'admin-datasets.html')));
app.get('/admin/upload', requireUser, requireRole('admin', 'analyst'), (request, response) => response.sendFile(path.join(frontendDirectory, 'admin-upload.html')));
app.get('/admin/reports', requireUser, requireRole('admin', 'analyst'), (request, response) => response.sendFile(path.join(frontendDirectory, 'admin-reports.html')));

app.post('/api/admin/login', authLimiter, async (request, response) => {
  try {
    const result = await loginConfiguredAdmin({ identity: request.body?.identity, password: request.body?.password });
    response.cookie('isukaSession', result.session.token, sessionCookie);
    response.json({ user: publicUser(result.user) });
  } catch (error) {
    const failure = classifyAuthenticationFailure(error);
    log.warn({ event: 'admin_login_failed', requestId: request.requestId, category: failure.logLabel, errorName: error?.name || 'Error' });
    return response.status(failure.statusCode).json({
      error: failure.statusCode === 503 ? 'Sign-in is temporarily unavailable. Please try again shortly.' : failure.publicError
    });
  }
});

app.post('/api/auth/register', registrationLimiter, async (request, response) => {
  try {
    const result = await registerAccount(request.body);
    response.cookie('isukaSession', result.session.token, sessionCookie);
    response.status(201).json({ user: publicUser(result.user) });
  } catch (error) {
    const message = String(error?.message || 'Account creation failed.');
    const isInputError = message.startsWith('An account') || message.startsWith('Enter') || message.startsWith('Password');
    if (!isInputError) {
      log.warn({ event: 'account_registration_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    }
    response.status(isInputError ? 400 : 503).json({
      error: isInputError ? message : 'We could not create your account right now. Please try again shortly.'
    });
  }
});

app.post('/api/auth/login', authLimiter, async (request, response) => {
  try {
    const result = await loginAccount(request.body);
    response.cookie('isukaSession', result.session.token, sessionCookie);
    response.json({ user: publicUser(result.user) });
  } catch (error) {
    const failure = classifyAuthenticationFailure(error);
    log.warn({ event: 'farmer_login_failed', requestId: request.requestId, category: failure.logLabel, errorName: error?.name || 'Error' });
    response.status(failure.statusCode).json({
      error: failure.statusCode === 503 ? 'Sign-in is temporarily unavailable. Please try again shortly.' : failure.publicError
    });
  }
});

app.get('/api/auth/me', requireUser, async (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.post('/api/auth/logout', async (request, response) => {
  const token = sessionToken(request);
  if (token) await destroySession(token);
  response.clearCookie('isukaSession', { path: '/', httpOnly: true, sameSite: 'lax', secure: sessionCookie.secure });
  response.json({ loggedOut: true });
});

app.patch('/api/auth/profile', requireUser, async (request, response) => {
  const databaseCollections = await initializeDatabase();
  const nextProfile = request.body?.profile && typeof request.body.profile === 'object' ? normalizeProfileUpdate(request.body.profile) : {};
  const user = await databaseCollections.users.findOne({ _id: request.user._id });
  if (!user) return response.status(404).json({ error: 'Account not found.' });
  const mergedProfile = {
    ...(user.profile || {}),
    ...nextProfile,
    firstName: typeof nextProfile.firstName === 'string' ? nextProfile.firstName.trim() : (user.profile?.firstName || user.profile?.first_name || ''),
    lastName: typeof nextProfile.lastName === 'string' ? nextProfile.lastName.trim() : (user.profile?.lastName || user.profile?.last_name || ''),
    district: typeof nextProfile.district === 'string' ? nextProfile.district.trim() : (user.profile?.district || '')
  };
  const now = new Date();
  const result = await databaseCollections.users.updateOne({ _id: request.user._id }, { $set: { profile: mergedProfile, updatedAt: now } });
  if (result.matchedCount !== 1) return response.status(404).json({ error: 'Account not found.' });
  response.json({ user: publicUser({ ...user, profile: mergedProfile, updatedAt: now }) });
});

app.post('/api/auth/password', requireUser, async (request, response) => {
  try {
    await changePassword(request.user, request.body?.currentPassword, request.body?.newPassword);
    response.json({ changed: true });
  } catch (error) {
    const failure = classifyAuthenticationFailure(error, { defaultStatusCode: 400 });
    if (failure.statusCode === 503) {
      log.warn({ event: 'password_change_unavailable', requestId: request.requestId, errorName: error?.name || 'Error' });
    }
    response.status(failure.statusCode).json({
      error: failure.statusCode === 503 ? 'We could not update your password right now. Please try again shortly.' : error.message || 'Password change failed.'
    });
  }
});

app.delete('/api/auth/account', requireUser, async (request, response) => {
  try {
    const token = sessionToken(request);
    await deleteAccount(request.user);
    if (token) await destroySession(token);
    response.clearCookie('isukaSession', { path: '/', httpOnly: true, sameSite: 'lax', secure: sessionCookie.secure });
    response.json({ deleted: true });
  } catch (error) {
    log.warn({ event: 'account_deletion_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'We could not delete your account right now. Please try again shortly.' });
  }
});

app.post('/api/auth/forgot-password', authLimiter, async (request, response) => {
  try {
    const result = await requestPasswordReset(request.body.identity);
    const recipient = result.user?.email || process.env.RESEND_FROM_EMAIL;
    const publicBaseUrl = publicBaseUrlForRequest(request) || `http://localhost:${port}`;
    const resetUrl = new URL('/account/login', publicBaseUrl);
    resetUrl.hash = new URLSearchParams({ resetToken: result.token }).toString();
    await sendPasswordResetEmail(recipient, resetUrl.toString(), result.code);
    response.json({ accepted: true });
  } catch (error) {
    log.warn({ event: 'password_recovery_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'Password recovery is temporarily unavailable. Please try again later.' });
  }
});

app.post('/api/auth/reset-password', authLimiter, async (request, response) => {
  try {
    if (String(request.body?.password || '') !== String(request.body?.passwordConfirm || '')) {
      return response.status(400).json({ error: 'The new password and confirmation do not match.' });
    }
    await resetPassword(request.body);
    response.json({ reset: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get('/api/farm/records', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const records = await databaseCollections.farmRecords.find({ userId: request.user._id }, { projection: { _id: 1, data: 1, recordType: 1, version: 1, createdAt: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
  response.set('Cache-Control', 'no-store');
  response.json(records.map((record) => ({ ...record.data, recordType: record.recordType, id: record._id.toString(), ...(record.version ? { version: record.version } : {}) })));
});

app.get('/api/farm/context', requireUser, async (request, response) => {
  response.json(await userFarmContext(request.user));
});

app.get('/api/farm/reminders', requireUser, async (request, response) => {
  const context = await userFarmContext(request.user);
  const reminders = farmReminders(context.farm, context.weather);
  const databaseCollections = await require('./data/database').initializeDatabase();
  const saved = await databaseCollections.alerts.find({ userId: request.user._id, id: { $in: reminders.map((reminder) => reminder.id) } }, { projection: { _id: 0, id: 1, read: 1, deletedAt: 1 } }).toArray();
  const readState = new Map(saved.map((alert) => [alert.id, alert.read]));
  const deletedIds = new Set(saved.filter((alert) => alert.deletedAt).map((alert) => alert.id));
  response.json(reminders.filter((reminder) => !deletedIds.has(reminder.id)).map((reminder) => ({ ...reminder, read: readState.get(reminder.id) || false })));
});

app.post('/api/farm/records', requireUser, async (request, response) => {
  const data = request.body?.data;
  const recordType = String(request.body?.recordType || data?.recordType || '');
  if (!data || typeof data !== 'object' || !['crop', 'animal', 'group'].includes(recordType)) return response.status(400).json({ error: 'A valid farm record is required.' });
  const databaseCollections = await require('./data/database').initializeDatabase();
  const now = new Date();
  const normalizedData = { ...data, recordType };
  const result = await databaseCollections.farmRecords.insertOne({ userId: request.user._id, recordType, data: normalizedData, version: 1, createdAt: now, updatedAt: now });
  response.status(201).json({ ...normalizedData, id: result.insertedId.toString(), version: 1 });
});

app.patch('/api/farm/records/:id', requireUser, async (request, response) => {
  const { toObjectId } = require('./data/auth-service');
  const id = toObjectId(request.params.id);
  const data = request.body?.data;
  const recordType = String(data?.recordType || '');
  if (!id || !data || typeof data !== 'object' || !['crop', 'animal', 'group'].includes(recordType)) return response.status(400).json({ error: 'Invalid farm record.' });
  const databaseCollections = await require('./data/database').initializeDatabase();
  const normalizedData = { ...data, recordType };
  const expectedVersion = Number.isInteger(request.body.version) ? request.body.version : null;
  const filter = { _id: id, userId: request.user._id, ...(expectedVersion ? { version: expectedVersion } : {}) };
  const result = await databaseCollections.farmRecords.findOneAndUpdate(filter, { $set: { data: normalizedData, recordType, updatedAt: new Date() }, $inc: { version: 1 } }, { returnDocument: 'after', projection: { _id: 1, data: 1, recordType: 1, version: 1 } });
  if (!result) {
    const exists = await databaseCollections.farmRecords.findOne({ _id: id, userId: request.user._id }, { projection: { _id: 1 } });
    return response.status(exists ? 409 : 404).json({ error: exists ? 'This record changed elsewhere. Reload it before saving.' : 'Farm record not found.' });
  }
  response.json({ ...result.data, id: result._id.toString(), recordType: result.recordType, version: result.version });
});

app.delete('/api/farm/records/:id', requireUser, async (request, response) => {
  const { toObjectId } = require('./data/auth-service');
  const id = toObjectId(request.params.id);
  if (!id) return response.status(400).json({ error: 'Invalid farm record ID.' });
  try {
    const databaseCollections = await require('./data/database').initializeDatabase();
    const result = await databaseCollections.farmRecords.deleteOne({ _id: id, userId: request.user._id });
    if (result.deletedCount !== 1) {
      log.info({ event: 'farm_record_delete_miss', requestId: request.requestId });
      return response.status(404).json({ error: 'Farm record not found for this account.' });
    }
    response.json({ deleted: true, id: id.toString() });
  } catch (error) {
    log.error({ event: 'farm_record_delete_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'We could not delete this farm record right now. Please try again.' });
  }
});

app.get('/api/farms/:farmId/weather', requireUser, async (request, response) => {
  const { toObjectId } = require('./data/auth-service');
  const id = toObjectId(request.params.farmId);
  if (!id) return response.status(400).json({ error: 'Invalid farm ID.' });
  const databaseCollections = await require('./data/database').initializeDatabase();
  const farm = await databaseCollections.farmRecords.findOne({ _id: id, userId: request.user._id });
  if (!farm) return response.status(404).json({ error: 'Farm record not found.' });
  const latitude = farm.data?.latitude;
  const longitude = farm.data?.longitude;
  try { response.json(await getWeatherForecast(latitude, longitude, { name: farm.data?.farmName || farm.data?.plotName || farm.data?.name || 'Farm', country: 'Rwanda', district: farm.data?.district || null })); } catch (error) { response.status(error.message.startsWith('Latitude') ? 400 : 503).json({ error: error.message }); }
});

app.get('/api/farm/alerts', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const alerts = await databaseCollections.alerts.find({ userId: request.user._id, deletedAt: { $exists: false } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  response.json(alerts);
});

function calculateUnreadAlertCount(reminders, storedAlerts) {
  const deletedReminderIds = new Set(storedAlerts.filter((alert) => alert.deletedAt).map((alert) => alert.id));
  const activeReminders = reminders.filter((reminder) => !deletedReminderIds.has(reminder.id));
  const reminderIds = new Set(activeReminders.map((reminder) => reminder.id));
  const storedById = new Map(storedAlerts.filter((alert) => !alert.deletedAt).map((alert) => [alert.id, alert]));
  const unreadReminders = activeReminders.filter((reminder) => storedById.get(reminder.id)?.read !== true).length;
  const unreadStoredAlerts = storedAlerts.filter((alert) => !alert.deletedAt && !reminderIds.has(alert.id) && alert.read !== true).length;
  return unreadReminders + unreadStoredAlerts;
}

app.get('/api/farm/alerts/unread-count', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const context = await userFarmContext(request.user);
  const reminders = farmReminders(context.farm, context.weather);
  const storedAlerts = await databaseCollections.alerts.find({ userId: request.user._id }, { projection: { id: 1, read: 1, deletedAt: 1 } }).toArray();
  const count = calculateUnreadAlertCount(reminders, storedAlerts);
  response.json({ count });
});

async function isKnownUserAlert(databaseCollections, user, id) {
  if (await databaseCollections.alerts.findOne({ userId: user._id, id }, { projection: { _id: 1 } })) return true;
  const context = await userFarmContext(user);
  return farmReminders(context.farm, context.weather).some((reminder) => reminder.id === id);
}

app.patch('/api/farm/alerts/read', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const now = new Date();
  if (request.body?.id) {
    const id = String(request.body.id);
    if (!(await isKnownUserAlert(databaseCollections, request.user, id))) return response.status(404).json({ error: 'Alert not found for this account.' });
    await databaseCollections.alerts.updateOne({ userId: request.user._id, id }, { $set: { read: true, readAt: now }, $setOnInsert: { userId: request.user._id, id, title: 'Farm reminder', createdAt: now } }, { upsert: true });
  } else {
    const context = await userFarmContext(request.user);
    const reminders = farmReminders(context.farm, context.weather);
    if (reminders.length) {
      await databaseCollections.alerts.bulkWrite(reminders.map((reminder) => ({
        updateOne: {
          filter: { userId: request.user._id, id: reminder.id },
          update: { $set: { read: true, readAt: now }, $setOnInsert: { userId: request.user._id, id: reminder.id, title: reminder.title || 'Farm reminder', createdAt: now } },
          upsert: true
        }
      })));
    }
    await databaseCollections.alerts.updateMany({ userId: request.user._id }, { $set: { read: true, readAt: now } });
  }
  response.status(204).end();
});

app.delete('/api/farm/alerts/:id', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const id = String(request.params.id || '').trim();
  if (!id || id.length > 200) return response.status(400).json({ error: 'A valid alert ID is required.' });
  if (!(await isKnownUserAlert(databaseCollections, request.user, id))) return response.status(404).json({ error: 'Alert not found for this account.' });
  await databaseCollections.alerts.updateOne(
    { userId: request.user._id, id },
    { $set: { deletedAt: new Date() }, $setOnInsert: { userId: request.user._id, id, title: 'Farm alert', read: true, createdAt: new Date() } },
    { upsert: true }
  );
  response.status(204).end();
});

app.get('/api/weather', requireUser, async (request, response) => {
  const latitude = Number(request.query.latitude);
  const longitude = Number(request.query.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return response.status(400).json({ error: 'Valid latitude and longitude are required.' });
  try { response.json(await getWeatherForecast(latitude, longitude, { name: request.query.name || 'Selected location', country: request.query.country || null })); } catch (error) { response.status(error.message.startsWith('Latitude') ? 400 : 503).json({ error: error.message }); }
});

app.get('/api/weather/current', requireUser, async (request, response) => {
  const latitude = Number(request.query.latitude);
  const longitude = Number(request.query.longitude);
  try {
    const weather = await getWeatherForecast(latitude, longitude, { name: request.query.name || 'Selected location', country: request.query.country || null });
    response.json({ provider: weather.provider, location: weather.location, units: weather.units, current: weather.current, agriculture: weather.agriculture, livestock: weather.livestock, alerts: weather.alerts });
  } catch (error) { response.status(error.message.startsWith('Latitude') ? 400 : 503).json({ error: error.message }); }
});

app.get('/api/weather/forecast', requireUser, async (request, response) => {
  const latitude = Number(request.query.latitude);
  const longitude = Number(request.query.longitude);
  try { response.json(await getWeatherForecast(latitude, longitude, { name: request.query.name || 'Selected location', country: request.query.country || null })); } catch (error) { response.status(error.message.startsWith('Latitude') ? 400 : 503).json({ error: error.message }); }
});

app.get('/api/weather/rwanda/:district', requireUser, async (request, response) => {
  try { response.json(await getRwandaWeather(request.params.district)); } catch (error) { response.status(error.message.startsWith('Unknown') ? 404 : 503).json({ error: error.message }); }
});

app.post('/api/assistant/messages', requireUser, authLimiter, (request, response, next) => assistantUpload.single('attachment')(request, response, (error) => {
  if (error) return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The attachment is too large. Choose a file smaller than 4 MB.' : error.message || 'The uploaded file could not be read.' });
  next();
}), async (request, response) => {
  const message = String(request.body?.message || '').trim();
  if ((!message && !request.file) || message.length > 4000) return response.status(400).json({ error: 'Type a question or attach a crop or livestock photo.' });
  try {
    const answer = await askAssistant(message || 'Please analyze this uploaded farm file and tell me what I should do next.', await userFarmContext(request.user), request.file);
    await saveAssistantMessage(request.user._id, message, answer, String(request.body?.conversationId || 'legacy'), String(request.body?.conversationTitle || 'Conversation').trim().slice(0, 120))
      .catch((error) => log.warn({ event: 'assistant_history_save_failed', requestId: request.requestId, errorName: error?.name || 'Error' }));
    response.json({ answer });
  } catch (error) {
    log.warn({ event: 'assistant_request_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'The assistant is temporarily unavailable. Please try again shortly.' });
  }
});

app.get('/api/assistant/history', requireUser, async (request, response) => {
  try {
    const databaseCollections = await require('./data/database').initializeDatabase();
    const history = await databaseCollections.assistantMessages.find({ userId: request.user._id }, { projection: { _id: 0, message: 1, answer: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(100).toArray();
    response.json(history);
  } catch (error) { log.warn({ event: 'assistant_history_unavailable', requestId: request.requestId, errorName: error?.name || 'Error' }); response.status(503).json({ error: 'Assistant history is temporarily unavailable.' }); }
});

app.get('/api/assistant/chats', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const rows = await databaseCollections.assistantMessages.find({ userId: request.user._id }, { projection: { _id: 0, conversationId: 1, conversationTitle: 1, message: 1, answer: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
  const chats = new Map();
  rows.forEach((row) => {
    const id = row.conversationId || 'legacy';
    const chat = chats.get(id) || { id, title: row.conversationTitle || row.message || 'Conversation', messages: [], createdAt: row.createdAt, updatedAt: row.createdAt };
    chat.title = row.conversationTitle || chat.title;
    chat.messages.push({ role: 'user', text: row.message || '' }, { role: 'assistant', text: row.answer || '' });
    chat.updatedAt = row.createdAt;
    chats.set(id, chat);
  });
  response.json([...chats.values()].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)));
});

app.patch('/api/assistant/chats/:id', requireUser, async (request, response) => {
  const title = String(request.body?.title || '').trim().slice(0, 120);
  if (!title) return response.status(400).json({ error: 'A chat name is required.' });
  const databaseCollections = await require('./data/database').initializeDatabase();
  const conversationId = String(request.params.id);
  const conversationFilter = conversationId === 'legacy' ? { $or: [{ conversationId: 'legacy' }, { conversationId: { $exists: false } }] } : { conversationId };
  const update = conversationId === 'legacy' ? { $set: { conversationId: 'legacy', conversationTitle: title } } : { $set: { conversationTitle: title } };
  const result = await databaseCollections.assistantMessages.updateMany({ userId: request.user._id, ...conversationFilter }, update);
  if (!result.matchedCount) return response.status(404).json({ error: 'Chat not found.' });
  response.json({ id: String(request.params.id), title });
});

app.delete('/api/assistant/chats/:id', requireUser, async (request, response) => {
  const databaseCollections = await require('./data/database').initializeDatabase();
  const conversationId = String(request.params.id);
  const conversationFilter = conversationId === 'legacy' ? { $or: [{ conversationId: 'legacy' }, { conversationId: { $exists: false } }] } : { conversationId };
  const result = await databaseCollections.assistantMessages.deleteMany({ userId: request.user._id, ...conversationFilter });
  if (!result.deletedCount) return response.status(404).json({ error: 'Chat not found.' });
  response.status(204).end();
});

app.post('/api/datasets/upload', requireUser, (request, response, next) => {
  if (process.env.VERCEL || String(process.env.DATA_UPLOAD_ENABLED || 'true').toLowerCase() === 'false') {
    return response.status(503).json({ error: 'Data updates are published by redeploying.', disabled: true });
  }
  return next();
}, upload.single('dataset'), async (request, response) => {
  const file = request.file;
  const title = String(request.body.title || file?.originalname || 'Uploaded dataset').trim();
  const datasetType = String(request.body.datasetType || 'climate').trim();
  const sourceType = String(request.body.sourceType || 'upload').trim();
  const ownerType = String(request.body.ownerType || (request.user.role === 'admin' ? 'admin' : 'farmer')).trim();
  const description = String(request.body.description || '').trim();
  const selectedYear = Number(request.body.year);
  const selectedSeason = String(request.body.season || '').replace(/^Season\s+/i, '').toUpperCase();

  if (!file) return response.status(400).json({ error: 'Upload a dataset file to continue.' });
  const allowedExtensions = ['.csv', '.sav', '.dta', '.xlsx', '.xls', '.rds', '.rda', '.rdata'];
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    fs.unlinkSync(file.path);
    return response.status(400).json({ error: 'Unsupported file type. Use CSV, XLSX, SPSS, or Stata data.' });
  }

  const normalizedTitle = title || file.originalname;
  const datasetRecord = createDatasetUploadRecord({
    userId: request.user._id,
    farmId: request.body.farmId || null,
    organizationId: request.body.organizationId || null,
    title: normalizedTitle,
    description,
    year: Number.isInteger(selectedYear) ? selectedYear : null,
    season: ['A', 'B', 'C'].includes(selectedSeason) ? selectedSeason : null,
    datasetType,
    fileName: file.originalname,
    storagePath: file.path,
    fileHash: crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'),
    sourceType,
    ownerType,
    status: 'queued',
    validationStatus: 'unread',
    isPublic: false,
    currentVersion: 1,
    publicVersion: null
  });

  const versionRecord = buildDatasetVersionRecord({
    datasetId: null,
    version: 1,
    fileName: file.originalname,
    storagePath: file.path,
    fileHash: datasetRecord.fileHash,
    schemaSummary: { fileType: extension.replace('.', '') },
    rowCount: 0,
    status: 'queued',
    notes: 'New upload awaiting validation.'
  });

  const validationRecord = buildValidationReportRecord({
    datasetId: null,
    version: 1,
    readabilityScore: 0,
    schemaScore: 0,
    completenessScore: 0,
    fitScore: 0,
    status: 'needs_review',
    warnings: ['Dataset upload received and queued for validation.'],
    issues: { queueStatus: 'pending' },
    aiSummary: 'The system has received the upload and is validating the file.',
    aiRecommendation: 'needs_review',
    rowCount: 0,
    validRows: 0,
    invalidRows: 0,
    missingValueRate: 0,
    outlierRate: 0
  });

  const aiRecord = buildAIReviewRecord({
    datasetId: null,
    version: 1,
    recommendation: 'needs_review',
    summary: 'Awaiting schema validation and quality checks before publication.',
    confidence: 0.66,
    details: { sourceType, datasetType },
    jobType: 'fit_review',
    status: 'queued'
  });

  try {
    const result = await saveDatasetLifecycle({
      dataset: datasetRecord,
      version: versionRecord,
      validationReport: validationRecord,
      aiReview: aiRecord
    });
    enqueueDatasetValidation(result.datasetId, request.user._id);

    response.status(201).json({
      success: true,
      datasetId: result.datasetId,
      version: result.version,
      status: 'queued',
      validationStatus: result.validationStatus,
      title: normalizedTitle,
      fileName: file.originalname
    });
  } catch (error) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    response.status(500).json({ error: `Dataset upload failed: ${error.message}` });
  }
});

app.get('/api/datasets/my', requireUser, async (request, response) => {
  try {
    const datasets = await listUserDatasets(request.user._id);
    response.json(datasets);
  } catch (error) {
    response.status(500).json({ error: `Unable to load your datasets: ${error.message}` });
  }
});

app.get('/api/datasets/:id', requireUser, async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to this dataset.' });
    }
    const report = await getDatasetValidationReport(request.params.id);
    response.json({ dataset, validationReports: report });
  } catch (error) {
    response.status(500).json({ error: `Unable to load dataset: ${error.message}` });
  }
});

app.post('/api/datasets/:id/validate', requireUser, async (request, response) => {
  if (process.env.VERCEL) return response.status(503).json({ error: 'Dataset validation is unavailable in this deployment. Data updates are published by redeploying.', disabled: true });
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to validate this dataset.' });
    }
    const job = enqueueDatasetValidation(dataset._id, request.user._id);
    response.status(202).json({ datasetId: String(dataset._id), version: Number(dataset.currentVersion || 1), status: job.status, message: 'Dataset validation has been queued.' });
  } catch (error) {
    response.status(500).json({ error: `Validation failed: ${error.message}` });
  }
});

app.get('/api/datasets/:id/job', requireUser, async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to this dataset job.' });
    }
    const job = await getDatasetJob(dataset._id, request.query.version || null);
    response.json(job || { datasetId: String(dataset._id), status: 'not_started' });
  } catch (error) {
    response.status(500).json({ error: `Unable to load dataset job: ${error.message}` });
  }
});

app.post('/api/datasets/:id/prepare-ai', requireUser, async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to this dataset.' });
    }
    const filePath = dataset.storagePath || dataset.sourcePath || dataset.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return response.status(404).json({ error: 'The original dataset file is no longer available for AI repair.' });
    }
    const repair = remediateDatasetFile(filePath, {
      year: dataset.year,
      season: dataset.season,
      datasetType: dataset.datasetType || 'crop'
    });
    if (!repair.cleaned || !repair.cleanedPath || !fs.existsSync(repair.cleanedPath)) {
      return response.status(422).json({ error: 'The AI repair pipeline could not generate a clean dataset from the uploaded file.' });
    }

    const cleanedReport = validateDatasetFile(repair.cleanedPath, {
      year: dataset.year,
      season: dataset.season,
      datasetType: dataset.datasetType || 'crop'
    });
    const databaseCollections = await initializeDatabase();
    await databaseCollections.datasets.updateOne(
      { _id: dataset._id },
      { $set: {
          repairOutputPath: repair.cleanedPath,
          repairFileName: path.basename(repair.cleanedPath),
          repairSummary: repair.cleaningActions,
          repairStatus: cleanedReport.status === 'pass' ? 'ready' : 'needs_review',
          repairConfidence: cleanedReport.readinessScore || 0,
          updatedAt: new Date()
        }
      }
    );

    response.json({
      success: true,
      datasetId: String(dataset._id),
      repairStatus: cleanedReport.status === 'pass' ? 'ready' : 'needs_review',
      cleanedFileName: path.basename(repair.cleanedPath),
      downloadUrl: `/api/datasets/${dataset._id}/download-clean`,
      validation: cleanedReport,
      repairSummary: repair.cleaningActions,
      warnings: repair.warnings || []
    });
  } catch (error) {
    response.status(500).json({ error: `AI repair failed: ${error.message}` });
  }
});

app.get('/api/datasets/:id/download-clean', requireUser, async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to this dataset file.' });
    }
    const repairedPath = dataset.repairOutputPath || null;
    if (!repairedPath || !fs.existsSync(repairedPath)) {
      return response.status(404).json({ error: 'No repaired dataset file is available for download yet.' });
    }
    response.download(repairedPath, dataset.repairFileName || path.basename(repairedPath));
  } catch (error) {
    response.status(500).json({ error: `Download failed: ${error.message}` });
  }
});

app.post('/api/datasets/:id/revalidate-cleaned', requireUser, async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (request.user.role !== 'admin' && request.user.role !== 'analyst' && String(dataset.userId) !== String(request.user._id)) {
      return response.status(403).json({ error: 'You do not have access to this dataset.' });
    }
    const repairedPath = dataset.repairOutputPath || null;
    if (!repairedPath || !fs.existsSync(repairedPath)) {
      return response.status(404).json({ error: 'There is no repaired dataset to validate.' });
    }
    const validation = validateDatasetFile(repairedPath, {
      year: dataset.year,
      season: dataset.season,
      datasetType: dataset.datasetType || 'crop'
    });
    response.json({
      success: true,
      datasetId: String(dataset._id),
      valid: ['pass', 'warn'].includes(validation.status),
      validation
    });
  } catch (error) {
    response.status(500).json({ error: `Cleaned dataset validation failed: ${error.message}` });
  }
});

app.post('/api/admin/datasets/:id/submit', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  try {
    const databaseCollections = await require('./data/database').initializeDatabase();
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    const job = await getDatasetJob(dataset._id, dataset.currentVersion || 1);
    const submissionDecision = getSubmissionDecision(job);
    if (!submissionDecision.allowed) {
      return response.status(submissionDecision.validationFailed ? 409 : 422).json({ error: submissionDecision.reason, validationFailed: submissionDecision.validationFailed, aiRejected: submissionDecision.aiRejected });
    }
    const now = new Date();
    await databaseCollections.datasets.updateOne({ _id: dataset._id }, { $set: { status: 'needs_review', updatedAt: now } });
    await databaseCollections.adminReviewQueue.updateOne(
      { datasetId: dataset._id },
      { $set: { datasetId: dataset._id, assignedAdminId: null, reviewStatus: 'pending', reviewNotes: request.body?.notes || '', createdAt: now, updatedAt: now } },
      { upsert: true }
    );
    response.json({ datasetId: String(dataset._id), status: 'needs_review', reviewStatus: 'pending' });
  } catch (error) {
    response.status(500).json({ error: `Dataset submission failed: ${error.message}` });
  }
});

app.post('/api/admin/datasets/:id/publish', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  try {
    const dataset = await getDatasetById(request.params.id);
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });
    if (dataset.status !== 'approved' && dataset.status !== 'published') {
      return response.status(409).json({ error: 'Dataset must pass validation and receive admin approval before publication.' });
    }
    const now = new Date();
    const version = Number(dataset.currentVersion || 1);
    const publicOverview = getOverview('all', 'all');
    const metricsHash = crypto.createHash('sha256').update(JSON.stringify(publicOverview)).digest('hex');
    const databaseCollections = await require('./data/database').initializeDatabase();

    await databaseCollections.datasets.updateOne(
      { _id: dataset._id },
      { $set: {
          status: 'published',
          validationStatus: 'accepted',
          isPublic: true,
          publicVersion: version,
          approvedBy: request.user._id,
          approvedAt: now,
          updatedAt: now
        }
      }
    );

    const snapshot = await saveDashboardSnapshot({ datasetId: dataset._id, version, summaryJson: publicOverview, metricsHash, generatedAt: now, publishedAt: now });
    let forecastRefresh;
    if (process.env.VERCEL) {
      forecastRefresh = { status: 'redeploy_required' };
    } else {
      try {
        await refreshForecastCache({ apiUrl: `http://127.0.0.1:${port}` });
        forecastRefresh = { status: 'completed' };
      } catch (error) {
        log.warn({ event: 'forecast_refresh_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
        forecastRefresh = { status: 'failed' };
      }
    }

    response.json({
      success: true,
      datasetId: String(dataset._id),
      status: 'published',
      isPublic: true,
      publicVersion: version,
      snapshot: {
        snapshotType: snapshot.snapshotType,
        period: snapshot.summaryJson.period,
        metricsHash: snapshot.metricsHash,
        generatedAt: snapshot.generatedAt
      },
      forecastRefresh
    });
  } catch (error) {
    response.status(500).json({ error: `Publication failed: ${error.message}` });
  }
});

app.post('/api/admin/forecast/refresh', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  // V3.6: Forecast pipeline (Python) is not available on Vercel. The forecast
  // cache is committed as a pre-built artifact and refreshed by redeploying.
  if (process.env.VERCEL) {
    return response.status(503).json({ error: 'Forecast refresh is not available in this deployment. Forecasts are refreshed by redeploying with updated artifacts.', disabled: true });
  }
  refreshForecastCache({ apiUrl: `http://127.0.0.1:${port}` })
    .then(() => process.stdout.write(JSON.stringify({ level: 'info', event: 'forecast_cache_refreshed' }) + '\n'))
    .catch((error) => process.stderr.write(JSON.stringify({ level: 'warn', event: 'forecast_refresh_failed', message: error.message }) + '\n'));
  response.status(202).json({ status: 'queued', message: 'Forecast regeneration has been queued.' });
});


app.post('/api/admin/uploads', requireUser, requireRole('admin', 'analyst'), (request, response, next) => {
  // V3.6: Runtime data upload cannot persist on Vercel (read-only filesystem).
  // Disable with DATA_UPLOAD_ENABLED=false or when running on Vercel.
  // The admin page still renders; only the upload action is blocked.
  const uploadEnabled = String(process.env.DATA_UPLOAD_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!uploadEnabled || process.env.VERCEL) {
    return response.status(503).json({
      error: 'Data uploads are disabled in this deployment. Data updates are published by redeploying with new artifacts. Contact the platform administrator.',
      disabled: true
    });
  }
  return next();
}, upload.single('dataset'), async (request, response) => {

  const year = Number(request.body.year);
  const season = String(request.body.season || '').replace(/^Season\s+/i, '').toUpperCase();
  const file = request.file;
  if (!file) return response.status(400).json({ error: 'Upload a CSV, SPSS, or Stata dataset.' });
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    fs.unlinkSync(file.path);
    return response.status(400).json({ error: 'Year must be a valid calendar year.' });
  }
  if (!['A', 'B', 'C'].includes(season)) {
    fs.unlinkSync(file.path);
    return response.status(400).json({ error: 'Season must be A, B, or C.' });
  }

  const key = `${year}-${season}`;
  const extension = path.extname(file.originalname).toLowerCase();
  const destination = path.join(uploadsRoot, `${key}${extension}`);
  try {
    const candidate = { key: `${key}-pending`, year, season, filePath: file.path, relativePath: path.relative(repositoryRoot, file.path) };
    const parsed = loadPeriod(candidate);
    if (!parsed.available || !parsed.headers?.length || !parsed.rowCount) throw new Error('The uploaded dataset is empty or could not be read.');
    if (!parsed.aggregate?.productionRowsWithValues) throw new Error('The uploaded dataset has no usable production rows. Check area, yield, production, and survey weight fields.');
    const reportStatus = parsed.aggregate.warnings.length ? 'warning' : 'passed';
    for (const existing of fs.readdirSync(uploadsRoot)) {
      if (existing.startsWith(`${key}.`)) fs.unlinkSync(path.join(uploadsRoot, existing));
    }
    fs.renameSync(file.path, destination);
    if (fs.existsSync(`${file.path}.isuka-aggregate.json`)) fs.unlinkSync(`${file.path}.isuka-aggregate.json`);
    const config = registerUploadedDataset(year, season, destination);
    await saveUpload({
      dataset: { key: config.key, year, season, status: 'published', sourcePath: config.relativePath },
      upload: { datasetKey: config.key, originalName: file.originalname, storedPath: config.relativePath, status: 'published', rows: parsed.rowCount },
      report: { datasetKey: config.key, status: reportStatus, rowsRead: parsed.rowCount, rowsUsed: parsed.aggregate.productionRowsWithValues, invalidRows: parsed.invalidRows, warnings: parsed.aggregate.warnings }
    });
    periodCache.clear();
    overviewCache.clear();
    response.status(201).json({ key: config.key, year, season, filename: file.originalname, rows: parsed.rowCount, status: 'published' });
  } catch (error) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    if (fs.existsSync(`${file.path}.isuka-aggregate.json`)) fs.unlinkSync(`${file.path}.isuka-aggregate.json`);
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/datasets/:id/review', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  const { status, notes } = request.body || {};
  const allowedStatuses = ['approved', 'rejected', 'needs_update'];
  if (!allowedStatuses.includes(status)) return response.status(400).json({ error: 'Invalid review status.' });

  try {
    const databaseCollections = await require('./data/database').initializeDatabase();
    const dataset = await databaseCollections.datasets.findOne({ _id: require('mongodb').ObjectId.createFromHexString(request.params.id) });
    if (!dataset) return response.status(404).json({ error: 'Dataset not found.' });

    const nextStatus = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'needs_review';
    const nextValidation = status === 'approved' ? 'accepted' : status === 'rejected' ? 'invalid' : 'warning';

    if (status === 'rejected') {
      const cleanup = await removeRejectedDataset({ dataset, databaseCollections, fsModule: fs });
      return response.json({
        datasetId: String(dataset._id),
        status: 'rejected',
        validationStatus: 'invalid',
        reviewedBy: request.user._id,
        autoDeleted: cleanup.deleted,
        deletedRecordCount: cleanup.deleted ? 1 : 0
      });
    }

    await databaseCollections.datasets.updateOne(
      { _id: dataset._id },
      { $set: {
          status: nextStatus,
          validationStatus: nextValidation,
          approvedBy: request.user._id,
          approvedAt: status === 'approved' ? new Date() : null,
          updatedAt: new Date()
        }
      }
    );

    await databaseCollections.adminReviewQueue.updateOne(
      { datasetId: dataset._id },
      { $set: { datasetId: dataset._id, assignedAdminId: request.user._id, reviewStatus: status, reviewNotes: notes || '', updatedAt: new Date() } },
      { upsert: true }
    );

    response.json({
      datasetId: String(dataset._id),
      status: nextStatus,
      validationStatus: nextValidation,
      reviewedBy: request.user._id,
      autoDeleted: false
    });
  } catch (error) {
    response.status(500).json({ error: `Review failed: ${error.message}` });
  }
});

app.get('/api/admin/datasets', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  try {
    response.json(await listDatasets());
  } catch (error) {
    log.warn({ event: 'admin_dataset_list_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'The dataset library is temporarily unavailable.' });
  }
});

app.post('/api/admin/datasets/train-model', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  if (process.env.VERCEL) return response.status(503).json({ error: 'Model training is unavailable in this deployment. Data updates are published by redeploying.', disabled: true });
  try {
    const rows = await collectHistoricalDatasetTrainingRows({ limit: 1000 });
    const historyPath = path.join(repositoryRoot, 'backend', 'data', 'dataset-training-history.json');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(rows, null, 2));

    const pythonExecutable = process.env.PYTHON || 'python';
    const scriptPath = path.join(repositoryRoot, 'scripts', 'train_dataset_acceptance_model.py');
    const child = spawnSync(pythonExecutable, [scriptPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env }
    });

    if (child.status !== 0) {
      return response.status(500).json({
        error: 'Training failed.',
        details: child.stderr || child.stdout || 'Unknown Python error.'
      });
    }

    const modelPath = path.join(repositoryRoot, 'backend', 'data', 'dataset-acceptance-model.json');
    const payload = fs.existsSync(modelPath) ? JSON.parse(fs.readFileSync(modelPath, 'utf8')) : { status: 'not_created', modelAvailable: false };
    response.json({ generatedRows: rows.length, ...payload });
  } catch (error) {
    response.status(500).json({ error: `Dataset model training failed: ${error.message}` });
  }
});

app.get('/api/admin/reports', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  try {
    response.json(await listAdminValidationReports());
  } catch (error) {
    log.warn({ event: 'admin_validation_reports_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'Validation reports are temporarily unavailable.' });
  }
});

app.get('/api/admin/overview', requireUser, requireRole('admin', 'analyst'), async (request, response) => {
  try {
    const databaseCollections = await require('./data/database').initializeDatabase();
    const [registeredFarmers, totalUsers] = await Promise.all([
      databaseCollections.users.countDocuments({ role: 'farmer' }),
      databaseCollections.users.countDocuments({})
    ]);
    response.json({ registeredFarmers, totalUsers });
  } catch (error) {
    log.warn({ event: 'admin_account_summary_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    response.status(503).json({ error: 'The account summary is temporarily unavailable.' });
  }
});

app.get('/dashboard/*', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'));
});

app.get('/api/health', async (request, response) => {
  const available = datasetFiles.filter((period) => process.env.VERCEL
    ? fs.existsSync(path.join(repositoryRoot, 'backend', 'data', 'dist', 'periods', `${period.key}.json`))
    : fs.existsSync(period.filePath));
  let database = getDatabaseConnectionStatus().connected ? 'connected' : 'unavailable';
  if (!process.env.VERCEL && database === 'unavailable') {
    try {
      await (await getDatabase()).command({ ping: 1 });
      database = 'connected';
    } catch (error) {
      log.warn({ event: 'health_database_unavailable', requestId: request.requestId, errorName: error?.name || 'MongoDBError' });
    }
  }
  response.json({
    status: available.length === datasetFiles.length && database === 'connected' ? 'ok' : 'degraded',
    service: 'isuka-backend',
    datasetsConfigured: datasetFiles.length,
    datasetsAvailable: available.length,
    checkedAt: new Date().toISOString()
  });
});

app.get('/api/health/live', (request, response) => {
  response.json({ status: 'alive' });
});

app.get('/api/health/ready', async (request, response) => {
  try {
    await initializeDatabase();
    await (await getDatabase()).command({ ping: 1 });
    response.json({ status: 'ready', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'not_ready', database: 'unavailable' });
  }
});

app.get('/api/metadata', (request, response) => {
  response.json({
    supportedPeriods: datasetFiles.map((period) => ({
      key: period.key,
      year: period.year,
      season: period.season,
      available: process.env.VERCEL
        ? fs.existsSync(path.join(repositoryRoot, 'backend', 'data', 'dist', 'periods', `${period.key}.json`))
        : fs.existsSync(period.filePath),
      source: process.env.VERCEL ? 'verified aggregate artifact' : period.relativePath,
      rows: periodCache.get(period.key)?.rowCount ?? periodCache.get(period.key)?.rows.length ?? null,
      headers: process.env.VERCEL ? [] : periodCache.get(period.key)?.headers ?? null
    }))
  });
});

app.get('/api/timeseries', publicDataLimiter, (request, response) => {
  try {
    const districtCode = request.query.districtCode ? String(request.query.districtCode) : 'all';
    const cropCode = request.query.cropCode ? String(request.query.cropCode) : 'all';
    const series = request.query.detail === 'true'
      ? buildDetailedTimeSeries(getAllPeriods())
      : buildTimeSeries(getAllPeriods(), districtCode, cropCode);
    response.json(series);
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/forecast', publicDataLimiter, (request, response) => {
  try {
    const districtCode = request.query.districtCode ? String(request.query.districtCode) : 'all';
    const cropCode = request.query.cropCode ? String(request.query.cropCode) : 'all';
    const model = request.query.model ? String(request.query.model).toLowerCase() : 'ensemble';
    response.json(getForecastSlice(loadForecastCache(), districtCode, cropCode, model));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/forecast/download', publicDataLimiter, (request, response) => {
  try {
    const requestedYear = request.query.year ? String(request.query.year) : 'all';
    if (requestedYear !== 'all' && !/^20\d{2}$/.test(requestedYear)) return response.status(400).json({ error: 'year must be all or a four-digit year' });
    const model = request.query.model ? String(request.query.model).toLowerCase() : 'ensemble';
    const rows = getForecastDownloadRows(loadForecastCache(), requestedYear, model);
    const headers = ['year', 'season', 'districtCode', 'cropCode', 'cropName', 'yearsAvailable', 'productionKg', 'lossPercent', 'riskTier', 'confidenceLowKg', 'confidenceHighKg'];
    const csvValue = (value) => { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n');
    const filename = requestedYear === 'all' ? 'isuka-forecast-dataset-2026-2030.csv' : `isuka-forecast-dataset-${requestedYear}.csv`;
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(csv);
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/loss-planner/baseline', publicDataLimiter, (request, response) => {
  try {
    const years = request.query.years ? String(request.query.years) : 'all';
    const seasons = request.query.seasons ? String(request.query.seasons) : 'all';
    if (years.toLowerCase() !== 'all' && years.split(',').some((year) => !/^20(?:20|21|22|23|24|25)$/.test(year.trim()))) {
      return response.status(400).json({ error: 'years must be all or a comma-separated list from 2020 through 2025' });
    }
    if (seasons.toLowerCase() !== 'all' && seasons.split(',').some((season) => !['A', 'B', 'C'].includes(season.trim().toUpperCase()))) {
      return response.status(400).json({ error: 'seasons must be all or a comma-separated list of A, B, or C' });
    }
    response.json(getLossPlannerBaseline({ years, seasons }));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/loss-planner/default', publicDataLimiter, (request, response) => {
  try {
    const years = request.query.years ? String(request.query.years) : 'all';
    const seasons = request.query.seasons ? String(request.query.seasons) : 'all';
    response.json(getLossPlannerDefault({ years, seasons }));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

// V2.3: Data Library static files are generated at build time (scripts/build-static-exports.js)
// and served from the CDN at /downloads/. These API routes redirect to the static files so
// existing integrations keep working without a payload limit or archiver at request time.
app.get('/api/data-export/:year(2020|2021|2022|2023|2024|2025)', publicDataLimiter, (request, response) => {
  const requestedYear = String(request.params.year);
  if (!/^20(?:20|21|22|23|24|25)$/.test(requestedYear)) return response.status(400).json({ error: 'year must be one of 2020 through 2025' });
  // Redirect to static CDN file (generated by build-static-exports.js)
  const staticPath = `/downloads/isuka-cleaned-agricultural-dataset-${requestedYear}.csv`;
  // Check if static file exists in public/ (local dev fallback: stream from data)
  const staticFilePath = fs.existsSync(path.join(repositoryRoot, 'public', 'downloads', `isuka-cleaned-agricultural-dataset-${requestedYear}.csv`));
  if (staticFilePath || process.env.VERCEL) {
    return response.redirect(301, staticPath);
  }
  // Local fallback: generate on the fly (no /tmp write, just stream)
  try {
    const csv = rowsToCsv(cleanedDataRowsForYear(requestedYear));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="isuka-cleaned-agricultural-dataset-${requestedYear}.csv"`);
    response.send(csv);
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.get('/api/data-export/all', publicDataLimiter, (request, response) => {
  // Redirect to static CDN ZIP file (generated at build time)
  const staticPath = '/downloads/isuka-cleaned-agricultural-datasets-2020-2025.zip';
  const staticFileExists = fs.existsSync(path.join(repositoryRoot, 'public', 'downloads', 'isuka-cleaned-agricultural-datasets-2020-2025.zip'));
  if (staticFileExists || process.env.VERCEL) {
    return response.redirect(301, staticPath);
  }
  // Local fallback: stream ZIP
  try {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', 'attachment; filename="isuka-cleaned-agricultural-datasets-2020-2025.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => response.destroy(error));
    archive.pipe(response);
    for (let year = 2020; year <= 2025; year += 1) {
      archive.append(rowsToCsv(cleanedDataRowsForYear(year)), { name: `isuka-cleaned-agricultural-dataset-${year}.csv` });
    }
    archive.finalize();
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});


app.get('/api/landing/summary', publicDataLimiter, (request, response) => {
  try {
    const artPath = path.join(frontendDirectory, 'data', 'landing-art.json');
    const artStat = fs.statSync(artPath);
    const sourceSignature = [AGGREGATE_CALC_VERSION, artStat.size, artStat.mtimeMs, ...datasetFiles.map((period) => {
      if (process.env.VERCEL) return `${period.key}:${fs.existsSync(path.join(repositoryRoot, 'backend', 'data', 'dist', 'periods', `${period.key}.json`)) ? 'artifact' : 'missing'}`;
      try {
        const stat = fs.statSync(period.filePath);
        return `${period.key}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return `${period.key}:missing`;
      }
    })].join('|');

    if (sourceSignature !== landingSummaryCacheKey || !landingSummaryCacheBody) {
      const art = JSON.parse(fs.readFileSync(artPath, 'utf8'));
      const availablePeriods = datasetFiles
        .filter((period) => process.env.VERCEL
          ? fs.existsSync(path.join(repositoryRoot, 'backend', 'data', 'dist', 'periods', `${period.key}.json`))
          : fs.existsSync(period.filePath))
        .map(({ year, season }) => ({ year, season }));
      const summary = buildLandingSummary({
        periods: availablePeriods,
        districts: art.districts.map(({ code, name }) => ({ code, name })),
        getOverview,
        calcVersion: AGGREGATE_CALC_VERSION
      });
      const json = JSON.stringify(summary);
      const compressed = gzipSync(json, { level: 9 });
      if (compressed.byteLength > 20 * 1024) throw new Error('Landing summary exceeds the 20 KB compressed payload limit.');
      landingSummaryCacheKey = sourceSignature;
      landingSummaryCacheBody = { json, compressed };
    }

    response.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    response.vary('Accept-Encoding');
    if (request.acceptsEncodings('gzip')) {
      response.type('application/json');
      response.set('Content-Encoding', 'gzip');
      response.set('Content-Length', String(landingSummaryCacheBody.compressed.byteLength));
      return response.send(landingSummaryCacheBody.compressed);
    }
    return response.type('application/json').send(landingSummaryCacheBody.json);
  } catch (error) {
    log.error({ event: 'landing_summary_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    return response.status(503).json({ error: 'Landing page data is temporarily unavailable.' });
  }
});

app.get('/api/overview', publicDataLimiter, async (request, response) => {
  try {
    const requestedYear = request.query.year ? String(request.query.year) : '2025';
    const requestedDistrict = request.query.district ? String(request.query.district) : 'all';
    const rawSeason = request.query.season ? String(request.query.season).replace(/^Season\s+/i, '') : 'all';
    const requestedSeason = rawSeason.toLowerCase() === 'all' ? 'all' : rawSeason.toUpperCase();
    if (requestedSeason !== 'all' && !['A', 'B', 'C'].includes(requestedSeason)) return response.status(400).json({ error: 'season must be all, A, B, or C' });
    if (requestedYear !== 'all' && !/^20\d{2}$/.test(requestedYear)) {
      return response.status(400).json({ error: 'year must be all or a four-digit year' });
    }
    return response.json(getOverview(requestedYear, requestedDistrict, requestedSeason));
  } catch (error) {
    log.error({ event: 'dashboard_overview_failed', requestId: request.requestId, errorName: error?.name || 'Error' });
    return response.status(503).json({ error: 'Dashboard data is temporarily unavailable. Please try again.' });
  }
});

function describeDatabaseConnectionFailure(error) {
  const message = String(error?.message || '');
  const name = String(error?.name || 'MongoDBError');
  if (/authentication failed|bad auth|auth failed|code 18/i.test(message)) {
    return 'MongoDB rejected authentication. Verify the Atlas database user, password encoding, and assigned database roles.';
  }
  if (/tls|ssl|certificate|alert internal error/i.test(`${name} ${message}`)) {
    return 'TLS connection to MongoDB failed. Check Atlas cluster status, DNS, the deployment IP access list, and network or TLS inspection rules.';
  }
  if (/server selection|timed out|ECONNREFUSED|ECONNRESET|ENOTFOUND|network|connection/i.test(`${name} ${message}`)) {
    return 'MongoDB could not be reached. Check Atlas cluster status, DNS, the deployment IP access list, and outbound network access.';
  }
  return `MongoDB health check failed (${name}). Check the backend logs for the request details.`;
}

app.get('/api/climate-risk', publicDataLimiter, (request, response) => {
  try {
    const requestedYear = request.query.year ? String(request.query.year) : 'all';
    if (requestedYear !== 'all' && !/^20\d{2}$/.test(requestedYear)) {
      return response.status(400).json({ error: 'year must be all or a four-digit year' });
    }
    const overview = getOverview(requestedYear, 'all');
    const districtMap = new Map();
    overview.districtPerformance.forEach((district) => {
      const key = district.district === 'nyarugenege' ? 'nyarugenge' : district.district;
      const current = districtMap.get(key) || { district: key, productionKg: 0, areaHa: 0, rows: 0, weightedLoss: 0 };
      current.productionKg += district.productionKg || 0;
      current.areaHa += district.areaHa || 0;
      current.rows += district.rows || 0;
      current.weightedLoss += (district.lossPercent || 0) * (district.productionKg || 0);
      districtMap.set(key, current);
    });
    const districts = [...districtMap.values()].map((district) => {
      const lossPercent = district.productionKg ? district.weightedLoss / district.productionKg : null;
      return { ...district, lossPercent, riskTier: riskTier(lossPercent) };
    });
    const averageLoss = districts.filter((district) => Number.isFinite(district.lossPercent));
    response.json({
      period: overview.period,
      filters: overview.filters,
      kpis: {
        districtCount: districts.length,
        highRiskDistricts: districts.filter((district) => district.riskTier === 'high').length,
        averageLossPercent: averageLoss.length ? averageLoss.reduce((sum, district) => sum + district.lossPercent, 0) / averageLoss.length : null,
        totalProductionKg: overview.kpis.weightedProductionKg
      },
      districts
    });
  } catch (error) {
    return response.status(503).json({ error: error.message });
  }
});

async function loadRwandaDistrictBoundaries() {
  if (rwandaDistrictBoundaryCache) return rwandaDistrictBoundaryCache;
  const landingArtPath = path.join(frontendDirectory, 'data', 'landing-art.json');
  try {
    const landingArt = JSON.parse(fs.readFileSync(landingArtPath, 'utf8'));
    if (!Array.isArray(landingArt.districts) || landingArt.districts.length !== 30) {
      throw new Error(`Expected 30 districts in the published map artifact; received ${landingArt.districts?.length || 0}.`);
    }
    const degreesPerMap = 2.1;
    rwandaDistrictBoundaryCache = {
      type: 'FeatureCollection',
        features: landingArt.districts.map((district) => {
          const polygons = district.polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [
            29.87 + (x - 0.5) * degreesPerMap,
            -1.94 - (y - 0.5) * degreesPerMap
          ])));
          const isPolygon = polygons.length === 1;
          return {
            type: 'Feature',
            properties: { district: district.name, name: district.name, code_dist: district.code },
            geometry: {
              type: isPolygon ? 'Polygon' : 'MultiPolygon',
              coordinates: isPolygon ? polygons[0] : polygons
            }
          };
        })
    };
    return rwandaDistrictBoundaryCache;
  } catch (artifactError) {
    if (!fs.existsSync(landingArtPath)) {
      process.stderr.write(`Published Rwanda boundary artifact unavailable; trying GIS source: ${artifactError.message}\n`);
    }
  }
  const boundaryResponse = await fetch(rwandaDistrictBoundaryUrl, { signal: AbortSignal.timeout(10000) });
  if (!boundaryResponse.ok) throw new Error(`Boundary source returned ${boundaryResponse.status}`);
  const geoJson = await boundaryResponse.json();
  if (!Array.isArray(geoJson.features) || geoJson.features.length !== 30) {
    throw new Error(`Expected 30 district polygons; received ${geoJson.features?.length || 0}.`);
  }
  rwandaDistrictBoundaryCache = geoJson;
  return rwandaDistrictBoundaryCache;
}

app.get('/api/rwanda-districts', async (request, response) => {
  try {
    return response.json(await loadRwandaDistrictBoundaries());
  } catch (error) {
    return response.status(502).json({ error: `Could not load Rwanda district boundaries: ${error.message}` });
  }
});

app.post('/api/refresh', requireUser, requireRole('admin', 'analyst'), (request, response) => {
  periodCache.clear();
  overviewCache.clear();
  return response.json({ refreshedAt: new Date().toISOString(), datasetsAvailable: datasetFiles.filter((period) => fs.existsSync(period.filePath)).length });
});
  app.use(['/api', '/health'], (request, response) => response.status(404).json({ error: 'Not found.', requestId: request.requestId }));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  const databaseUnavailable = /MongoServerSelectionError|MongoNetworkError|MongoNotConnectedError|MongoTimeoutError|ECONNREFUSED|ECONNRESET|ENOTFOUND|server selection timed out/i.test(`${error?.name || ''} ${error?.message || ''}`);
  const statusCode = databaseUnavailable ? 503 : Number(error?.statusCode || error?.status) || 500;
  log.error({ event: 'request_failed', requestId: request.requestId, errorName: error?.name || 'Error', errorCode: error?.code || null });
  if (statusCode === 503) response.set('Retry-After', '5');
  response.status(statusCode).json({ error: statusCode === 503 ? 'The service is temporarily unavailable. Please try again shortly.' : 'The server could not complete that request.', requestId: request.requestId });
});

function logMongoStartupFailure(error) {
  process.stderr.write(`MongoDB startup failed: ${error.message}\n`);
  if (/server selection|timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(error.message || '')) {
    process.stderr.write('Check Atlas network access/IP allow-list, DNS and outbound connectivity, then verify the MongoDB URI and database user.\n');
  }
  if (error.cleanupError) {
    process.stderr.write(`MongoDB client cleanup warning: ${error.cleanupError.message}\n`);
  }
}

function listenForRequests(databaseReady) {
  const server = app.listen(port, () => {
    process.stdout.write(databaseReady
      ? `Isuka backend listening on http://localhost:${port}\n`
      : `Isuka backend listening on http://localhost:${port} (database not ready; retrying on demand)\n`);
    if (!databaseReady) return;
    seedConfiguredDatasets(datasetFiles).catch((error) => process.stderr.write(`MongoDB seed warning: ${error.message}\n`));
    recoverDatasetJobs().then((count) => {
      if (count) process.stdout.write(`Isuka recovered ${count} queued dataset job${count === 1 ? '' : 's'}\n`);
    }).catch((error) => process.stderr.write(`Dataset recovery warning: ${error.message}\n`));
    setImmediate(() => {
      try {
        getOverview('2025', 'all');
        process.stdout.write('Isuka default Overview cache warmed\n');
      } catch (error) {
        process.stderr.write(`Overview warmup warning: ${error.message}\n`);
      }
    });
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`${signal} received; closing HTTP and MongoDB connections\n`);
    const shutdownTimer = setTimeout(() => {
      process.stderr.write('Graceful shutdown timed out; closing remaining HTTP connections\n');
      server.closeAllConnections();
    }, 10000);
    shutdownTimer.unref();
    server.close(async (error) => {
      clearTimeout(shutdownTimer);
      try {
        await closeDatabase();
        if (error) throw error;
        process.exitCode = 0;
      } catch (shutdownError) {
        process.stderr.write(`Graceful shutdown failed: ${shutdownError.message}\n`);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) {
  (async () => {
    if (process.env.NODE_ENV === 'production') validateProductionMongoConfiguration();
    try {
      await initializeDatabase();
    } catch (error) {
      logMongoStartupFailure(error);
      if (process.env.NODE_ENV === 'production') {
        process.stderr.write('Production startup aborted because MongoDB is required for a ready service.\n');
        try {
          await closeDatabase();
        } catch (closeError) {
          process.stderr.write(`MongoDB startup cleanup failed: ${closeError.message}\n`);
        }
        process.exitCode = 1;
        return;
      }
      listenForRequests(false);
      return;
    }

    process.stdout.write('MongoDB connected and database initialized\n');
    try {
      await seedAdminUser();
    } catch (error) {
      process.stderr.write(`Admin account bootstrap failed: ${error.message}\n`);
      if (process.env.NODE_ENV === 'production') {
        process.stderr.write('Production startup aborted because configured admin credentials could not be applied.\n');
        try {
          await closeDatabase();
        } catch (closeError) {
          process.stderr.write(`MongoDB startup cleanup failed: ${closeError.message}\n`);
        }
        process.exitCode = 1;
        return;
      }
    }
    listenForRequests(true);
  })().catch((error) => {
    process.stderr.write(`Backend startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.calculateUnreadAlertCount = calculateUnreadAlertCount;
