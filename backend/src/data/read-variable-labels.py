import json
import sys

import pyreadstat


def main():
    source_path = sys.argv[1]
    _, metadata = pyreadstat.read_sav(source_path, metadataonly=True)
    crop_label_set = metadata.variable_to_label.get('s2q4')
    crop_labels = metadata.value_labels.get(crop_label_set, {}) if crop_label_set else {}
    normalized_crop_labels = {
        str(int(code)) if isinstance(code, (int, float)) and float(code).is_integer() else str(code): label
        for code, label in crop_labels.items()
    }
    print(json.dumps({
        'variableLabels': dict(zip(metadata.column_names, metadata.column_labels)),
        'cropValueLabels': normalized_crop_labels,
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)