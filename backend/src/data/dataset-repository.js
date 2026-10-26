const { ObjectId } = require('mongodb');
const { initializeDatabase } = require('./database');
const { withTransaction } = require('./mongodb');
const { buildDatasetAcceptanceDecision } = require('./dataset-quality-model');

function createDatasetUploadRecord({
  userId,
  farmId = null,
  organizationId = null,
  title,
  description = '',
  year = null,
  season = null,
  datasetType = 'climate',
  fileName,
  storagePath,
  fileHash,
  sourceType = 'upload',
  ownerType = 'farmer',
  status = 'draft',
  validationStatus = 'unread',
  isPublic = false,
  currentVersion = 1,
  publicVersion = null
}) {
  const now = new Date();
  return {
    userId,
    farmId,
    organizationId,
    title,
    description,
    year: year === null || year === undefined || year === '' ? null : Number(year),
    season: season ? String(season).replace(/^Season\s+/i, '').toUpperCase() : null,
    fileName,
    storagePath,
    fileHash,
    sourceType,
    ownerType,
    datasetType,
    status,
    validationStatus,
    currentVersion,
    publicVersion,
    isPublic,
    createdAt: now,
    updatedAt: now,
    approvedBy: null,
    approvedAt: null,
    deletedAt: null
  };
}

function buildDatasetVersionRecord({
  datasetId,
  version = 1,
  fileName,
  storagePath,
  fileHash,
  schemaSummary = {},
  rowCount = 0,
  status = 'draft',
  notes = '',
  publishedAt = null
}) {
  return {
    datasetId,
    version,
    fileName,
    storagePath,
    fileHash,
    schemaSummary,
    rowCount,
    status,
    notes,
    createdAt: new Date(),
    publishedAt
  };
}

function buildValidationReportRecord({
  datasetId,
  version = 1,
  readabilityScore = 0,
  schemaScore = 0,
  completenessScore = 0,
  fitScore = 0,
  status = 'warn',
  warnings = [],
  issues = {},
  aiSummary = '',
  aiRecommendation = null,
  rowCount = 0,
  validRows = 0,
  invalidRows = 0,
  acceptedRows = 0,
  duplicateRowsRemoved = 0,
  cleaningActions = [],
  detectedColumns = {},
  periodCheck = {},
  yearsFound = [],
  seasonsFound = [],
  missingValueRate = 0,
  outlierRate = 0,
  reviewedBy = null
}) {
  return {
    datasetId,
    version,
    status,
    readabilityScore,
    schemaScore,
    completenessScore,
    fitScore,
    warnings,
    issues,
    aiSummary,
    aiRecommendation,
    rowCount,
    validRows,
    invalidRows,
    acceptedRows,
    duplicateRowsRemoved,
    cleaningActions,
    detectedColumns,
    periodCheck,
    yearsFound,
    seasonsFound,
    missingValueRate,
    outlierRate,
    createdAt: new Date(),
    reviewedBy
  };
}

function buildAIReviewRecord({
  datasetId,
  version = 1,
  recommendation = 'needs_review',
  summary = '',
  confidence = 0.5,
  details = {},
  jobType = 'dataset_summary',
  status = 'completed'
}) {
  return {
    datasetId,
    version,
    recommendation,
    summary,
    confidence,
    details,
    jobType,
    status,
    createdAt: new Date()
  };
}

function getSubmissionDecision(job) {
  const validationFailed = !job || job.status !== 'completed' || job.outputJson?.validationResult === 'fail';
  const qualityDecision = job?.outputJson?.qualityDecision || null;
  const qualityAccepted = qualityDecision?.accepted === true;
  const aiRejected = ['reject', 'blocked'].includes(job?.outputJson?.aiReview?.recommendation);
  const allowed = !validationFailed && !aiRejected && qualityAccepted;
  return {
    allowed,
    validationFailed,
    aiRejected,
    qualityAccepted,
    reason: !job ? 'Complete validation before submitting this dataset.' : validationFailed ? 'Complete validation before submitting this dataset.' : aiRejected ? 'The AI review blocked this dataset from submission.' : !qualityAccepted ? 'Dataset quality is below the acceptance threshold. Clean and revalidate it before submission.' : null
  };
}

async function saveUpload({ dataset, upload, report }) {
  const databaseCollections = await initializeDatabase();
  const now = new Date();
  await withTransaction(async (session) => {
    await databaseCollections.uploads.insertOne({ ...upload, createdAt: now }, { session });
    await databaseCollections.validationReports.insertOne({ ...report, createdAt: now }, { session });
    await databaseCollections.datasets.updateOne(
      { key: dataset.key },
      { $set: { ...dataset, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, session }
    );
  });
}

async function saveDatasetLifecycle({ dataset, version, validationReport, aiReview }) {
  const databaseCollections = await initializeDatabase();
  const now = new Date();
  let datasetId = dataset?._id || dataset?.id || null;

  const datasetRecord = {
    ...(dataset || createDatasetUploadRecord({
      userId: dataset?.userId,
      farmId: dataset?.farmId,
      organizationId: dataset?.organizationId,
      title: dataset?.title || 'Untitled dataset',
      description: dataset?.description || '',
      datasetType: dataset?.datasetType || 'climate',
      fileName: dataset?.fileName || 'dataset.csv',
      storagePath: dataset?.storagePath || '/uploads/dataset.csv',
      fileHash: dataset?.fileHash || 'unknown',
      sourceType: dataset?.sourceType || 'upload',
      ownerType: dataset?.ownerType || 'farmer',
      status: dataset?.status || 'draft',
      validationStatus: dataset?.validationStatus || 'unread',
      isPublic: Boolean(dataset?.isPublic),
      currentVersion: dataset?.currentVersion || 1,
      publicVersion: dataset?.publicVersion || null
    })),
    ...dataset
  };

  await withTransaction(async (session) => {
    if (!datasetId) {
      const inserted = await databaseCollections.datasets.insertOne({ ...datasetRecord, createdAt: now, updatedAt: now }, { session });
      datasetId = inserted.insertedId;
    } else {
      await databaseCollections.datasets.updateOne(
        { _id: new ObjectId(String(datasetId)) },
        { $set: { ...datasetRecord, updatedAt: now } },
        { session }
      );
    }

    const versionData = buildDatasetVersionRecord({
      datasetId,
      version: version.version || 1,
      fileName: version.fileName || datasetRecord.fileName,
      storagePath: version.storagePath || datasetRecord.storagePath,
      fileHash: version.fileHash || datasetRecord.fileHash,
      schemaSummary: version.schemaSummary || {},
      rowCount: version.rowCount || 0,
      status: version.status || datasetRecord.status || 'draft',
      notes: version.notes || '',
      publishedAt: version.publishedAt || null
    });

    const reportData = buildValidationReportRecord({
      datasetId,
      version: validationReport.version || 1,
      readabilityScore: validationReport.readabilityScore ?? 0,
      schemaScore: validationReport.schemaScore ?? 0,
      completenessScore: validationReport.completenessScore ?? 0,
      fitScore: validationReport.fitScore ?? 0,
      status: validationReport.status || 'warn',
      warnings: validationReport.warnings || [],
      issues: validationReport.issues || {},
      aiSummary: validationReport.aiSummary || '',
      aiRecommendation: validationReport.aiRecommendation || null,
      rowCount: validationReport.rowCount || 0,
      validRows: validationReport.validRows || 0,
      invalidRows: validationReport.invalidRows || 0,
      acceptedRows: validationReport.acceptedRows || 0,
      duplicateRowsRemoved: validationReport.duplicateRowsRemoved || 0,
      cleaningActions: validationReport.cleaningActions || [],
      detectedColumns: validationReport.detectedColumns || {},
      periodCheck: validationReport.periodCheck || {},
      yearsFound: validationReport.yearsFound || [],
      seasonsFound: validationReport.seasonsFound || [],
      missingValueRate: validationReport.missingValueRate ?? 0,
      outlierRate: validationReport.outlierRate ?? 0,
      reviewedBy: validationReport.reviewedBy || null
    });

    const aiReviewData = buildAIReviewRecord({
      datasetId,
      version: aiReview.version || 1,
      recommendation: aiReview.recommendation || 'needs_review',
      summary: aiReview.summary || '',
      confidence: aiReview.confidence ?? 0.5,
      details: aiReview.details || {}
    });

    await databaseCollections.datasetVersions.updateOne(
      { datasetId, version: versionData.version },
      { $set: versionData },
      { upsert: true, session }
    );

    await databaseCollections.datasetValidationReports.updateOne(
      { datasetId, version: reportData.version },
      { $set: reportData },
      { upsert: true, session }
    );

    await databaseCollections.aiReviewJobs.updateOne(
      { datasetId, version: aiReviewData.version },
      { $set: { ...aiReviewData, jobType: aiReview.jobType || 'dataset_summary', status: aiReview.status || 'completed' } },
      { upsert: true, session }
    );

    await databaseCollections.datasets.updateOne(
      { _id: new ObjectId(String(datasetId)) },
      { $set: {
          currentVersion: versionData.version,
          validationStatus: reportData.status === 'pass' ? 'accepted' : reportData.status === 'warn' ? 'warning' : reportData.status === 'fail' ? 'invalid' : 'readable',
          status: datasetRecord.status || 'draft',
          updatedAt: now
        } },
      { session }
    );
  });

  return {
    datasetId,
    version: version.version || 1,
    validationStatus: validationReport.status || 'warn'
  };
}

async function removeRejectedDataset({ dataset, databaseCollections, fsModule = require('node:fs') }) {
  if (!dataset?._id) return { deleted: false, reason: 'No dataset id available.' };

  const datasetId = String(dataset._id);
  const filePaths = [dataset.storagePath, dataset.repairOutputPath].filter(Boolean);
  for (const filePath of filePaths) {
    try {
      if (filePath && fsModule.existsSync(filePath)) fsModule.unlinkSync(filePath);
    } catch (error) {
      // Ignore file cleanup errors so the dataset state can still be removed cleanly.
    }
  }

  const cleanupTargets = [
    ['datasets', { _id: dataset._id }],
    ['datasetVersions', { datasetId: dataset._id }],
    ['datasetValidationReports', { datasetId: dataset._id }],
    ['aiReviewJobs', { datasetId: dataset._id }],
    ['adminReviewQueue', { datasetId: dataset._id }],
    ['dashboardSnapshots', { datasetId: dataset._id }]
  ];

  let deleted = false;
  for (const [collectionName, filter] of cleanupTargets) {
    const collection = databaseCollections[collectionName];
    if (!collection) continue;
    let result;
    if (collection.deleteOne) {
      result = await collection.deleteOne(filter);
    } else if (collection.deleteMany) {
      result = await collection.deleteMany(filter);
    }
    if (result?.deletedCount > 0) deleted = true;
  }

  return { deleted, datasetId };
}

async function listDatasets() {
  const databaseCollections = await initializeDatabase();
  return databaseCollections.datasets.find({}).sort({ year: -1, season: -1, createdAt: -1 }).toArray();
}

async function listValidationReports() {
  const databaseCollections = await initializeDatabase();
  return databaseCollections.validationReports.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
}

async function listAdminValidationReports() {
  const databaseCollections = await initializeDatabase();
  const reports = await databaseCollections.datasetValidationReports.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  return Promise.all(reports.map(async (report) => {
    const [dataset, review] = await Promise.all([
      databaseCollections.datasets.findOne({ _id: report.datasetId }, { projection: { title: 1, fileName: 1, year: 1, season: 1, status: 1 } }),
      databaseCollections.adminReviewQueue.findOne({ datasetId: report.datasetId }, { projection: { reviewStatus: 1, reviewNotes: 1, updatedAt: 1 } })
    ]);
    return { ...report, dataset, review: review || { reviewStatus: 'pending', reviewNotes: '' } };
  }));
}

async function listUserDatasets(userId) {
  const databaseCollections = await initializeDatabase();
  return databaseCollections.datasets.find({ userId }).sort({ createdAt: -1 }).toArray();
}

async function getDatasetById(datasetId) {
  const databaseCollections = await initializeDatabase();
  const query = ObjectId.isValid(String(datasetId)) ? { _id: new ObjectId(String(datasetId)) } : { _id: String(datasetId) };
  return databaseCollections.datasets.findOne(query);
}

async function getDatasetValidationReport(datasetId) {
  const databaseCollections = await initializeDatabase();
  return databaseCollections.datasetValidationReports.find({ datasetId: new ObjectId(String(datasetId)) }).sort({ createdAt: -1 }).toArray();
}

async function getDatasetJob(datasetId, version = null) {
  const databaseCollections = await initializeDatabase();
  const query = { datasetId: new ObjectId(String(datasetId)) };
  if (version !== null) query.version = Number(version);
  return databaseCollections.aiReviewJobs.findOne(query, { sort: { createdAt: -1 } });
}

async function saveDashboardSnapshot({ datasetId, version, summaryJson, metricsHash, generatedAt = new Date(), publishedAt = generatedAt }) {
  const databaseCollections = await initializeDatabase();
  await databaseCollections.dashboardSnapshots.updateMany(
    { snapshotType: 'overview', isActive: true },
    { $set: { isActive: false } }
  );
  await databaseCollections.dashboardSnapshots.updateOne(
    { datasetId, version, snapshotType: 'overview' },
    {
      $set: {
        datasetId,
        version,
        snapshotType: 'overview',
        metricsHash,
        summaryJson,
        generatedAt,
        publishedAt,
        isActive: true
      }
    },
    { upsert: true }
  );
  return databaseCollections.dashboardSnapshots.findOne({ datasetId, version, snapshotType: 'overview' });
}

async function getActiveDashboardSnapshot() {
  const databaseCollections = await initializeDatabase();
  return databaseCollections.dashboardSnapshots.findOne(
    { snapshotType: 'overview', isActive: true },
    { sort: { publishedAt: -1 } }
  );
}

async function seedConfiguredDatasets(datasetFiles) {
  const databaseCollections = await initializeDatabase();
  const now = new Date();
  const operations = datasetFiles.map((dataset) => ({
    updateOne: {
      filter: { key: dataset.key },
      update: {
        $set: {
          year: dataset.year,
          season: dataset.season,
          sourcePath: dataset.relativePath,
          title: dataset.title || `${dataset.season || 'Season'} ${dataset.year || 'Dataset'}`,
          description: dataset.description || 'Seeded public dataset for dashboard ingestion.',
          fileName: dataset.fileName || `${dataset.key}.csv`,
          storagePath: dataset.relativePath || dataset.filePath || `/data/${dataset.key}`,
          fileHash: dataset.hash || `${dataset.key}-seed`,
          sourceType: dataset.sourceType || 'api',
          ownerType: dataset.ownerType || 'admin',
          datasetType: dataset.datasetType || 'admin_summary',
          status: dataset.status || 'approved',
          validationStatus: dataset.validationStatus || 'accepted',
          currentVersion: dataset.currentVersion || 1,
          publicVersion: dataset.publicVersion || 1,
          isPublic: dataset.isPublic !== undefined ? Boolean(dataset.isPublic) : true,
          updatedAt: now
        },
        $setOnInsert: {
          key: dataset.key,
          createdAt: now
        }
      },
      upsert: true
    }
  }));
  if (operations.length) await databaseCollections.datasets.bulkWrite(operations);
}

module.exports = {
  createDatasetUploadRecord,
  buildDatasetVersionRecord,
  buildValidationReportRecord,
  buildAIReviewRecord,
  getSubmissionDecision,
  saveUpload,
  saveDatasetLifecycle,
  removeRejectedDataset,
  listDatasets,
  listValidationReports,
  listAdminValidationReports,
  listUserDatasets,
  getDatasetById,
  getDatasetValidationReport,
  getDatasetJob,
  saveDashboardSnapshot,
  getActiveDashboardSnapshot,
  seedConfiguredDatasets
};
