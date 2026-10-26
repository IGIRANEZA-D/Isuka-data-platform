const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDatasetUploadRecord,
  buildDatasetVersionRecord,
  buildValidationReportRecord,
  buildAIReviewRecord,
  getSubmissionDecision,
  removeRejectedDataset
} = require('../src/data/dataset-repository');

test('blocks submission until validation, AI review, and quality threshold are safe', () => {
  assert.equal(getSubmissionDecision(null).allowed, false);
  assert.equal(getSubmissionDecision({ status: 'completed', outputJson: { validationResult: 'fail' } }).validationFailed, true);
  assert.equal(getSubmissionDecision({ status: 'completed', outputJson: { validationResult: 'pass', aiReview: { recommendation: 'reject' } } }).aiRejected, true);
  assert.equal(getSubmissionDecision({ status: 'completed', outputJson: { validationResult: 'pass', aiReview: { recommendation: 'approve' }, qualityDecision: { accepted: true } } }).allowed, true);
  assert.equal(getSubmissionDecision({ status: 'completed', outputJson: { validationResult: 'pass', aiReview: { recommendation: 'approve' }, qualityDecision: { accepted: false } } }).allowed, false);
});

test('creates a dataset upload record with lifecycle metadata', () => {
  const result = createDatasetUploadRecord({
    userId: 'user-123',
    title: 'Rainfall 2025',
    datasetType: 'climate',
    fileName: 'rainfall.csv',
    storagePath: '/uploads/rainfall.csv',
    fileHash: 'abc123',
    sourceType: 'upload',
    ownerType: 'farmer'
  });

  assert.equal(result.status, 'draft');
  assert.equal(result.datasetType, 'climate');
  assert.equal(result.isPublic, false);
  assert.equal(result.validationStatus, 'unread');
  assert.equal(result.currentVersion, 1);
});

test('builds version and validation records with consistent state', () => {
  const version = buildDatasetVersionRecord({
    datasetId: 'dataset-1',
    version: 1,
    fileName: 'rainfall.csv',
    storagePath: '/uploads/rainfall.csv',
    fileHash: 'abc123',
    schemaSummary: { district: true, year: true },
    rowCount: 100
  });

  const report = buildValidationReportRecord({
    datasetId: 'dataset-1',
    version: 1,
    readabilityScore: 95,
    schemaScore: 90,
    fitScore: 88,
    status: 'warn',
    warnings: ['A few district names are not normalized']
  });

  const aiReview = buildAIReviewRecord({
    datasetId: 'dataset-1',
    version: 1,
    recommendation: 'needs_review',
    summary: 'Dataset is readable and mostly aligned to agriculture reporting.'
  });

  assert.equal(version.version, 1);
  assert.equal(version.status, 'draft');
  assert.equal(report.status, 'warn');
  assert.equal(report.warnings.length, 1);
  assert.equal(aiReview.recommendation, 'needs_review');
});

test('removes a rejected dataset and all related records', async () => {
  const deleted = new Map();
  const collections = {
    datasets: {
      deleteOne: async (filter) => {
        deleted.set('datasets', filter);
        return { deletedCount: 1 };
      }
    },
    datasetVersions: {
      deleteMany: async (filter) => {
        deleted.set('datasetVersions', filter);
        return { deletedCount: 2 };
      }
    },
    datasetValidationReports: {
      deleteMany: async (filter) => {
        deleted.set('datasetValidationReports', filter);
        return { deletedCount: 1 };
      }
    },
    aiReviewJobs: {
      deleteMany: async (filter) => {
        deleted.set('aiReviewJobs', filter);
        return { deletedCount: 1 };
      }
    },
    adminReviewQueue: {
      deleteOne: async (filter) => {
        deleted.set('adminReviewQueue', filter);
        return { deletedCount: 1 };
      }
    },
    dashboardSnapshots: {
      deleteMany: async (filter) => {
        deleted.set('dashboardSnapshots', filter);
        return { deletedCount: 1 };
      }
    }
  };

  const removed = await removeRejectedDataset({
    dataset: { _id: 'dataset-123', storagePath: '/tmp/original.csv', repairOutputPath: '/tmp/repaired.csv' },
    databaseCollections: collections,
    fsModule: { existsSync: (filePath) => filePath === '/tmp/original.csv' || filePath === '/tmp/repaired.csv', unlinkSync: () => {} }
  });

  assert.equal(removed.deleted, true);
  assert.deepEqual(deleted.get('datasets'), { _id: 'dataset-123' });
  assert.deepEqual(deleted.get('datasetVersions'), { datasetId: 'dataset-123' });
  assert.deepEqual(deleted.get('datasetValidationReports'), { datasetId: 'dataset-123' });
  assert.deepEqual(deleted.get('aiReviewJobs'), { datasetId: 'dataset-123' });
  assert.deepEqual(deleted.get('adminReviewQueue'), { datasetId: 'dataset-123' });
  assert.deepEqual(deleted.get('dashboardSnapshots'), { datasetId: 'dataset-123' });
});
