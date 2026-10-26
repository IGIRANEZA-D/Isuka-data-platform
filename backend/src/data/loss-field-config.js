const LOSS_FIELD_RULES = Object.freeze({
  totalLoss: (label) => {
    const text = label.toLowerCase();
    if (!/\b(?:qty|quantity)\b/.test(text)) return false;
    return /estimated loss/.test(text)
      || /quantity[^.]*has been los(?:t)?\b/.test(text)
      || /quantity that has been lost/.test(text);
  },
  theft: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bstol(?:en|len)\b/.test(label.toLowerCase()),
  otherLoss: (label) => /\bother\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()) && !/\b(?:used|birds?|animals?|insects?|pests?)\b/.test(label.toLowerCase()),
  pests: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\b(?:insect|pest)/.test(label.toLowerCase()) && /\b(?:damage|damaged|loss|lost)\b/.test(label.toLowerCase()),
  birdsAnimals: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\b(?:bird|animal)/.test(label.toLowerCase()) && /\b(?:damage|damaged|loss|lost)\b/.test(label.toLowerCase()),
  fallenStalks: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bstalk/.test(label.toLowerCase()) && /\bfallen\b/.test(label.toLowerCase()),
  harvestLoss: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\b(?:lost|loss) during harvest(?:ing)?\b/.test(label.toLowerCase()) && !/\bprocessing\b/.test(label.toLowerCase()),
  transport: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\b(?:transport|transportation)\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()),
  storage: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bstorage\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()),
  processing: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bprocessing\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()),
  packaging: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bpackaging\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()),
  sales: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\b(?:sales|sale)\b/.test(label.toLowerCase()) && /\b(?:loss|lost)\b/.test(label.toLowerCase()),
  publicStorageQuantity: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bpublic storage\b/.test(label.toLowerCase()) && /\bstored\b/.test(label.toLowerCase()),
  usedInOtherWays: (label) => /\b(?:qty|quantity)\b/.test(label.toLowerCase()) && /\bused\b/.test(label.toLowerCase()) && /\bother\b/.test(label.toLowerCase()) && /\b(?:ways|forms)\b/.test(label.toLowerCase()),
  pricePerKg: (label) => /\bprice\b/.test(label.toLowerCase()) && (/selling price per kilogram/.test(label.toLowerCase()) || /market price/.test(label.toLowerCase()))
});

const LOSS_FIELD_UNITS = Object.freeze({
  totalLoss: 'Inferred kg: total-loss quantity is in the production-loss block; the matching component quantities are kg, and row totals are checked against physical production.',
  fallenStalks: 'Inferred kg: the same fallen-stalk quantity is explicitly labeled kg in other annual copies of this survey block.',
  storage: 'Inferred kg only where the label omits the unit: the equivalent storage-loss item is labeled kg in other annual copies; out-of-production rows remain excluded by the shared cap.',
  pricePerKg: 'Inferred RWF/kg for unlabeled market-price copies: the same question is explicitly labeled selling price per kilogram (Rwf/Kg) in same-year sibling seasons.'
});

// Planner groups are composed from measured fields, never from aggregate estimates.
const LOSS_STAGE_GROUPS = Object.freeze([
  { id: 'pests', label: 'Pests and insects', fields: ['pests'] },
  { id: 'animals', label: 'Birds and animals', fields: ['birdsAnimals'] },
  { id: 'harvest', label: 'Harvest', fields: ['fallenStalks', 'harvestLoss'] },
  { id: 'transport', label: 'Transport', fields: ['transport'] },
  { id: 'storage', label: 'Storage', fields: ['storage'] },
  { id: 'processing', label: 'Processing and packaging', fields: ['processing', 'packaging'] },
  { id: 'sales', label: 'Sales', fields: ['sales'] },
  { id: 'other', label: 'Other', fields: ['theft', 'otherLoss'] }
]);

module.exports = { LOSS_FIELD_RULES, LOSS_FIELD_UNITS, LOSS_STAGE_GROUPS };