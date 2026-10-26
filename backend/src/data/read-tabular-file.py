import json
import os
import sys

import pandas as pd


def read_frame(file_path):
    extension = os.path.splitext(file_path)[1].lower()
    if extension == '.sav':
        return pd.read_spss(file_path)
    if extension == '.dta':
        return pd.read_stata(file_path, convert_categoricals=False)
    if extension in {'.xlsx', '.xls'}:
        return pd.read_excel(file_path, sheet_name=0)
    if extension in {'.rds', '.rda', '.rdata'}:
        try:
            import pyreadr
        except ImportError as error:
            raise RuntimeError('R data support requires the pyreadr Python package.') from error
        objects = pyreadr.read_r(file_path)
        frames = [frame for frame in objects.values() if isinstance(frame, pd.DataFrame)]
        if not frames:
            raise RuntimeError('The R file did not contain a tabular data frame.')
        return frames[0]
    raise RuntimeError(f'Unsupported structured file type: {extension}')


def json_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, 'item'):
        value = value.item()
    return value if isinstance(value, (str, int, float, bool)) else str(value)


def main():
    file_path = sys.argv[1]
    frame = read_frame(file_path)
    frame.columns = [str(column) for column in frame.columns]
    rows = [
        {column: json_value(value) for column, value in row.items()}
        for row in frame.iterrows()
        for row in [row[1]]
    ]
    print(json.dumps({
        'headers': list(frame.columns),
        'rows': rows,
        'rowCount': len(frame.index),
        'invalidRows': 0,
        'sourceFormat': os.path.splitext(file_path)[1].lower().lstrip('.')
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
