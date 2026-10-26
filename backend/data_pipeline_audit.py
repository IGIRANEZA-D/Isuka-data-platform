from pathlib import Path
import csv
import json
import re
from collections import Counter, defaultdict
from statistics import mean

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BASE_DIR = REPOSITORY_ROOT / 'www' / 'Datasets(2020-2025)'
OUTPUT_DIR = REPOSITORY_ROOT / 'backend' / 'reports'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CANONICAL_FIELDS = {
    'farmer_id': ['s1q6', 'Farmer_ID', 'farmer_id', 'farmerid'],
    'plot_number': ['s2q1', 'plot_number', 'Plot_Number'],
    'crop_code': ['Code', 'code', 'crop_code', 'Crop_Code'],
    'crop_name': ['s2q4', 'CropCategory', 'crop_name', 'Crop Name', 'cropname'],
    'district_name': ['s1q2', 'district', 'District', 'district_name'],
    'district_code': ['district_code', 's1q2', 'District', 'district'],
    'plot_area_ha': ['Plot_area_ha', 'plot_area_ha', 'Plot_Area_ha', 'Crop_Area_ha', 'crop_area_ha'],
    'crop_area_ha': ['Crop_Area_ha', 'crop_area_ha', 'CropArea_ha', 'Harvested_Crop_Area_ha', 'harvested_crop_area_ha'],
    'yield': ['Yield', 'yield'],
    'plot_weight': ['Plot_weight', 'plot_weight', 'finalplot_weight', 'final_plot_weight'],
    'harvest_quantity': ['s2q21', 's2q22', 's2q23', 'Harvested_Quantity', 'harvest_quantity'],
    'loss_fields': ['s2q41', 's2q42', 's2q43', 's2q44', 's2q45', 's2q46', 's2q47', 's2q48', 's2q49', 's2q50'],
}

FIELD_ALIASES = {
    'district_name': ['s1q2', 'district', 'District', 'district_name'],
    'district_code': ['s1q2', 'district_code', 'District', 'district'],
    'farmer_id': ['s1q6', 'Farmer_ID', 'farmer_id'],
    'plot_number': ['s2q1', 'Plot_Number', 'plot_number'],
    'crop_code': ['Code', 'code', 'crop_code', 'Crop_Code'],
    'crop_name': ['s2q4', 'CropCategory', 'crop_name', 'Crop Name', 'cropname'],
    'plot_area_ha': ['Plot_area_ha', 'plot_area_ha', 'Crop_Area_ha', 'crop_area_ha'],
    'crop_area_ha': ['Crop_Area_ha', 'crop_area_ha', 'CropArea_ha', 'Harvested_Crop_Area_ha'],
    'yield': ['Yield', 'yield', 'harvest_yield'],
    'plot_weight': ['Plot_weight', 'plot_weight', 'finalplot_weight', 'final_plot_weight'],
    'harvested_quantity': ['s2q21', 's2q22', 's2q23', 'Harvested_Quantity', 'harvest_quantity'],
    'loss_storage': ['s2q37', 's2q50', 's2q37_Other_storage'],
    'loss_fields': ['s2q41', 's2q42', 's2q43', 's2q44', 's2q45', 's2q46', 's2q47', 's2q48', 's2q49', 's2q50'],
}

SEASON_LABELS = {
    'Season A': 'A',
    'Season B': 'B',
    'Season C': 'C',
}

YEAR_FILES = []


def normalize_text(value):
    if value is None:
        return ''
    s = str(value).strip()
    s = s.replace('"', '').replace("'", '')
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def parse_numeric(value):
    if value is None:
        return None
    s = normalize_text(value)
    if not s:
        return None
    s = s.replace(',', '')
    try:
        return float(s)
    except Exception:
        return None


def get_value(row, aliases):
    lower_lookup = {str(k).lower(): v for k, v in row.items()}
    for alias in aliases:
        v = lower_lookup.get(str(alias).lower())
        if v is not None and normalize_text(v) != '':
            return v
    return None


def discover_files(base):
    production_files = []
    for pattern in ['*Production.csv', '*Crop production.csv']:
        production_files.extend(base.rglob(pattern))

    # Deduplicate by full path in case any file matches both patterns
    unique_paths = sorted({str(path) for path in production_files})
    results = []

    for path_str in unique_paths:
        path = Path(path_str)
        rel = path.relative_to(base)

        year = None
        search_candidates = [path.name] + [parent.name for parent in path.parents if parent != base]
        for candidate in search_candidates:
            match = re.search(r'(20\d{2})', candidate)
            if match:
                year = match.group(1)
                break

        season_match = None
        lower_path = str(path).lower()
        if 'season a' in lower_path or 'seasona' in lower_path:
            season_match = 'A'
        elif 'season b' in lower_path or 'seasonb' in lower_path:
            season_match = 'B'
        elif 'season c' in lower_path or 'seasonc' in lower_path:
            season_match = 'C'

        if year and season_match:
            results.append({
                'path': path,
                'year': year,
                'season': season_match,
                'season_label': f'Season {season_match}',
                'relative': str(rel)
            })

    return results


def read_delimited(path):
    with path.open('r', encoding='utf-8', errors='replace', newline='') as f:
        sample = f.read(8192)
        f.seek(0)
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=',\t;|').delimiter
        except csv.Error:
            delimiter = '\t'
        reader = csv.reader(f, delimiter=delimiter)
        rows = list(reader)
    if not rows:
        return [], []
    header = [normalize_text(h) for h in rows[0]]
    data = []
    for row in rows[1:]:
        if not row or all(normalize_text(c) == '' for c in row):
            continue
        row_dict = {}
        for idx, col in enumerate(header):
            row_dict[col] = row[idx] if idx < len(row) else ''
        data.append(row_dict)
    return header, data


def build_record(row, data_meta):
    record = {
        'year': data_meta['year'],
        'season': data_meta['season'],
        'season_label': data_meta['season_label'],
        'path': str(data_meta['path']),
        'source_row': row,
    }

    for canonical, aliases in FIELD_ALIASES.items():
        record[canonical] = get_value(row, aliases)

    record['farmer_id'] = normalize_text(record.get('farmer_id'))
    record['plot_number'] = normalize_text(record.get('plot_number'))
    record['crop_code'] = normalize_text(record.get('crop_code'))
    record['district_name'] = normalize_text(record.get('district_name'))
    record['district_code'] = normalize_text(record.get('district_code'))
    record['crop_name'] = normalize_text(record.get('crop_name'))
    record['plot_area_ha'] = parse_numeric(record.get('plot_area_ha'))
    record['crop_area_ha'] = parse_numeric(record.get('crop_area_ha'))
    record['yield'] = parse_numeric(record.get('yield'))
    record['plot_weight'] = parse_numeric(record.get('plot_weight'))
    record['harvested_quantity'] = parse_numeric(record.get('harvested_quantity'))

    # Build explicit numeric loss fields
    loss_fields = {}
    for field in [f's2q{i}' for i in range(41, 50)] + ['s2q50']:
        loss_fields[field] = parse_numeric(row.get(field, ''))
    record['loss_fields'] = loss_fields
    return record


def normalize_crop_name(text):
    s = normalize_text(text)
    s = s.lower()
    replacements = {
        'mandoline': 'mandaline',
        'goosebery': 'gooseberry',
        'letus': 'lettuce',
        'brocolli': 'broccoli',
        'mandaline': 'mandaline',
        'gooseberry': 'gooseberry',
        'lettuce': 'lettuce',
        'broccoli': 'broccoli',
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s


def detect_exact_duplicates(records):
    groups = defaultdict(list)
    for idx, rec in enumerate(records):
        crop_key = rec['crop_code'] or rec['crop_name'] or ''
        key = (
            rec['farmer_id'],
            rec['plot_number'],
            crop_key,
            rec['year'],
            rec['season'],
        )
        groups[key].append((idx, rec))

    duplicate_examples = []
    conflict_examples = []
    exact_duplicate_rows = []
    conflicting_rows = []
    exact_duplicate_counts = Counter()
    conflict_counts = Counter()

    for key, group in groups.items():
        if len(group) < 2:
            continue

        # Build a fingerprint from all non-key source values.
        fingerprints = defaultdict(list)
        for idx, rec in group:
            fp = tuple(normalize_text(rec['source_row'].get(col, '')) for col in sorted(rec['source_row'].keys()))
            fingerprints[fp].append((idx, rec))

        if len(fingerprints) == 1:
            exact_duplicate_count = len(group) - 1
            exact_duplicate_counts[(key[3], key[4])] += exact_duplicate_count
            exact_duplicate_rows.extend([idx for idx, _ in group[1:]])
            duplicate_examples.append({
                'key': {
                    'farmer_id': key[0],
                    'plot_number': key[1],
                    'crop_code': key[2],
                    'year': key[3],
                    'season': key[4],
                },
                'exact_duplicate_count': exact_duplicate_count,
                'example_original': group[0][1]['source_row'],
                'example_duplicate': group[1][1]['source_row'],
            })
        else:
            conflict_counts[(key[3], key[4])] += 1
            conflict_examples.append({
                'key': {
                    'farmer_id': key[0],
                    'plot_number': key[1],
                    'crop_code': key[2],
                    'year': key[3],
                    'season': key[4],
                },
                'variant_count': len(fingerprints),
                'variants': [
                    {
                        'row_index': idx,
                        'row': rec['source_row'],
                    }
                    for idx, rec in list(group)
                ],
            })
            conflicting_rows.extend([idx for idx, _ in group])

    return {
        'exact_duplicate_counts': {f"{year}-{season}": count for (year, season), count in exact_duplicate_counts.items()},
        'conflict_counts': {f"{year}-{season}": count for (year, season), count in conflict_counts.items()},
        'duplicate_examples': duplicate_examples,
        'conflict_examples': conflict_examples,
        'exact_duplicate_row_indices': sorted(set(exact_duplicate_rows)),
        'conflicting_row_indices': sorted(set(conflicting_rows)),
    }


def load_records():
    production_files = discover_files(BASE_DIR)
    records = []
    for meta in production_files:
        hdr, rows = read_delimited(meta['path'])
        for row in rows:
            records.append(build_record(row, meta))
    return production_files, records


def compute_missingness(records):
    result = defaultdict(lambda: defaultdict(int))
    counts = defaultdict(lambda: defaultdict(int))
    for rec in records:
        key = (rec['year'], rec['season'])
        for field in ['farmer_id', 'plot_number', 'crop_code', 'district_name', 'crop_name', 'plot_area_ha', 'crop_area_ha', 'yield', 'plot_weight', 'harvested_quantity']:
            counts[key][field] += 1
            if rec[field] in (None, ''):
                result[key][field] += 1

    missing = {}
    for key, mapping in result.items():
        year, season = key
        season_key = f"{year}-{season}"
        missing[season_key] = {}
        total = counts[key]['farmer_id']
        for field in counts[key]:
            missing[season_key][field] = round((mapping.get(field, 0) / total) * 100, 2)
    return missing


def count_negative_values(records):
    negative_counts = defaultdict(Counter)
    examples = defaultdict(list)
    for rec in records:
        key = (rec['year'], rec['season'])
        # area/production fields
        for field in ['plot_area_ha', 'crop_area_ha', 'yield', 'plot_weight', 'harvested_quantity']:
            val = rec.get(field)
            if val is not None and val < 0:
                negative_counts[key][field] += 1
                if len(examples[key]) < 5:
                    examples[key].append({'field': field, 'record': rec})
        # loss fields
        for loss_field, val in rec['loss_fields'].items():
            if val is not None and val < 0:
                negative_counts[key][loss_field] += 1
                if len(examples[key]) < 5:
                    examples[key].append({'field': loss_field, 'record': rec})

    serializable_counts = {}
    serializable_examples = {}
    for (year, season), counts in negative_counts.items():
        serializable_counts[f"{year}-{season}"] = dict(counts)
    for (year, season), exs in examples.items():
        serializable_examples[f"{year}-{season}"] = exs

    return serializable_counts, serializable_examples


def print_section(title):
    print('\n' + '='*120)
    print(title)
    print('='*120)


if __name__ == '__main__':
    production_files, records = load_records()

    print_section('DATASET INVENTORY')
    print(f'Total production files found: {len(production_files)}')
    for item in production_files:
        print(f"{item['year']} {item['season_label']}: {item['relative']}")

    print_section('DUPLICATE AUDIT')
    dup_report = detect_exact_duplicates(records)
    print('Exact duplicate counts by (year, season):')
    print(json.dumps(dup_report['exact_duplicate_counts'], indent=2, ensure_ascii=False, default=str))
    print('Conflict counts by (year, season):')
    print(json.dumps(dup_report['conflict_counts'], indent=2, ensure_ascii=False, default=str))
    print('First exact duplicate examples:')
    for ex in dup_report['duplicate_examples'][:5]:
        print(json.dumps(ex, indent=2, ensure_ascii=False, default=str))
    print('First conflict examples:')
    for ex in dup_report['conflict_examples'][:5]:
        print(json.dumps(ex, indent=2, ensure_ascii=False, default=str))

    print_section('MISSINGNESS AUDIT')
    missingness = compute_missingness(records)
    print(json.dumps(missingness, indent=2, ensure_ascii=False))

    print_section('NEGATIVE VALUES AUDIT')
    neg_counts, neg_examples = count_negative_values(records)
    print(json.dumps(dict(neg_counts), indent=2, ensure_ascii=False))
    print('Examples:')
    print(json.dumps(neg_examples, indent=2, ensure_ascii=False))

    print_section('CROP LABEL NORMALIZATION REVIEW')
    crop_variants = defaultdict(set)
    for rec in records:
        crop_variants[normalize_text(rec['crop_code'])].add(normalize_crop_name(rec['crop_name']))
    for code, names in list(crop_variants.items())[:30]:
        if len(names) > 1:
            print(code, sorted(names))

    # Save reports
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        'production_files': [
            {
                **item,
                'path': str(item['path'])
            }
            for item in production_files
        ],
        'duplicate_report': dup_report,
        'missingness': missingness,
        'negative_counts': neg_counts,
    }
    (OUTPUT_DIR / 'audit_summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'\nSaved JSON summary to {OUTPUT_DIR / "audit_summary.json"}')
