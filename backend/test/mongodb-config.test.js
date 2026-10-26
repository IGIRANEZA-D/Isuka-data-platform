const test = require('node:test');
const assert = require('node:assert/strict');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/isuka';
process.env.MONGODB_DATABASE = 'isuka';
process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS = '250';
process.env.MONGODB_CONNECT_TIMEOUT_MS = '200';
process.env.MONGODB_RECONNECT_COOLDOWN_MS = '1000';
const {
  getMongoConfiguration,
  validateProductionMongoConfiguration,
  getDatabase,
  closeDatabase,
  getDatabaseConnectionStatus
} = require('../src/data/mongodb');

test('uses bounded MongoDB timeouts and pool sizes by default', () => {
  const configuration = getMongoConfiguration({});

  assert.equal(configuration.clientOptions.serverSelectionTimeoutMS, 5000);
  assert.equal(configuration.clientOptions.connectTimeoutMS, 5000);
  assert.equal(configuration.clientOptions.waitQueueTimeoutMS, 5000);
  assert.equal(configuration.clientOptions.maxPoolSize, 10);
  assert.equal(configuration.clientOptions.minPoolSize, 0);
  assert.equal(configuration.clientOptions.tlsAllowInvalidCertificates, false);
});

test('accepts valid positive integer connection settings and rejects invalid values', () => {
  const configuration = getMongoConfiguration({
    MONGODB_URI: 'mongodb+srv://user:password@example.mongodb.net/isuka',
    MONGODB_DATABASE: 'isuka',
    MONGODB_MAX_POOL_SIZE: '24',
    MONGODB_MIN_POOL_SIZE: '2',
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: '12000'
  });

  assert.equal(configuration.clientOptions.tls, true);
  assert.equal(configuration.clientOptions.maxPoolSize, 24);
  assert.equal(configuration.clientOptions.minPoolSize, 2);
  assert.equal(configuration.clientOptions.serverSelectionTimeoutMS, 12000);
  assert.throws(
    () => getMongoConfiguration({ MONGODB_MAX_POOL_SIZE: '0' }),
    /MONGODB_MAX_POOL_SIZE must be an integer/
  );
  assert.throws(
    () => getMongoConfiguration({ MONGODB_MAX_POOL_SIZE: '4', MONGODB_MIN_POOL_SIZE: '5' }),
    /MONGODB_MIN_POOL_SIZE cannot exceed/
  );
});

test('requires an explicit remote database configuration in production', () => {
  assert.throws(
    () => validateProductionMongoConfiguration({}),
    /MONGODB_URI must be set/
  );
  assert.throws(
    () => validateProductionMongoConfiguration({
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DATABASE: 'isuka'
    }),
    /must not point to localhost/
  );
  assert.doesNotThrow(() => validateProductionMongoConfiguration({
    MONGODB_URI: 'mongodb+srv://user:password@example.mongodb.net/isuka',
    MONGODB_DATABASE: 'isuka'
  }));
});

test('cools down after a failed connection instead of retrying for every request', async () => {
  const attempts = await Promise.allSettled([getDatabase(), getDatabase()]);

  assert.equal(attempts[0].status, 'rejected');
  assert.equal(attempts[1].status, 'rejected');
  assert.equal(attempts[0].reason, attempts[1].reason);
  assert.ok(getDatabaseConnectionStatus().retryAfterMs > 0);

  const retryStartedAt = Date.now();
  await assert.rejects(getDatabase());
  assert.ok(Date.now() - retryStartedAt < 100);
  await closeDatabase();
});
