const path = require('node:path');
const { spawnSync } = require('node:child_process');

const structuredExtensions = new Set(['.sav', '.dta', '.xlsx', '.xls', '.rds', '.rda', '.rdata']);

function isStructuredDataset(filePath) {
  return structuredExtensions.has(path.extname(filePath).toLowerCase());
}

function readStructuredDataset(filePath) {
  if (!isStructuredDataset(filePath)) throw new Error(`Unsupported structured dataset type: ${path.extname(filePath) || 'unknown'}`);
  const result = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname, 'read-tabular-file.py'), filePath], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'Structured dataset reader failed.');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Structured dataset reader returned invalid JSON.');
  }
}

module.exports = { structuredExtensions, isStructuredDataset, readStructuredDataset };
