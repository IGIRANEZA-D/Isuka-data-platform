const { initializeDatabase } = require('./database');

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function extractDatasetQualityFeatures(report = {}, dataset = {}) {
  const issues = report.issues || {};
  const period = report.periodCheck || {};
  const modelReadiness = report.modelReadiness || {};

  return {
    datasetType: String(dataset.datasetType || 'unknown'),
    sourceType: String(dataset.sourceType || 'upload'),
    readabilityScore: toNumber(report.readabilityScore, 0),
    schemaScore: toNumber(report.schemaScore, 0),
    completenessScore: toNumber(report.completenessScore, 0),
    fitScore: toNumber(report.fitScore, 0),
    readinessScore: toNumber(report.readinessScore, 0),
    missingValueRate: toNumber(report.missingValueRate, 0),
    outlierRate: toNumber(report.outlierRate, 0),
    duplicateRowsRemoved: toNumber(report.duplicateRowsRemoved, 0),
    invalidRows: toNumber(report.invalidRows, 0),
    rowCount: toNumber(report.rowCount, 0),
    warningsCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
    hasMissingColumns: Array.isArray(issues.missingColumns) ? issues.missingColumns.length > 0 : false,
    hasDuplicateHeaders: Array.isArray(report.duplicateHeaders) ? report.duplicateHeaders.length > 0 : false,
    yearMismatch: Boolean(period.yearMismatch),
    seasonMismatch: Boolean(period.seasonMismatch),
    hasPeriodMismatch: Boolean(period.yearMismatch || period.seasonMismatch),
    modelReady: modelReadiness.status === 'ready' ? 1 : 0,
    modelLimited: modelReadiness.status === 'limited' ? 1 : 0,
    aiRecommendation: String(report.aiRecommendation || 'needs_review')
  };
}

function buildTrainingRow({ dataset = {}, report = {}, queue = {}, review = null, label = null } = {}) {
  const features = extractDatasetQualityFeatures(report, dataset);
  const decision = label ?? (
    queue?.reviewStatus === 'approved' || dataset.status === 'published' || dataset.status === 'approved' || review === 'approved'
      ? 1
      : 0
  );

  return {
    ...features,
    label: Number(decision),
    datasetStatus: String(dataset.status || 'draft'),
    reviewStatus: String(queue?.reviewStatus || review || 'pending')
  };
}

async function collectHistoricalDatasetTrainingRows({ limit = 1000 } = {}) {
  const databaseCollections = await initializeDatabase();
  const datasets = await databaseCollections.datasets.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  const rows = [];

  for (const dataset of datasets) {
    const validationReports = await databaseCollections.datasetValidationReports
      .find({ datasetId: dataset._id })
      .sort({ version: -1, createdAt: -1 })
      .limit(5)
      .toArray();

    const report = validationReports[0] || {};
    const queue = await databaseCollections.adminReviewQueue.findOne({ datasetId: dataset._id }) || {};

    rows.push(buildTrainingRow({
      dataset,
      report,
      queue,
      review: queue.reviewStatus || null,
      label: dataset.status === 'published' || dataset.status === 'approved' || queue.reviewStatus === 'approved' ? 1 : 0
    }));
  }

  return rows;
}

module.exports = {
  extractDatasetQualityFeatures,
  buildTrainingRow,
  collectHistoricalDatasetTrainingRows
};
