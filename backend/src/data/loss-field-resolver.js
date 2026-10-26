const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { LOSS_FIELD_RULES, LOSS_FIELD_UNITS } = require('./loss-field-config');

function readVariableLabels(filePath) {
  const readerPath = path.join(__dirname, 'read-variable-labels.py');
  const result = spawnSync(process.env.PYTHON || 'python', [readerPath, filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not read variable labels for ${filePath}: ${result.stderr?.trim() || result.error?.message || 'Python label reader failed'}`);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      variableLabels: parsed.variableLabels || parsed,
      cropValueLabels: parsed.cropValueLabels || {}
    };
  } catch {
    throw new Error(`Variable labels were invalid for ${filePath}.`);
  }
}

function labelSourcePath(config) {
  if (/\.sav$/i.test(config.filePath)) return config.filePath;
  const sourceName = path.basename(config.filePath).replace(/\.(csv|dta)$/i, '.sav');
  if (config.year === 2023) {
    return path.join(path.dirname(path.dirname(config.filePath)), 'SPSS', sourceName);
  }
  return path.join(path.dirname(config.filePath), sourceName);
}

function readDatasetLabelMetadata(config, columns, strict = false) {
  const sourcePath = labelSourcePath(config);
  const metadata = fs.existsSync(sourcePath)
    ? readVariableLabels(sourcePath)
    : { variableLabels: Object.fromEntries(columns.map((column) => [column, column])), cropValueLabels: {} };
  const lossFields = resolveLossFields(metadata.variableLabels, {
    fileName: config.relativePath || config.filePath,
    columns,
    strict
  });
  return { ...metadata, lossFields, labelSourcePath: fs.existsSync(sourcePath) ? sourcePath : null };
}

function unitForField(field, label) {
  if (/\bkg\b|kilogram/i.test(label)) return { unit: field === 'pricePerKg' ? 'RWF/kg' : 'kg', status: 'confirmed', evidence: 'Verbatim label explicitly states kg.' };
  if (LOSS_FIELD_UNITS[field]) return { unit: field === 'pricePerKg' ? 'RWF/kg' : 'kg', status: 'confirmed', evidence: LOSS_FIELD_UNITS[field] };
  return { unit: null, status: 'unconfirmed', evidence: 'The variable label does not state a unit and no confirmed equivalence is configured.' };
}

function resolveLossFields(labels, { fileName = 'unknown source', columns = Object.keys(labels), strict = false } = {}) {
  const result = {};
  for (const [field, matcher] of Object.entries(LOSS_FIELD_RULES)) {
    const matches = columns.filter((column) => matcher(String(labels[column] ?? '').trim()));
    if (matches.length > 1) {
      throw new Error(`Ambiguous ${field} label match in ${fileName}: ${matches.join(', ')}`);
    }
    if (!matches.length) {
      result[field] = null;
      continue;
    }
    const column = matches[0];
    result[field] = { column, label: String(labels[column] ?? '').trim(), ...unitForField(field, String(labels[column] ?? '').trim()) };
  }

  const componentFields = ['theft', 'pests', 'birdsAnimals', 'fallenStalks', 'harvestLoss', 'transport', 'storage', 'processing', 'packaging', 'sales']
    .map((field) => result[field]?.column)
    .filter(Boolean);
  if (strict && !result.totalLoss && !componentFields.length) {
    throw new Error(`No reported total-loss or component-loss fields resolved from labels in ${fileName}.`);
  }
  return result;
}

module.exports = { readVariableLabels, resolveLossFields, readDatasetLabelMetadata, unitForField };