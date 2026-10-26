function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

class DatasetQualityModel {
  constructor(options = {}) {
    this.weights = {
      schema: options.schema ?? 0.25,
      completeness: options.completeness ?? 0.2,
      temporal: options.temporal ?? 0.2,
      cleanliness: options.cleanliness ?? 0.2,
      featureReadiness: options.featureReadiness ?? 0.15
    };
    this.minimumAcceptableScore = options.minimumAcceptableScore ?? 78;
    this.maximumRisk = options.maximumRisk ?? 0.25;
    this.minimumConfidence = options.minimumConfidence ?? 0.72;
  }

  evaluate({ schemaScore = 0, completenessScore = 0, temporalScore = 0, cleanlinessScore = 0, featureReadiness = 0, missingInfo = [], warnings = [], duplicateRowsRemoved = 0, invalidRows = 0, rowCount = 0 }) {
    const schemaWeighted = clamp(schemaScore, 0, 100);
    const completenessWeighted = clamp(completenessScore, 0, 100);
    const temporalWeighted = clamp(temporalScore, 0, 100);
    const cleanlinessWeighted = clamp(cleanlinessScore, 0, 100);
    const readinessWeighted = clamp(featureReadiness, 0, 100);

    const overallScore = clamp(
      (schemaWeighted * this.weights.schema)
      + (completenessWeighted * this.weights.completeness)
      + (temporalWeighted * this.weights.temporal)
      + (cleanlinessWeighted * this.weights.cleanliness)
      + (readinessWeighted * this.weights.featureReadiness),
      0,
      100
    );

    const rowErrorRate = rowCount > 0 ? (invalidRows / rowCount) * 100 : 0;
    const risk = clamp(
      ((missingInfo.length * 6) + warnings.length * 2 + (duplicateRowsRemoved || 0) * 0.4 + rowErrorRate) / 100,
      0,
      1
    );

    const scoreGap = Math.max(0, overallScore - this.minimumAcceptableScore);
    const warningPenalty = Math.min(0.35, (warnings.length || 0) * 0.05 + (missingInfo.length || 0) * 0.08);
    const cleanlinessPenalty = Math.min(0.3, (duplicateRowsRemoved || 0) * 0.01 + rowErrorRate * 0.003);
    const confidence = clamp(
      0.5 + (scoreGap / 100) * 0.7 - risk * 0.4 - warningPenalty - cleanlinessPenalty,
      0,
      1
    );

    const accepted = overallScore >= this.minimumAcceptableScore && risk <= this.maximumRisk && confidence >= this.minimumConfidence;
    const fallbackUsed = !accepted || confidence < this.minimumConfidence;
    const status = accepted ? 'accepted' : risk > 0.55 ? 'rejected' : 'needs_review';

    return {
      overallScore: Number(overallScore.toFixed(1)),
      risk: Number(risk.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      status,
      accepted,
      fallbackUsed,
      modelStatus: accepted && confidence >= this.minimumConfidence ? 'trained' : 'fallback',
      explanation: {
        schema: schemaWeighted,
        completeness: completenessWeighted,
        temporal: temporalWeighted,
        cleanliness: cleanlinessWeighted,
        featureReadiness: readinessWeighted,
        missingInfo,
        warnings,
        invalidRows,
        duplicateRowsRemoved
      }
    };
  }

  buildRemediationPlan(validationResult = {}) {
    const issues = [];
    const actions = [];
    const missing = validationResult.issues?.missingColumns || [];
    const mismatch = validationResult.periodCheck || {};

    if (missing.length) {
      issues.push(`Required fields missing: ${missing.join(', ')}`);
      actions.push({ type: 'schema', description: `Add or rename missing columns: ${missing.join(', ')}` });
    }

    if (mismatch.yearMismatch || mismatch.seasonMismatch) {
      issues.push('Selected period does not match the dataset period.');
      actions.push({ type: 'period', description: 'Normalize the dataset year/season labels to the selected admin period.' });
    }

    if ((validationResult.duplicateRowsRemoved || 0) > 0) {
      issues.push(`Duplicate rows were found and removed: ${validationResult.duplicateRowsRemoved}.`);
      actions.push({ type: 'deduplicate', description: 'Remove exact duplicates while keeping the latest valid occurrence.' });
    }

    if ((validationResult.invalidRows || 0) > 0) {
      issues.push(`Invalid rows detected: ${validationResult.invalidRows}.`);
      actions.push({ type: 'quality', description: 'Convert numeric values carefully and remove impossible agricultural rows.' });
    }

    if ((validationResult.warnings || []).length) {
      actions.push({ type: 'review', description: 'Review remaining warnings and manually confirm unusual district or crop names.' });
    }

    return {
      issues,
      actions,
      recommendedStatus: actions.length ? 'needs_repair' : 'ready'
    };
  }
}

function buildDatasetAcceptanceDecision(validationResult = {}, model = new DatasetQualityModel()) {
  const evaluation = model.evaluate({
    schemaScore: validationResult.schemaScore ?? 0,
    completenessScore: validationResult.completenessScore ?? 0,
    temporalScore: validationResult.periodCheck?.yearMismatch || validationResult.periodCheck?.seasonMismatch ? 0 : 100,
    cleanlinessScore: clamp(100 - ((validationResult.duplicateRowsRemoved || 0) * 5) - ((validationResult.invalidRows || 0) * 3), 0, 100),
    featureReadiness: validationResult.modelReadiness?.status === 'ready' ? 100 : validationResult.modelReadiness?.status === 'limited' ? 70 : 25,
    missingInfo: validationResult.issues?.missingColumns || [],
    warnings: validationResult.warnings || [],
    duplicateRowsRemoved: validationResult.duplicateRowsRemoved || 0,
    invalidRows: validationResult.invalidRows || 0,
    rowCount: validationResult.rowCount || 0
  });

  const remediationPlan = model.buildRemediationPlan(validationResult);

  const fallbackUsed = evaluation.status !== 'accepted' || evaluation.confidence < (model.minimumConfidence ?? 0.72);

  return {
    ...evaluation,
    remediationPlan,
    needsRepair: evaluation.status !== 'accepted',
    fallbackUsed,
    modelStatus: fallbackUsed ? 'fallback' : 'trained',
    acceptanceRule: 'Accept only if score >= 78 and risk <= 0.25 with no blocking period/schema issues and model confidence remains above the neutral threshold.'
  };
}

module.exports = { DatasetQualityModel, buildDatasetAcceptanceDecision };
