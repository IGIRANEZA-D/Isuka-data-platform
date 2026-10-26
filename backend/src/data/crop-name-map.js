const CROP_NAME_MAP = Object.freeze({
  mandoline: 'Mandaline',
  mandaline: 'Mandaline',
  goosebery: 'Gooseberry',
  gooseberry: 'Gooseberry',
  letus: 'Lettuce',
  lettuce: 'Lettuce',
  brocolli: 'Broccoli',
  broccoli: 'Broccoli'
});

function canonicalizeCropName(value) {
  const source = String(value ?? '').trim().replace(/["']/g, '').replace(/\s+/g, ' ');
  if (!source) return ''; 
  return CROP_NAME_MAP[source.toLowerCase()] || source;
}

function normalizeCropCode(value, cropValueLabels = {}) {
  const source = canonicalizeCropName(value);
  if (!source) return '';
  const numeric = Number(source);
  if (Number.isFinite(numeric)) {
    const code = String(numeric);
    const cropName = cropValueLabels[code] ?? cropValueLabels[String(value).trim()]
      ?? Object.entries(cropValueLabels).find(([key]) => Number(key) === numeric)?.[1];
    return { code, name: canonicalizeCropName(cropName || source) };
  }
  const normalized = source.toLowerCase();
  const entry = Object.entries(cropValueLabels).find(([, label]) => canonicalizeCropName(label).toLowerCase() === normalized);
  if (entry) return { code: String(Number(entry[0])), name: canonicalizeCropName(entry[1]) };
  return { code: `name:${normalized}`, name: source };
}

module.exports = { CROP_NAME_MAP, canonicalizeCropName, normalizeCropCode };