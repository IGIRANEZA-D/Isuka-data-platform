const RISK_THRESHOLDS = Object.freeze({
  moderate: 15,
  high: 30
});

function riskTier(lossPercent) {
  if (!Number.isFinite(lossPercent)) return 'low';
  if (lossPercent >= RISK_THRESHOLDS.high) return 'high';
  if (lossPercent >= RISK_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

module.exports = { RISK_THRESHOLDS, riskTier };