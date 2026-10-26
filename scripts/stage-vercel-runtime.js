'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

assert.equal(process.env.VERCEL, '1');
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.MONGODB_URI, undefined);
const appRoot = process.env.STAGE_APP_ROOT || '/app';
if (process.env.STAGE_READ_ONLY === '1') {
  assert.equal(fs.existsSync('/usr/bin/python'), false, 'Python must not exist in the staged image');
  assert.throws(() => fs.writeFileSync(path.join(appRoot, '.stage-write-check'), 'blocked'), /read-only|EROFS|permission/i);
}
assert.equal(fs.existsSync(path.join(appRoot, 'www', 'Datasets(2020-2025)')), false, 'Raw source data must not be staged');
assert.equal(fs.existsSync(path.join(appRoot, '.env')), false, 'No .env file may be staged');
const tempProbe = path.join(os.tmpdir(), 'isuka-stage-write-check');
fs.writeFileSync(tempProbe, 'ephemeral');
fs.rmSync(tempProbe, { force: true });

const app = require(path.join(appRoot, 'api', 'index.js'));
const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'vercel.json'), 'utf8'));
const server = http.createServer(app);
const staticRoot = path.join(appRoot, 'public');

function resolveStaticRoute(route) {
  route = decodeURIComponent(route);
  const rewrite = config.rewrites.find((entry) => entry.source === route);
  if (rewrite && !rewrite.destination.startsWith('/api/')) return path.join(staticRoot, rewrite.destination);
  const relative = route === '/' ? 'index.html' : route.replace(/^\//, '');
  const candidate = path.join(staticRoot, relative);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (fs.existsSync(path.join(candidate, 'index.html'))) return path.join(candidate, 'index.html');
  return null;
}

function checkStaticRoutes() {
  const pageRoutes = config.rewrites.filter((entry) => !entry.destination.startsWith('/api/'));
  for (const entry of pageRoutes) assert.ok(fs.existsSync(path.join(staticRoot, entry.destination)), `Missing static rewrite destination ${entry.destination}`);
  for (const required of ['/index.html', '/404.html', '/500.html']) assert.ok(fs.existsSync(path.join(staticRoot, required.slice(1))), `Missing public file ${required}`);
  for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) assert.ok(fs.existsSync(path.join(staticRoot, 'downloads', `isuka-cleaned-agricultural-dataset-${year}.csv`)));
  assert.ok(fs.existsSync(path.join(staticRoot, 'downloads', 'isuka-cleaned-agricultural-datasets-2020-2025.zip')));
  const htmlFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.name.endsWith('.html')) htmlFiles.push(filePath);
    }
  }
  visit(staticRoot);
  for (const filePath of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
      const value = match[1];
      const route = value.split(/[?#]/)[0];
      if (!route || /^(?:[a-z]+:|\/\/|#)/i.test(route)) continue;
      if (route.startsWith('/api/')) continue;
      if (route.startsWith('/')) assert.ok(resolveStaticRoute(route), `Broken local link ${route} in ${path.relative(staticRoot, filePath)}`);
      else assert.ok(fs.existsSync(path.resolve(path.dirname(filePath), route)), `Broken relative link ${route} in ${path.relative(staticRoot, filePath)}`);
    }
  }
  process.stdout.write(`[stage:vercel] Static route and HTML link walk passed (${pageRoutes.length} rewrites, ${htmlFiles.length} HTML files).\n`);
}

async function get(base, route) {
  const startedAt = Date.now();
  const response = await fetch(`${base}${route}`, { headers: { 'accept-encoding': 'gzip' } });
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) <= 4 * 1024 * 1024, `Response too large: ${route}`);
  return { response, body, elapsedMs: Date.now() - startedAt };
}

async function main() {
  checkStaticRoutes();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const expected = [
    ['/api/health', 200],
    ['/api/metadata', 200],
    ['/api/overview?year=2025&season=A', 200],
    ['/api/timeseries?districtCode=all', 200],
    ['/api/forecast', 200],
    ['/api/loss-planner/baseline?years=2025&seasons=A', 200],
    ['/api/landing/summary', 200],
    ['/api/rwanda-districts', 200],
    ['/api/data-export/2025', 301],
    ['/api/data-export/all', 301],
    ['/api/not-a-route', 404],
    ['/api/auth/me', 503]
  ];
  let coldRequestMs = 0;
  try {
    for (const [route, status] of expected) {
      const result = await get(base, route);
      assert.equal(result.response.status, status, `${route} status`);
      assert.ok(result.response.headers.get('x-request-id'), `${route} request id`);
      if (route.startsWith('/api/overview')) {
        assert.match(result.response.headers.get('cache-control') || '', /s-maxage=300/);
        assert.ok(result.response.headers.get('etag'), 'public overview ETag');
      }
      if (route === '/api/auth/me') {
        assert.match(result.response.headers.get('cache-control') || '', /no-store/);
        assert.equal(result.response.headers.get('retry-after'), '5');
      }
      if (route === '/api/not-a-route') assert.match(result.body, /"error":"Not found\."/);
      if (route.startsWith('/api/landing/')) coldRequestMs = result.elapsedMs;
      process.stdout.write(`[stage:vercel] ${result.response.status} ${result.elapsedMs}ms ${route}\n`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  process.stdout.write(`[stage:vercel] First landing-data request: ${coldRequestMs}ms\n`);
  const maxRssMiB = process.resourceUsage().maxRSS / 1024;
  process.stdout.write(`[stage:vercel] Node max RSS: ${maxRssMiB.toFixed(1)} MiB / 2048 MiB\n`);
  assert.ok(maxRssMiB <= 1433.6, 'Peak RSS exceeded 70% of the configured 2 GiB function memory.');
}

main().catch((error) => {
  process.stderr.write(`[stage:vercel] FAIL: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
