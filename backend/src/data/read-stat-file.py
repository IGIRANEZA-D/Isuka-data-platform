import json
import sys

import pandas as pd


def main():
    file_path = sys.argv[1]
    if file_path.lower().endswith('.sav'):
        frame = pd.read_spss(file_path)
    else:
        frame = pd.read_stata(file_path, convert_categoricals=False)

    columns = [column for column in frame.columns if (
        column in {'s1q2', 's2q4', 'CropCategory', 'Crop_Area', 'Crop_Area_ha',
               'Harv_area', 'Plot_area_ha', 'plot_area_ha', 'Plot_weight',
               'plot_weight', 'Yield', 'yield', 'Harvested_Quantity',
             'harvest_quantity', 'aweight'}
         or column.startswith('s2q') and column[3:].isdigit() and 21 <= int(column[3:]) <= 50
    )]
    selected = frame[columns].where(frame[columns].notna(), None)
    print(json.dumps({'headers': columns, 'rows': json.loads(selected.to_json(orient='records'))}))


if __name__ == '__main__':
    main()