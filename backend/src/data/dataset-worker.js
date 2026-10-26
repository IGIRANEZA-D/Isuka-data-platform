const { ObjectId } = require('mongodb');
const { initializeDatabase } = require('./database');
const { getDatasetById, saveDatasetLifecycle, buildValidationReportRecord } = require('./dataset-repository');
const { validateDatasetFile } = require('./dataset-validation');
const { reviewDatasetWithAI } = require('./providers');
const { buildDatasetAcceptanceDecision } = require('./dataset-quality-model');
const fs = require('node:fs');
const path = require('node:path');

const queue = [];
let workerActive = false;

const validationStageNames = Object.freeze({
  queued: 'Preparing dataset',
  deterministic: 'System validation',
  model_check: 'Model and algorithm readiness',
  ai_review: 'AI review',
  complete: 'Validation complete',
  blocked: 'Validation blocked',
  failed: 'Validation failed'
});

function buildValidationProgress(phase, currentStep, percent, completedChecks = []) {
  return {
    phase,
    stage: validationStageNames[phase] || phase,
    currentStep,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    completedChecks,
    updatedAt: new Date()
  };
}

function datasetObjectId(datasetId) {
  return ObjectId.isValid(String(datasetId)) ? new ObjectId(String(datasetId)) : datasetId;
}

async function updateJob(datasetId, version, update) {
  const databaseCollections = await initializeDatabase();
  await databaseCollections.aiReviewJobs.updateOne(
    { datasetId: datasetObjectId(datasetId), version },
    { $set: { ...update, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), promptVersion: 'dataset-validation-v1' } },
    { upsert: true }
  );
}

async function processDatasetValidation(datasetId, requestedBy = null) {
  const dataset = await getDatasetById(datasetId);
  if (!dataset) throw new Error('Dataset not found.');
  const version = Number(dataset.currentVersion || 1);
  let stage = 'starting validation';
  await updateJob(dataset._id, version, { jobType: 'fit_review', status: 'running', requestedBy, startedAt: new Date(), errorMessage: null, progress: buildValidationProgress('queued', 'Preparing dataset', 5) });

  try {
    stage = 'reading the stored file';
    if (!fs.existsSync(dataset.storagePath)) throw new Error('The stored dataset file could not be found.');
    stage = 'reading the complete dataset';
    await updateJob(dataset._id, version, { progress: buildValidationProgress('deterministic', 'System checks: reading file structure', 20) });
    const validationResult = validateDatasetFile(dataset.storagePath, { year: dataset.year, season: dataset.season, datasetType: dataset.datasetType });
    const qualityDecision = buildDatasetAcceptanceDecision(validationResult);
    stage = 'running model and algorithm checks';
    await updateJob(dataset._id, version, { progress: buildValidationProgress('deterministic', 'Detecting columns and dataset structure', 40, ['period']) });
    await updateJob(dataset._id, version, { progress: buildValidationProgress('deterministic', 'Cleaning labels and duplicate rows', 60, ['period', 'schema']) });
    await updateJob(dataset._id, version, { progress: buildValidationProgress('deterministic', 'Applying agricultural checks and algorithms', 76, ['period', 'schema', 'quality']) });
    await updateJob(dataset._id, version, { progress: buildValidationProgress('model_check', `Testing model readiness for ${dataset.datasetType} data`, 84, ['period', 'schema', 'quality']) });
    await updateJob(dataset._id, version, { progress: buildValidationProgress('ai_review', 'AI review in progress', 92, ['period', 'schema', 'quality', 'readiness']) });
    stage = 'running AI review';
    const aiReview = await reviewDatasetWithAI(dataset, validationResult);
    const validationStatus = validationResult.status === 'pass' && qualityDecision.accepted ? 'accepted' : validationResult.status === 'warn' ? 'warning' : validationResult.status === 'fail' ? 'invalid' : 'readable';
    const report = buildValidationReportRecord({
      datasetId: dataset._id,
      version,
      readabilityScore: validationResult.readabilityScore,
      schemaScore: validationResult.schemaScore,
      completenessScore: validationResult.completenessScore,
      fitScore: validationResult.fitScore,
      status: validationResult.status,
      warnings: validationResult.warnings,
      issues: validationResult.issues,
      aiSummary: aiReview.summary,
      aiRecommendation: aiReview.recommendation,
      rowCount: validationResult.rowCount,
      validRows: validationResult.validRows,
      invalidRows: validationResult.invalidRows,
      missingValueRate: validationResult.missingValueRate,
      outlierRate: validationResult.outlierRate,
      reviewedBy: requestedBy
    });

    stage = 'saving validation report and model results';
    await saveDatasetLifecycle({
      dataset: { ...dataset, status: validationResult.status === 'fail' ? 'needs_review' : 'queued', validationStatus, updatedAt: new Date() },
      version: {
        version,
        fileName: dataset.fileName,
        storagePath: dataset.storagePath,
        fileHash: dataset.fileHash,
        schemaSummary: { fileType: path.extname(dataset.fileName).slice(1) },
        rowCount: validationResult.rowCount,
        status: 'validating',
        notes: aiReview.summary
      },
      validationReport: report,
      aiReview: {
        datasetId: dataset._id,
        version,
        recommendation: aiReview.recommendation,
        summary: aiReview.summary,
        confidence: aiReview.confidence,
        details: { ...aiReview.details, provider: aiReview.provider },
        jobType: 'fit_review',
        status: 'completed'
      }
    });
    stage = 'saving final validation result';
    await updateJob(dataset._id, version, {
      jobType: 'fit_review',
      status: 'completed',
      completedAt: new Date(),
      resultSummary: aiReview.summary,
      readinessPercentage: aiReview.readinessPercentage ?? validationResult.readinessScore ?? 0,
      confidencePercentage: aiReview.confidencePercentage ?? Math.round((aiReview.confidence || 0) * 100),
      progress: buildValidationProgress(validationResult.status === 'fail' || ['reject', 'blocked'].includes(aiReview.recommendation) ? 'blocked' : 'complete', validationResult.status === 'fail' || ['reject', 'blocked'].includes(aiReview.recommendation) ? 'Validation blocked' : 'Validation complete', 100, ['period', 'schema', 'quality', 'readiness']),
      outputJson: {
        validationStatus,
        validationResult: validationResult.status,
        fitScore: validationResult.fitScore,
        readinessPercentage: aiReview.readinessPercentage ?? validationResult.readinessScore ?? 0,
        confidencePercentage: aiReview.confidencePercentage ?? Math.round((aiReview.confidence || 0) * 100),
        acceptedRows: validationResult.acceptedRows,
        invalidRows: validationResult.invalidRows,
        duplicateRowsRemoved: validationResult.duplicateRowsRemoved,
        cleaningActions: validationResult.cleaningActions,
        detectedColumns: validationResult.detectedColumns,
        periodCheck: validationResult.periodCheck,
        modelReadiness: validationResult.modelReadiness,
        warnings: validationResult.warnings,
        qualityDecision,
        aiReview,
        explanation: {
          reasons: aiReview.details?.reasons || validationResult.warnings,
          whyBlocked: aiReview.details?.whyBlocked || [],
          missingInformation: aiReview.details?.missingInformation || [],
          requiredActions: aiReview.details?.requiredChanges || [],
          systemChecks: aiReview.details?.systemChecks || [],
          modelChecks: aiReview.details?.modelChecks || [],
          publicationRisk: aiReview.details?.publicationRisk || 'medium'
        }
      }
    });
    return { datasetId: String(dataset._id), version, status: validationResult.status, validationStatus, aiReview, report };
  } catch (error) {
    const detail = error.errInfo?.details ? ` ${JSON.stringify(error.errInfo.details)}` : '';
    const message = `Validation stopped while ${stage}: ${error.message}${detail}`;
    await updateJob(dataset._id, version, { jobType: 'fit_review', status: 'failed', completedAt: new Date(), errorMessage: message, progress: buildValidationProgress('failed', message, 0) });
    throw error;
  }
}

async function drainQueue() {
  if (workerActive) return;
  workerActive = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try { await processDatasetValidation(job.datasetId, job.requestedBy); }
      catch (error) { process.stderr.write(`Dataset worker failure: ${error.message}\n`); }
    }
  } finally {
    workerActive = false;
  }
}

function enqueueDatasetValidation(datasetId, requestedBy = null) {
  if (!queue.some((job) => String(job.datasetId) === String(datasetId))) queue.push({ datasetId, requestedBy });
  setImmediate(drainQueue);
  return { datasetId: String(datasetId), status: 'queued' };
}

async function recoverDatasetJobs() {
  const databaseCollections = await initializeDatabase();
  await databaseCollections.aiReviewJobs.updateMany(
    { jobType: 'fit_review', status: 'running' },
    { $set: { status: 'queued', recoveryReason: 'server_restart', updatedAt: new Date() } }
  );
  const pendingJobs = await databaseCollections.aiReviewJobs.find(
    { jobType: 'fit_review', status: 'queued' },
    { projection: { datasetId: 1, requestedBy: 1 } }
  ).toArray();
  pendingJobs.forEach((job) => enqueueDatasetValidation(job.datasetId, job.requestedBy || null));
  return pendingJobs.length;
}

module.exports = { enqueueDatasetValidation, processDatasetValidation, recoverDatasetJobs, buildValidationProgress, validationStageNames };
