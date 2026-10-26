const { getDatabase, collections } = require('./mongodb');
let initializationPromise;

const schemas = {
  users: {
    bsonType: 'object',
    required: ['email', 'role', 'passwordHash', 'createdAt', 'updatedAt'],
    properties: {
      email: { bsonType: 'string' },
      phone: { bsonType: 'string' },
      role: { enum: ['farmer', 'admin', 'analyst'] },
      passwordHash: { bsonType: 'string' },
      profile: { bsonType: 'object' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }
    }
  },
  sessions: { bsonType: 'object', required: ['userId', 'tokenHash', 'expiresAt', 'createdAt'], properties: { userId: { bsonType: 'objectId' }, tokenHash: { bsonType: 'string' }, expiresAt: { bsonType: 'date' }, createdAt: { bsonType: 'date' } } },
  passwordResets: { bsonType: 'object', required: ['userId', 'expiresAt', 'createdAt'], properties: { userId: { bsonType: 'objectId' }, codeHash: { bsonType: 'string' }, tokenHash: { bsonType: 'string' }, expiresAt: { bsonType: 'date' }, attempts: { bsonType: 'int' }, createdAt: { bsonType: 'date' }, usedAt: { bsonType: 'date' } } },
  farmRecords: { bsonType: 'object', required: ['userId', 'recordType', 'data', 'createdAt', 'updatedAt'], properties: { userId: { bsonType: 'objectId' }, recordType: { enum: ['crop', 'animal', 'group'] }, data: { bsonType: 'object' }, version: { bsonType: 'int', minimum: 1 }, createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' } } },
  alerts: { bsonType: 'object', required: ['userId', 'title', 'read', 'createdAt'], properties: { userId: { bsonType: 'objectId' }, title: { bsonType: 'string' }, read: { bsonType: 'bool' }, data: { bsonType: 'object' }, createdAt: { bsonType: 'date' } } },
  assistantMessages: { bsonType: 'object', required: ['userId', 'message', 'answer', 'createdAt'], properties: { userId: { bsonType: 'objectId' }, conversationId: { bsonType: 'string' }, conversationTitle: { bsonType: 'string' }, message: { bsonType: 'string' }, answer: { bsonType: 'string' }, createdAt: { bsonType: 'date' } } },
  datasets: {
    bsonType: 'object',
    required: ['title', 'status', 'datasetType', 'ownerType', 'createdAt', 'updatedAt'],
    properties: {
      userId: { bsonType: ['objectId', 'string'] },
      farmId: { bsonType: ['objectId', 'string', 'null'] },
      organizationId: { bsonType: ['objectId', 'string', 'null'] },
      title: { bsonType: 'string' },
      description: { bsonType: 'string' },
      fileName: { bsonType: 'string' },
      storagePath: { bsonType: 'string' },
      fileHash: { bsonType: 'string' },
      sourceType: { enum: ['upload', 'api', 'manual_import', 'external'] },
      ownerType: { enum: ['farmer', 'admin', 'institution'] },
      datasetType: { enum: ['climate', 'land', 'crop', 'yield', 'forecast', 'practice', 'rainfall', 'admin_summary'] },
      status: { enum: ['draft', 'queued', 'validating', 'needs_review', 'rejected', 'approved', 'published', 'archived', 'deleted'] },
      validationStatus: { enum: ['unread', 'readable', 'warning', 'invalid', 'accepted'] },
      currentVersion: { bsonType: 'int', minimum: 1 },
      publicVersion: { bsonType: ['int', 'null'], minimum: 1 },
      isPublic: { bsonType: 'bool' },
      approvedBy: { bsonType: ['objectId', 'string', 'null'] },
      approvedAt: { bsonType: ['date', 'null'] },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
      deletedAt: { bsonType: ['date', 'null'] }
    }
  },
  datasetVersions: {
    bsonType: 'object',
    required: ['datasetId', 'version', 'fileName', 'storagePath', 'fileHash', 'status', 'createdAt'],
    properties: {
      datasetId: { bsonType: ['objectId', 'string'] },
      version: { bsonType: 'int', minimum: 1 },
      fileName: { bsonType: 'string' },
      storagePath: { bsonType: 'string' },
      fileHash: { bsonType: 'string' },
      schemaSummary: { bsonType: 'object' },
      rowCount: { bsonType: 'int', minimum: 0 },
      status: { enum: ['draft', 'queued', 'validating', 'approved', 'published', 'rejected', 'archived'] },
      createdAt: { bsonType: 'date' },
      publishedAt: { bsonType: ['date', 'null'] },
      notes: { bsonType: 'string' }
    }
  },
  datasetValidationReports: {
    bsonType: 'object',
    required: ['datasetId', 'version', 'status', 'readabilityScore', 'schemaScore', 'completenessScore', 'fitScore', 'warnings', 'createdAt'],
    properties: {
      datasetId: { bsonType: ['objectId', 'string'] },
      version: { bsonType: 'int', minimum: 1 },
      status: { enum: ['pass', 'warn', 'fail', 'needs_review'] },
      readabilityScore: { bsonType: 'int', minimum: 0, maximum: 100 },
      schemaScore: { bsonType: 'int', minimum: 0, maximum: 100 },
      completenessScore: { bsonType: 'int', minimum: 0, maximum: 100 },
      fitScore: { bsonType: 'int', minimum: 0, maximum: 100 },
      warnings: { bsonType: 'array' },
      issues: { bsonType: 'object' },
      aiSummary: { bsonType: 'string' },
      aiRecommendation: { bsonType: ['string', 'null'] },
      rowCount: { bsonType: 'int', minimum: 0 },
      validRows: { bsonType: 'int', minimum: 0 },
      invalidRows: { bsonType: 'int', minimum: 0 },
      missingValueRate: { bsonType: 'number' },
      outlierRate: { bsonType: 'number' },
      createdAt: { bsonType: 'date' },
      reviewedBy: { bsonType: ['objectId', 'string', 'null'] }
    }
  },
  aiReviewJobs: {
    bsonType: 'object',
    required: ['datasetId', 'version', 'jobType', 'status', 'createdAt'],
    properties: {
      datasetId: { bsonType: ['objectId', 'string'] },
      version: { bsonType: 'int', minimum: 1 },
      jobType: { enum: ['dataset_summary', 'fit_review', 'anomaly_explanation'] },
      status: { enum: ['queued', 'running', 'completed', 'failed'] },
      promptVersion: { bsonType: 'string' },
      resultSummary: { bsonType: 'string' },
      outputJson: { bsonType: 'object' },
      createdAt: { bsonType: 'date' },
      completedAt: { bsonType: ['date', 'null'] },
      errorMessage: { bsonType: ['string', 'null'] }
    }
  },
  dashboardSnapshots: {
    bsonType: 'object',
    required: ['datasetId', 'version', 'snapshotType', 'generatedAt', 'isActive'],
    properties: {
      datasetId: { bsonType: ['objectId', 'string'] },
      version: { bsonType: 'int', minimum: 1 },
      snapshotType: { enum: ['overview', 'district_explorer', 'climate_risk', 'forecasting', 'land_crops', 'inputs_practices'] },
      metricsHash: { bsonType: 'string' },
      summaryJson: { bsonType: 'object' },
      generatedAt: { bsonType: 'date' },
      publishedAt: { bsonType: ['date', 'null'] },
      isActive: { bsonType: 'bool' }
    }
  },
  adminReviewQueue: {
    bsonType: 'object',
    required: ['datasetId', 'reviewStatus', 'createdAt'],
    properties: {
      datasetId: { bsonType: ['objectId', 'string'] },
      assignedAdminId: { bsonType: ['objectId', 'string', 'null'] },
      reviewStatus: { enum: ['pending', 'in_review', 'approved', 'rejected', 'needs_update'] },
      reviewNotes: { bsonType: 'string' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }
    }
  },
  uploads: {
    bsonType: 'object',
    required: ['datasetKey', 'originalName', 'storedPath', 'status', 'createdAt'],
    properties: {
      datasetKey: { bsonType: 'string' },
      originalName: { bsonType: 'string' },
      storedPath: { bsonType: 'string' },
      status: { enum: ['received', 'validated', 'published', 'rejected'] },
      createdAt: { bsonType: 'date' }
    }
  },
  validationReports: {
    bsonType: 'object',
    required: ['datasetKey', 'status', 'rowsRead', 'rowsUsed', 'invalidRows', 'warnings', 'createdAt'],
    properties: {
      datasetKey: { bsonType: 'string' },
      status: { enum: ['passed', 'warning', 'failed'] },
      rowsRead: { bsonType: 'int', minimum: 0 },
      rowsUsed: { bsonType: 'int', minimum: 0 },
      invalidRows: { bsonType: 'int', minimum: 0 },
      warnings: { bsonType: 'array' },
      createdAt: { bsonType: 'date' }
    }
  }
};

async function ensureCollection(database, name, validator) {
  try {
    await database.createCollection(name, { validator: { $jsonSchema: validator }, validationLevel: 'strict', validationAction: 'error' });
  } catch (error) {
    if (error.codeName !== 'NamespaceExists') throw error;
    await database.command({ collMod: name, validator: { $jsonSchema: validator }, validationLevel: 'strict', validationAction: 'error' });
  }
}

async function removeObsoleteDatasetIndexes(collection) {
  const indexes = await collection.listIndexes().toArray();
  const obsoleteKeyIndex = indexes.find((index) => index.name === 'key_1');
  if (obsoleteKeyIndex) await collection.dropIndex(obsoleteKeyIndex.name);
}

async function initializeDatabase() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const database = await getDatabase();
      await Promise.all(Object.entries(schemas).map(([name, validator]) => ensureCollection(database, name, validator)));
      const databaseCollections = collections(database);
      await removeObsoleteDatasetIndexes(databaseCollections.datasets);
      await Promise.all([
        databaseCollections.users.createIndex({ email: 1 }, { unique: true }),
        databaseCollections.users.createIndex({ phone: 1 }, { unique: true, sparse: true }),
        databaseCollections.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
        databaseCollections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        databaseCollections.passwordResets.createIndex({ userId: 1, createdAt: -1 }),
        databaseCollections.passwordResets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        databaseCollections.farmRecords.createIndex({ userId: 1, recordType: 1, 'data.archived': 1, updatedAt: -1 }),
        databaseCollections.alerts.createIndex({ userId: 1, read: 1, deletedAt: 1, createdAt: -1 }),
        databaseCollections.alerts.createIndex({ userId: 1, id: 1 }, { unique: true, sparse: true }),
        databaseCollections.assistantMessages.createIndex({ userId: 1, conversationId: 1, createdAt: -1 }),
        databaseCollections.datasets.createIndex({ userId: 1, status: 1, createdAt: -1 }),
        databaseCollections.datasets.createIndex({ datasetType: 1, status: 1, createdAt: -1 }),
        databaseCollections.datasets.createIndex({ isPublic: 1, publicVersion: 1, createdAt: -1 }),
        databaseCollections.datasetVersions.createIndex({ datasetId: 1, version: 1 }, { unique: true }),
        databaseCollections.datasetVersions.createIndex({ datasetId: 1, createdAt: -1 }),
        databaseCollections.datasetValidationReports.createIndex({ datasetId: 1, version: 1 }, { unique: true }),
        databaseCollections.datasetValidationReports.createIndex({ datasetId: 1, createdAt: -1 }),
        databaseCollections.aiReviewJobs.createIndex({ datasetId: 1, version: 1, status: 1 }),
        databaseCollections.dashboardSnapshots.createIndex({ datasetId: 1, version: 1, snapshotType: 1 }),
        databaseCollections.dashboardSnapshots.createIndex({ isActive: 1, publishedAt: -1 }),
        databaseCollections.adminReviewQueue.createIndex({ datasetId: 1 }, { unique: true }),
        databaseCollections.adminReviewQueue.createIndex({ reviewStatus: 1, createdAt: -1 }),
        databaseCollections.uploads.createIndex({ datasetKey: 1, createdAt: -1 }),
        databaseCollections.validationReports.createIndex({ datasetKey: 1, createdAt: -1 })
      ]);
      return databaseCollections;
    })().catch((error) => {
      initializationPromise = undefined;
      throw error;
    });
  }
  return initializationPromise;
}

module.exports = { initializeDatabase };
