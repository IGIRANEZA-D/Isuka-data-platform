const path = require('node:path');
const fs = require('node:fs');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const datasetsRoot = process.env.ISUKA_DATASETS_DIR
  ? path.resolve(process.env.ISUKA_DATASETS_DIR)
  : path.join(repositoryRoot, 'www', 'Datasets(2020-2025)');
const uploadsRoot = process.env.ISUKA_UPLOADS_DIR
  ? path.resolve(process.env.ISUKA_UPLOADS_DIR)
  : path.join(repositoryRoot, 'backend', 'data', 'uploads');

const datasetFiles = [
  ['2020', 'A', path.join(datasetsRoot, 'Microdata for SAS 2020', 'Datasets', 'SPSS', 'rwa-sas-seasonA_Crop production.sav')],
  ['2020', 'B', path.join(datasetsRoot, 'Microdata for SAS 2020', 'Datasets', 'SPSS', 'rwa-sas-seasonB_Crop production.sav')],
  ['2020', 'C', path.join(datasetsRoot, 'Microdata for SAS 2020', 'Datasets', 'SPSS', 'rwa-sas-seasonC_Crop production.sav')],
  ['2021', 'A', path.join(datasetsRoot, 'Microdata_SAS2021', 'Microdata_SAS2021', 'SPSS', 'rwa-sas-seasonA_Crop production.sav')],
  ['2021', 'B', path.join(datasetsRoot, 'Microdata_SAS2021', 'Microdata_SAS2021', 'SPSS', 'rwa-sas-seasonB_Crop production.sav')],
  ['2021', 'C', path.join(datasetsRoot, 'Microdata_SAS2021', 'Microdata_SAS2021', 'SPSS', 'rwa-sas-seasonC_Crop production.sav')],
  ['2022', 'A', path.join(datasetsRoot, 'Microdata_SAS_2022', 'Microdata_SAS_2022', 'SPSS', 'rwa-sas-seasonA_Crop production.sav')],
  ['2022', 'B', path.join(datasetsRoot, 'Microdata_SAS_2022', 'Microdata_SAS_2022', 'SPSS', 'rwa-sas-seasonB_Crop production.sav')],
  ['2022', 'C', path.join(datasetsRoot, 'Microdata_SAS_2022', 'Microdata_SAS_2022', 'SPSS', 'rwa-sas-seasonC_Crop production.sav')],
  ['2023', 'A', path.join(datasetsRoot, 'Microdata_SAS2023', 'Microdata_SAS2023', 'CSV files', 'rwa-sas-seasonA_Crop production.csv')],
  ['2023', 'B', path.join(datasetsRoot, 'Microdata_SAS2023', 'Microdata_SAS2023', 'CSV files', 'rwa-sas-seasonB_Crop production.csv')],
  ['2023', 'C', path.join(datasetsRoot, 'Microdata_SAS2023', 'Microdata_SAS2023', 'CSV files', 'rwa-sas-seasonC_Crop production.csv')],
  ['2024', 'A', path.join(datasetsRoot, 'Dataset (2024)', 'Dataset', 'Season A', 'Rwa_raw_SeasonA2024_Production.csv')],
  ['2024', 'B', path.join(datasetsRoot, 'Dataset (2024)', 'Dataset', 'Season B', 'Rwa_raw_SeasonB2024_Production.csv')],
  ['2024', 'C', path.join(datasetsRoot, 'Dataset (2024)', 'Dataset', 'Season C', 'Rwa_raw_SeasonC2024_Production.csv')],
  ['2025', 'A', path.join(datasetsRoot, 'Microdata (2025)', 'Microdata', 'Season A', 'Rwa_raw_SeasonA2025_Production.csv')],
  ['2025', 'B', path.join(datasetsRoot, 'Microdata (2025)', 'Microdata', 'Season B', 'Rwa_raw_SeasonB2025_Production.csv')],
  ['2025', 'C', path.join(datasetsRoot, 'Microdata (2025)', 'Microdata', 'Season C', 'Rwa_raw_SeasonC2025_Production.csv')]
].map(([year, season, filePath]) => ({
  key: `${year}-${season}`,
  year: Number(year),
  season,
  filePath,
  relativePath: path.relative(repositoryRoot, filePath)
}));

function createDatasetConfig(year, season, filePath) {
  return {
    key: `${year}-${season}`,
    year: Number(year),
    season,
    filePath,
    relativePath: path.relative(repositoryRoot, filePath)
  };
}

function registerUploadedDataset(year, season, filePath) {
  const config = createDatasetConfig(year, season, filePath);
  const existingIndex = datasetFiles.findIndex((item) => item.key === config.key);
  if (existingIndex >= 0) datasetFiles.splice(existingIndex, 1, config);
  else datasetFiles.push(config);
  datasetFiles.sort((left, right) => left.year - right.year || left.season.localeCompare(right.season));
  return config;
}

function loadUploadedDatasets() {
  if (!fs.existsSync(uploadsRoot)) return;
  fs.readdirSync(uploadsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^20\d{2}-[ABC]\.(csv|sav|dta)$/i.test(entry.name))
    .forEach((entry) => {
      const [, year, season] = entry.name.match(/^(20\d{2})-([ABC])\./i);
      registerUploadedDataset(year, season.toUpperCase(), path.join(uploadsRoot, entry.name));
    });
}

if (!process.env.VERCEL) fs.mkdirSync(uploadsRoot, { recursive: true });
loadUploadedDatasets();

module.exports = { repositoryRoot, datasetsRoot, uploadsRoot, datasetFiles, registerUploadedDataset };
