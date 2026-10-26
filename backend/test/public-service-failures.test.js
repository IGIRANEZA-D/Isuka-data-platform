const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/isuka';
process.env.MONGODB_DATABASE = 'isuka';
process.env.SESSION_SECRET = 'unit-test-session-secret';
process.env.PUBLIC_BASE_URL = 'https://isuka.example.test';
process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS = '200';
process.env.MONGODB_CONNECT_TIMEOUT_MS = '150';
process.env.MONGODB_RECONNECT_COOLDOWN_MS = '1000';

const app = require('../src/server');
const { closeDatabase } = require('../src/data/mongodb');

test('keeps MongoDB diagnostics in server logs while serving public data and safe account errors', async (context) => {
  const server = app.listen(0, '127.0.0.1');
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabase();
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const dashboardPage = await fetch(`${baseUrl}/dashboard/`);
  const dashboardHtml = await dashboardPage.text();
  assert.equal(dashboardPage.status, 200);
  assert.equal(dashboardHtml.includes('data-database-status'), false);
  assert.equal(dashboardHtml.includes('MongoDB connected'), false);

  const healthResponse = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
  const health = await healthResponse.json();
  assert.equal(health.status, 'degraded');
  assert.equal(Object.hasOwn(health, 'database'), false);
  assert.equal(JSON.stringify(health).toLowerCase().includes('mongodb'), false);

  const dashboardResponse = await fetch(`${baseUrl}/api/overview?year=all&district=all`, { cache: 'no-store' });
  const overview = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.ok(overview.filters.availableYears.length > 0);
  assert.ok(overview.kpis.weightedProductionKg > 0);

  const allSeasonsResponse = await fetch(`${baseUrl}/api/overview?year=2021&district=all&season=all`, { cache: 'no-store' });
  const allSeasonsOverview = await allSeasonsResponse.json();
  assert.equal(allSeasonsResponse.status, 200);
  assert.equal(allSeasonsOverview.period.year, 2021);
  assert.equal(allSeasonsOverview.filters.season, 'all');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'farmer@example.com', password: 'diagnostic-password' })
  });
  const login = await loginResponse.json();
  assert.equal(loginResponse.status, 503);
  assert.equal(login.error, 'Account services are temporarily unavailable. Please try again shortly.');
  assert.equal(JSON.stringify(login).toLowerCase().includes('mongodb'), false);
  assert.equal(JSON.stringify(login).toLowerCase().includes('tls'), false);

  const registrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'farmer@example.com', phone: '+250788000000', password: 'diagnostic-password' })
  });
  const registration = await registrationResponse.json();
  assert.equal(registrationResponse.status, 503);
  assert.equal(registration.error, 'Account services are temporarily unavailable. Please try again shortly.');
  assert.equal(JSON.stringify(registration).toLowerCase().includes('mongodb'), false);
  assert.equal(JSON.stringify(registration).toLowerCase().includes('tls'), false);
});
