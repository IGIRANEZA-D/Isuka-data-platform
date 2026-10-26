const fs = require('node:fs');

function normalizeText(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/^"|"$/g, '').trim();
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/,/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];
    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function parseDelimitedText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [], invalidRows: 0 };

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeText);
  const rows = [];
  let invalidRows = 0;

  for (const line of lines.slice(1)) {
    const values = splitDelimitedLine(line, delimiter);
    if (values.length !== headers.length) {
      invalidRows += 1;
      continue;
    }
    const row = {};
    headers.forEach((header, index) => {
      row[header] = normalizeText(values[index]);
    });
    rows.push(row);
  }

  return { headers, rows, invalidRows, delimiter: delimiter === '\t' ? 'tab' : 'comma' };
}

function readDelimitedFile(filePath) {
  return parseDelimitedText(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { normalizeText, parseNumber, parseDelimitedText, readDelimitedFile };
