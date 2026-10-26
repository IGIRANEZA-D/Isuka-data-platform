const { MongoClient } = require('mongodb');

function readIntegerSetting(environment, name, fallback, minimum = 1) {
  const rawValue = environment[name];
  if (rawValue == null || rawValue === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function getMongoConfiguration(environment = process.env) {
  const uri = environment.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const databaseName = environment.MONGODB_DATABASE || 'isuka';
  const useTls = /^mongodb\+srv:/i.test(uri) || String(environment.MONGODB_TLS || '').toLowerCase() === 'true';
  // On Vercel each warm instance is independent; cap the pool to avoid
  // saturating Atlas free-tier connections across many concurrent instances.
  const defaultMaxPool = environment.VERCEL ? 5 : 10;
  const maxPoolSize = readIntegerSetting(environment, 'MONGODB_MAX_POOL_SIZE', defaultMaxPool);
  const minPoolSize = readIntegerSetting(environment, 'MONGODB_MIN_POOL_SIZE', 0, 0);
  if (minPoolSize > maxPoolSize) {
    throw new Error('MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE.');
  }

  return {
    uri,
    databaseName,
    reconnectCooldownMs: readIntegerSetting(environment, 'MONGODB_RECONNECT_COOLDOWN_MS', 2000),
    clientOptions: {
      serverSelectionTimeoutMS: readIntegerSetting(environment, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 5000),
      connectTimeoutMS: readIntegerSetting(environment, 'MONGODB_CONNECT_TIMEOUT_MS', 5000),
      socketTimeoutMS: readIntegerSetting(environment, 'MONGODB_SOCKET_TIMEOUT_MS', 15000),
      waitQueueTimeoutMS: readIntegerSetting(environment, 'MONGODB_WAIT_QUEUE_TIMEOUT_MS', 5000),
      maxPoolSize,
      minPoolSize,
      // On Vercel keep idle connections short so they are released before the
      // instance is frozen; 30 s is well within a typical execution window.
      maxIdleTimeMS: readIntegerSetting(environment, 'MONGODB_MAX_IDLE_TIME_MS', environment.VERCEL ? 30000 : 60000),
      retryWrites: true,
      retryReads: true,
      tls: useTls,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false
    }
  };
}

function validateProductionMongoConfiguration(environment = process.env) {
  if (!environment.MONGODB_URI?.trim()) {
    throw new Error('MONGODB_URI must be set when NODE_ENV=production.');
  }
  if (!environment.MONGODB_DATABASE?.trim()) {
    throw new Error('MONGODB_DATABASE must be set when NODE_ENV=production.');
  }

  const { uri } = getMongoConfiguration(environment);
  let parsedUri;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error('MONGODB_URI must be a valid MongoDB connection URI.');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol)) {
    throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// protocol.');
  }
  const hostname = parsedUri.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('MONGODB_URI must not point to localhost when NODE_ENV=production.');
  }
}

const configuration = getMongoConfiguration();
let client;
let database;
let connectionPromise;
let connecting = false;
let retryAt = 0;
let lastConnectionError;

async function getDatabase() {
  if (database) return database;
  if (connectionPromise) return connectionPromise;
  if (Date.now() < retryAt) throw lastConnectionError;

  const nextClient = new MongoClient(configuration.uri, configuration.clientOptions);
  connecting = true;
  const pendingConnection = nextClient.connect().then(() => {
    client = nextClient;
    database = nextClient.db(configuration.databaseName);
    connecting = false;
    retryAt = 0;
    lastConnectionError = undefined;
    nextClient.on('close', () => {
      if (client === nextClient) {
        client = undefined;
        database = undefined;
        connectionPromise = undefined;
        connecting = false;
      }
    });
    return database;
  }).catch(async (error) => {
    connecting = false;
    retryAt = Date.now() + configuration.reconnectCooldownMs;
    lastConnectionError = error;
    if (connectionPromise === pendingConnection) connectionPromise = undefined;
    try {
      await nextClient.close();
    } catch (closeError) {
      error.cleanupError = closeError;
    }
    throw error;
  });
  connectionPromise = pendingConnection;
  return pendingConnection;
}

async function closeDatabase() {
  const pendingConnection = connectionPromise;
  if (pendingConnection) {
    try {
      await pendingConnection;
    } catch (error) {
      if (!client) {
        connectionPromise = undefined;
        retryAt = 0;
        lastConnectionError = undefined;
        return;
      }
      throw error;
    }
  }
  if (client) await client.close();
  client = undefined;
  database = undefined;
  connectionPromise = undefined;
  connecting = false;
  retryAt = 0;
  lastConnectionError = undefined;
}

async function withTransaction(work) {
  await getDatabase();
  if (!client) throw new Error('MongoDB client is not connected.');
  const session = client.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

function collections(databaseInstance) {
  return {
    users: databaseInstance.collection('users'),
    sessions: databaseInstance.collection('sessions'),
    passwordResets: databaseInstance.collection('passwordResets'),
    farmRecords: databaseInstance.collection('farmRecords'),
    alerts: databaseInstance.collection('alerts'),
    assistantMessages: databaseInstance.collection('assistantMessages'),
    datasets: databaseInstance.collection('datasets'),
    datasetVersions: databaseInstance.collection('datasetVersions'),
    datasetValidationReports: databaseInstance.collection('datasetValidationReports'),
    aiReviewJobs: databaseInstance.collection('aiReviewJobs'),
    dashboardSnapshots: databaseInstance.collection('dashboardSnapshots'),
    adminReviewQueue: databaseInstance.collection('adminReviewQueue'),
    uploads: databaseInstance.collection('uploads'),
    validationReports: databaseInstance.collection('validationReports')
  };
}

function getDatabaseConnectionStatus() {
  return {
    connected: Boolean(database),
    connecting,
    retryAfterMs: Math.max(0, retryAt - Date.now())
  };
}

module.exports = {
  getDatabase,
  closeDatabase,
  withTransaction,
  collections,
  databaseName: configuration.databaseName,
  getMongoConfiguration,
  validateProductionMongoConfiguration,
  getDatabaseConnectionStatus
};
