import { animateMetric } from './lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
const elements = {
  year:document.getElementById('district-year'), district:document.getElementById('district-select'), crop:document.getElementById('crop-select'),
  count:document.getElementById('district-count'), production:document.getElementById('district-production'), top:document.getElementById('district-top'), topValue:document.getElementById('district-top-value'), crops:document.getElementById('district-crops'), map:document.getElementById('district-map'), mapStatus:document.getElementById('district-map-status'),
  detailName:document.getElementById('detail-name'), detailStatus:document.getElementById('detail-status'), detailProduction:document.getElementById('detail-production'), detailCrop:document.getElementById('detail-crop'), detailRows:document.getElementById('detail-rows'), detailArea:document.getElementById('detail-area'), detailLoss:document.getElementById('detail-loss'), recent:document.getElementById('recent-districts'), recentStatus:document.getElementById('recent-status'), charts:document.getElementById('district-charts'),
  filterSummary:document.querySelector('[data-district-filter-summary]'), filterStatus:document.querySelector('[data-district-filter-status]'), filterReset:document.querySelector('[data-district-filter-reset]')
};
let map, layer, entries = [], breakdown = [], selected, controller;
const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z]/g,'').replace('nyarugenege','nyarugenge');
const title = (value) => String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
const compact = chartFormat.compact;
const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const color = (entry) => entry?.lossPercent >= 30 ? '#a83c3c' : entry?.lossPercent >= 15 ? '#c08a3e' : '#6fa83c';
function style(feature) { const entry = entries.find((item) => key(item.district) === key(feature.properties.__districtKey)); return { color:'#fff', weight:1.2, fillColor:color(entry), fillOpacity:.78 }; }
function updateFilters(filters, overview) {
  elements.year.innerHTML = `<option value="all">All years</option>${filters.availableYears.map((year) => `<option value="${year}">${year}</option>`).join('')}`; elements.year.value = filters.year;
  elements.district.innerHTML = `<option value="all">All districts</option>${filters.availableDistricts.map((item) => `<option value="${key(item)}">${title(item)}</option>`).join('')}`; elements.district.value = selected || 'all';
  const crops = [...new Map(overview.productionByCrop.map((item) => [item.cropCode, item.crop])).entries()];
  elements.crop.innerHTML = `<option value="all">All crops</option>${crops.map(([code,name]) => `<option value="${code}">${title(name)}</option>`).join('')}`;
  if (![...elements.crop.options].some((option) => option.value === elements.crop.value)) elements.crop.value = 'all';
  elements.filterSummary.textContent = `${elements.year.selectedOptions[0].textContent} · ${elements.district.selectedOptions[0].textContent} · ${elements.crop.selectedOptions[0].textContent}`;
}
function selectDistrict(value) {
  const entry = entries.find((item) => key(item.district) === key(value)); if (!entry) return;
  selected = key(entry.district); elements.district.value = selected;
  elements.detailName.textContent = title(entry.district); elements.detailStatus.textContent = entry.lossPercent >= 30 ? 'Priority' : entry.lossPercent >= 15 ? 'Watch' : 'Stable';
  animateMetric(elements.detailProduction, entry.productionKg / 1000, (n) => compact(n,'T')); elements.detailCrop.textContent = title(entry.primaryCrop);
  animateMetric(elements.detailRows, entry.rows || 0, (n) => Math.round(n).toLocaleString()); animateMetric(elements.detailArea, entry.areaHa, (n) => compact(n,'Ha')); elements.detailLoss.textContent = percent(entry.lossPercent);
  if (layer) layer.eachLayer((item) => item.setStyle(key(item.feature.properties.__districtKey) === selected ? { ...style(item.feature), weight:2.5, color:'#1f2e17', fillOpacity:.95 } : style(item.feature)));
}
function renderRecent() {
  const rows = entries.slice().sort((a,b) => b.productionKg - a.productionKg).slice(0,5);
  elements.recent.innerHTML = rows.map((entry) => `<article class="recent-card" data-district="${key(entry.district)}"><span>${title(entry.primaryCrop)}</span><strong>${title(entry.district)}</strong><small>${compact(entry.productionKg / 1000,'T')} · ${percent(entry.lossPercent)} loss</small></article>`).join('');
  elements.recent.querySelectorAll('.recent-card').forEach((card) => card.addEventListener('click', () => { elements.district.value = card.dataset.district; load(); }));
  elements.recentStatus.textContent = `Top ${Math.min(5, rows.length)} of ${entries.length} districts`;
}
function renderCharts(series) {
  const context = elements.filterSummary.textContent;
  const selectedCrop = elements.crop.selectedOptions[0]?.textContent;
  const districtMap = new Map();
  breakdown.forEach((row) => { const item = districtMap.get(row.district) || { district:row.district, productionKg:0, areaHa:0, lossKg:0 }; item.productionKg += row.productionKg; item.areaHa += row.areaHa; item.lossKg += row.lossKg; districtMap.set(row.district,item); });
  const districtRows = [...districtMap.values()].map((row) => ({ ...row, lossPercent:row.productionKg > 0 ? row.lossKg / row.productionKg * 100 : null }));
  const cropRows = new Map(); breakdown.forEach((row) => { const item = cropRows.get(row.crop) || { crop:row.crop, productionKg:0 }; item.productionKg += row.productionKg; cropRows.set(row.crop,item); });
  const trend = series.filter((row) => elements.year.value === 'all' || String(row.year) === elements.year.value).map((row) => ({ label:`${String(row.year).slice(-2)} ${row.season}`, period:`${row.year} Season ${row.season}`, value:row.weightedProductionKg / 1000 }));
  renderChartGrid(elements.charts, [
    { type:'bar', title:'Top 10 Districts by Crop Production', eyebrow:'DISTRICT PRODUCTION', description:`Weighted production by district${selectedCrop === 'All crops' ? '' : ` for ${selectedCrop}`}.`, categoryLabel:'District', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:districtRows.sort((a,b) => b.productionKg-a.productionKg).slice(0,10).map((row) => ({ label:title(row.district), value:row.productionKg / 1000 })) },
    { type:'bar', title:'Top 10 Districts by Cultivated Area', eyebrow:'LAND SIGNAL', description:'Weighted cultivated area for the selected crop and districts.', categoryLabel:'District', measureLabel:'Cultivated area (hectares)', unit:'Ha', context, data:districtRows.sort((a,b) => b.areaHa-a.areaHa).slice(0,10).map((row) => ({ label:title(row.district), value:row.areaHa })) },
    { type:'donut', title:'Crop Mix in Selected District', eyebrow:'CROP PROFILE', description:'Weighted production by crop in the selected district scope.', categoryLabel:'Crop', measureLabel:'Weighted production (tonnes)', unit:'T', centerLabel:'TONNES', context, data:[...cropRows.values()].sort((a,b) => b.productionKg-a.productionKg).slice(0,6).map((row) => ({ label:title(row.crop), value:row.productionKg / 1000 })) },
    { type:'line', title:'Production by Survey Season', eyebrow:'SURVEY TREND', description:'Observed production by survey season for the selected district and crop.', categoryLabel:'Year and season', measureLabel:'Weighted production (tonnes)', unit:'T', context, data:trend }
  ]);
}
async function boundaries() { const response = await fetch('/api/rwanda-districts'); if (!response.ok) throw Error('Boundary data unavailable'); return response.json(); }
function renderMap(geojson) {
  if (!map) map = L.map(elements.map,{zoomControl:true,minZoom:7,maxZoom:11}).setView([-1.94,29.87],8);
  if (layer) layer.remove();
  layer = L.geoJSON(geojson,{style,onEachFeature:(feature,item)=>{const name=feature.properties.district||feature.properties.name;feature.properties.__districtKey=key(name);item.bindTooltip(title(name),{sticky:true});item.on({click:()=>{selected=key(name);elements.district.value=selected;load();},mouseover:()=>item.setStyle({...style(feature),weight:2}),mouseout:()=>{if(key(feature.properties.__districtKey)!==selected)item.setStyle(style(feature));}});}}).addTo(map);
  requestAnimationFrame(()=>{map.invalidateSize();map.fitBounds(layer.getBounds(),{padding:[12,12]});});
}
async function load() {
  controller?.abort(); controller = new AbortController(); elements.mapStatus.textContent = 'Updating'; elements.filterStatus.textContent = 'Updating insights…';
  try {
    const params = new URLSearchParams({ year:elements.year.value, district:'all' });
    const breakdownParams = new URLSearchParams({ year:elements.year.value, district:elements.district.value, crop:elements.crop.value });
    const seriesParams = new URLSearchParams({ districtCode:elements.district.value, cropCode:elements.crop.value });
    const [overviewRes, breakdownRes, seriesRes] = await Promise.all([
      fetch(`${apiBaseUrl}/api/overview?${params}`,{signal:controller.signal}), fetch(`${apiBaseUrl}/api/crop-district-breakdown?${breakdownParams}`,{signal:controller.signal}), fetch(`${apiBaseUrl}/api/timeseries?${seriesParams}`,{signal:controller.signal})
    ]);
    if (!overviewRes.ok || !breakdownRes.ok || !seriesRes.ok) throw Error('District comparisons are unavailable.');
    const [overview, breakdownData, series] = await Promise.all([overviewRes.json(),breakdownRes.json(),seriesRes.json()]);
    entries=overview.districtPerformance; breakdown=breakdownData.rows; updateFilters(overview.filters,overview);
    const visible = selected === 'all' || !selected ? entries : entries.filter((entry)=>key(entry.district)===selected);
    animateMetric(elements.count,visible.length); animateMetric(elements.production,visible.reduce((sum,row)=>sum+row.productionKg,0)/1000,(n)=>compact(n,'T'));
    const top=visible.slice().sort((a,b)=>b.productionKg-a.productionKg)[0]; elements.top.textContent=top?title(top.district):'—';
    animateMetric(elements.topValue,top?top.productionKg/1000:Number.NaN,(n)=>Number.isFinite(n)?compact(n,'T'):'—'); animateMetric(elements.crops,new Set(breakdown.map((row)=>row.cropCode)).size);
    renderRecent(); renderCharts(series);
    if (!layer) renderMap(await boundaries()); else layer.eachLayer((item)=>item.setStyle(style(item.feature)));
    if(selected) selectDistrict(selected);
    elements.mapStatus.textContent=`${visible.length} districts in view`; elements.filterStatus.textContent='Updated just now';
  } catch(error) { if(error.name!=='AbortError'){elements.mapStatus.textContent='Data unavailable';elements.filterStatus.textContent=error.message;} }
}
elements.year.addEventListener('change',load); elements.district.addEventListener('change',()=>{selected=elements.district.value==='all'?undefined:elements.district.value;load();}); elements.crop.addEventListener('change',load);
elements.filterReset.addEventListener('click',()=>{selected=undefined;elements.year.value='all';elements.district.value='all';elements.crop.value='all';load();});
load();
