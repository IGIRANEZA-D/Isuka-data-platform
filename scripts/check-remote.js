'use strict';

const { performance } = require('node:perf_hooks');
const { URL } = require('node:url');

const baseUrl = String(process.argv[2] || '').replace(/\/$/, '');
if (!/^https:\/\//i.test(baseUrl)) {
  console.error('Usage: npm run check:remote -- https://your-production-domain');
  process.exit(2);
}

const pageRoutes = [
  '/', '/dashboard/', '/dashboard/land-crops/', '/dashboard/climate-risk/',
  '/dashboard/inputs-practices/', '/dashboard/district-explorer/',
  '/dashboard/forecasting/', '/dashboard/forecasting/analysis/', '/dashboard/loss-planner/',
  '/account/login', '/account/signup', '/admin/login'
];
const apiRoutes = [
  '/api/health', '/api/metadata', '/api/overview?year=2025&season=all',
  '/api/timeseries?districtCode=all', '/api/forecast',
  '/api/loss-planner/baseline?years=2025&seasons=all', '/api/landing/summary',
  '/api/rwanda-districts'
];
const failed = [];
const skipped = [];
const measurements = [];

function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else { failed.push(message); console.error(`FAIL ${message}`); }
}

async function request(route, init = {}) {
  const start = performance.now();
  const response = await fetch(new URL(route, `${baseUrl}/`), {
    redirect: 'manual',
    ...init,
    headers: { 'accept-encoding': 'gzip', ...(init.headers || {}) }
  });
  const body = await response.arrayBuffer();
  const elapsedMs = performance.now() - start;
  check(body.byteLength <= 4 * 1024 * 1024, `${route} response <= 4 MB (${body.byteLength} bytes)`);
  measurements.push({ route, status: response.status, elapsedMs, bodyBytes: body.byteLength, headers: response.headers });
  return { response, body: Buffer.from(body), elapsedMs };
}

async function crawlPages() {
  for (const route of pageRoutes) {
    const { response, body } = await request(route);
    check(response.status === 200, `${route} resolves (${response.status})`);
    if (!/text\/html/i.test(response.headers.get('content-type') || '')) continue;
    const html = body.toString('utf8');
    for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
      const href = match[1].split(/[?#]/)[0];
      if (!href || /^(?:[a-z]+:|\/\/|#)/i.test(href) || href.startsWith('/api/')) continue;
      const localRoute = href.startsWith('/') ? href : new URL(href, new URL(route, baseUrl)).pathname;
      const target = await fetch(new URL(localRoute, `${baseUrl}/`), { method: 'HEAD', redirect: 'manual' });
      check(target.status >= 200 && target.status < 400, `link ${localRoute} from ${route} resolves (${target.status})`);
    }
  }
}

async function apiSuite() {
  for (const [route, expectedStatus] of apiRoutes.map((route) => [route, 200])) {
    const result = await request(route);
    check(result.response.status === expectedStatus, `${route} API status ${result.response.status}`);
  }
  for (const route of ['/api/data-export/2025', '/api/data-export/all']) {
    const result = await request(route);
    check([301, 302, 307, 308].includes(result.response.status), `${route} redirects to CDN export (${result.response.status})`);
    check((result.response.headers.get('location') || '').startsWith('/downloads/'), `${route} points to a static download`);
  }
  const publicPath = '/api/overview?year=2025&season=all';
  await request(publicPath);
  const second = await request(publicPath);
  check(second.response.headers.get('x-vercel-cache') === 'HIT', `${publicPath} second request x-vercel-cache HIT`);
  for (const privatePath of ['/api/auth/me', '/api/admin/overview']) {
    const result = await request(privatePath);
    check(/no-store/i.test(result.response.headers.get('cache-control') || ''), `${privatePath} is no-store`);
    check(!/HIT/i.test(result.response.headers.get('x-vercel-cache') || ''), `${privatePath} is never a CDN HIT`);
  }
  const data = measurements.filter((entry) => entry.route.startsWith('/api/') && entry.response === undefined);
  void data;
}

async function demoFarmerFlow() {
  const identity = process.env.DEMO_FARMER_IDENTITY;
  const password = process.env.DEMO_FARMER_PASSWORD;
  if (!identity || !password) {
    check(false, 'demo farmer login requires DEMO_FARMER_IDENTITY and DEMO_FARMER_PASSWORD in the local shell');
    return;
  }
  const origin = new URL(baseUrl).origin;
  const login = await fetch(new URL('/api/auth/login', `${baseUrl}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ identity, password }),
    redirect: 'manual'
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  check(login.status === 200 && Boolean(cookie), 'demo farmer login succeeds and sets a session cookie');
  if (!cookie) return;
  const session = await fetch(new URL('/api/auth/me', `${baseUrl}/`), { headers: { cookie } });
  check(session.status === 200, 'demo farmer session is valid');
  const logout = await fetch(new URL('/api/auth/logout', `${baseUrl}/`), { method: 'POST', headers: { cookie, origin } });
  check(logout.status === 200, 'demo farmer logout succeeds');
}

async function browserWalk() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    skipped.push('Playwright interaction walk (install playwright and its Chromium browser)');
    return;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      for (const route of pageRoutes) {
        const response = await page.goto(new URL(route, `${baseUrl}/`).href, { waitUntil: 'networkidle', timeout: 30000 });
        check(response?.status() === 200, `browser ${viewport.width}px ${route} loads`);
        check(consoleErrors.length === 0, `browser ${viewport.width}px ${route} has no page errors`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
}

async function lighthouse() {
  let lighthouseRunner;
  try { lighthouseRunner = require('lighthouse').default || require('lighthouse'); } catch {
    skipped.push('Lighthouse per-page metrics (install lighthouse and Chrome/Chromium)');
    return;
  }
  let chromeLauncher;
  try { chromeLauncher = require('chrome-launcher'); } catch {
    skipped.push('Lighthouse per-page metrics (chrome-launcher is not installed)');
    return;
  }
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  try {
    for (const route of pageRoutes) {
      const result = await lighthouseRunner(new URL(route, `${baseUrl}/`).href, { port: chrome.port, output: 'json', onlyCategories: ['performance'] });
      const audits = result.lhr.audits;
      const metrics = {
        ttfbMs: audits['server-response-time']?.numericValue,
        lcpMs: audits['largest-contentful-paint']?.numericValue,
        tbtMs: audits['total-blocking-time']?.numericValue,
        cls: audits['cumulative-layout-shift']?.numericValue
      };
      console.log(`LIGHTHOUSE ${route} ${JSON.stringify(metrics)}`);
      check(metrics.lcpMs <= 2500, `${route} LCP <= 2.5s`);
      check(metrics.tbtMs <= 200, `${route} TBT <= 200ms`);
      check(metrics.cls <= 0.1, `${route} CLS <= 0.1`);
    }
  } finally { await chrome.kill(); }
}

async function main() {
  console.log(`Remote readiness check: ${baseUrl}`);
  await crawlPages();
  await apiSuite();
  await demoFarmerFlow();
  const firstLanding = measurements.find((entry) => entry.route === '/api/landing/summary');
  if (firstLanding) console.log(`First-request landing summary: ${firstLanding.elapsedMs.toFixed(1)}ms`);
  await browserWalk();
  await lighthouse();
  for (const item of skipped) console.warn(`SKIP ${item}`);
  console.log(`Remote check totals: ${measurements.length} HTTP measurements, ${failed.length} failures, ${skipped.length} skipped capabilities.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Remote check error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
