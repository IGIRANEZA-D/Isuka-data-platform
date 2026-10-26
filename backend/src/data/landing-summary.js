function normalizeDistrictName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '').replace('nyarugenege', 'nyarugenge');
}

function buildLandingSummary({ periods, districts, getOverview, calcVersion }) {
  if (typeof getOverview !== 'function') throw new TypeError('getOverview must be a function.');
  const districtCodeByName = new Map();
  const districtNameByCode = new Map();
  for (const district of districts) {
    const nameKey = normalizeDistrictName(district.name);
    const code = String(district.code);
    if (!nameKey || !code || districtCodeByName.has(nameKey) || districtNameByCode.has(code)) {
      throw new Error('Landing district names and codes must be present and unique.');
    }
    districtCodeByName.set(nameKey, code);
    districtNameByCode.set(code, district.name);
  }

  const availableYears = [...new Set(periods.map((period) => Number(period.year)))].sort((left, right) => left - right);
  const availableSeasons = [...new Set(periods.map((period) => period.season))].filter((season) => ['A', 'B', 'C'].includes(season)).sort();
  const seasons = [...availableSeasons, 'all'];
  const views = {};
  const periodsToBuild = [...availableYears.map(String), 'all'];
  for (const year of periodsToBuild) {
    for (const season of seasons) {
      if (season !== 'all' && !periods.some((period) => period.season === season && (year === 'all' || Number(year) === Number(period.year)))) continue;
      const overview = getOverview(year, 'all', season);
      const ranked = overview.districtPerformance
        .map((district) => {
          const code = districtCodeByName.get(normalizeDistrictName(district.district));
          if (!code) throw new Error(`District boundary code is missing for ${district.district}.`);
          return {
            code,
            name: districtNameByCode.get(code),
            lossPercent: Number.isFinite(district.lossPercent) ? district.lossPercent : null
          };
        })
        .sort((left, right) => {
          if (left.lossPercent === null) return right.lossPercent === null ? left.name.localeCompare(right.name) : 1;
          if (right.lossPercent === null) return -1;
          return right.lossPercent - left.lossPercent || left.name.localeCompare(right.name);
        });
      let rank = 0;
      const rankedDistricts = ranked.map((district) => ({
        ...district,
        rank: district.lossPercent === null ? null : ++rank
      }));
      views[`${year}-${season}`] = {
        year: year === 'all' ? 'all' : Number(year),
        season,
        nationalLossPercent: Number.isFinite(overview.kpis.postHarvestLossPercent) ? overview.kpis.postHarvestLossPercent : null,
        recordCount: Number.isFinite(overview.dataQuality?.rowsRead) ? overview.dataQuality.rowsRead : 0,
        districts: rankedDistricts
      };
    }
  }

  const latestYear = availableYears.at(-1);
  const latestOverview = latestYear === undefined ? null : getOverview(String(latestYear), 'all', 'all');
  const productionDistricts = (latestOverview?.districtPerformance || []).map((district) => {
    const code = districtCodeByName.get(normalizeDistrictName(district.district));
    if (!code) throw new Error(`District boundary code is missing for ${district.district}.`);
    return {
      code,
      name: districtNameByCode.get(code),
      primaryCrop: district.primaryCrop || null,
      productionKg: Number.isFinite(district.productionKg) ? district.productionKg : null,
      areaHa: Number.isFinite(district.areaHa) ? district.areaHa : null
    };
  });

  return {
    meta: {
      years: availableYears,
      seasons: availableSeasons,
      districtCount: districts.length,
      calcVersion
    },
    latest: { year: availableYears.at(-1), season: 'all' },
    production: { year: latestYear, districts: productionDistricts },
    periods: views
  };
}

module.exports = { buildLandingSummary, normalizeDistrictName };
