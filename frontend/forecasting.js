import { animateMetric } from './lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const apiBaseUrl = window.__ISUKA_API_BASE_URL__ || '';
const elements = {
  district:document.getElementById('forecast-district'), crop:document.getElementById('forecast-crop'), accuracy:document.getElementById('forecast-accuracy'), districts:document.getElementById('forecast-districts'), horizon:document.getElementById('forecast-horizon'), model:document.getElementById('forecast-model'), status:document.getElementById('forecast-status'), charts:document.getElementById('forecast-charts'), metrics:document.getElementById('backtest-metrics'), backtest:document.getElementById('backtest-table'), importance:document.getElementById('feature-importance'), analysis:document.getElementById('forecast-analysis'), map:document.getElementById('forecast-map'), mapStatus:document.getElementById('map-status')
};
const controls = document.querySelector('.forecast-controls');
controls.insertAdjacentHTML('beforeend','<div class="shared-filter-actions"><span data-shared-filter-status>Ready</span><button type="button" data-shared-filter-reset>Reset</button></div>');
const filterStatus = controls.querySelector('[data-shared-filter-status]'), filterReset = controls.querySelector('[data-shared-filter-reset]');
let cache, activeModel='ensemble', map, boundaryLayer, historyController, selectionVersion=0;
const format = chartFormat.compact;
const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const title = (value) => String(value || '').replace(/\b\w/g,(letter)=>letter.toUpperCase());
const key = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g,'').replace('nyarugenege','nyarugenge');
const riskColor = (tier) => tier==='high'?'#a83c3c':tier==='moderate'?'#c08a3e':'#6fa83c';
const modelEntry = (entry) => entry?.models?.[activeModel] || {};
const futureModel = (period) => period?.productionKg !== undefined ? period : period?.models?.[activeModel] || {};
function filteredForecasts() { return cache.forecasts.filter((item)=>(elements.district.value==='all'||item.districtCode===elements.district.value)&&(elements.crop.value==='all'||item.cropCode===elements.crop.value)); }
function selectedForecast() { return filteredForecasts()[0]; }
function updateSelectors() {
  const oldDistrict=elements.district.value, oldCrop=elements.crop.value;
  const districts=[...new Set(cache.forecasts.map((row)=>row.districtCode))].sort();
  const crops=[...new Map(cache.forecasts.map((row)=>[row.cropCode,row.cropName||row.cropCode])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  elements.district.innerHTML='<option value="all">All districts</option>'+districts.map((value)=>`<option value="${value}">${title(value)}</option>`).join('');
  elements.crop.innerHTML='<option value="all">All crops</option>'+crops.map(([value,label])=>`<option value="${value}">${title(label)}</option>`).join('');
  elements.district.value=districts.includes(oldDistrict)?oldDistrict:'all'; elements.crop.value=crops.some(([value])=>value===oldCrop)?oldCrop:'all';
}
function renderKpis() {
  animateMetric(elements.accuracy,cache.backtest?.riskTierMatchPercent,percent);
  animateMetric(elements.districts,new Set(filteredForecasts().map((row)=>row.districtCode)).size);
  elements.horizon.textContent=`${cache.horizon.startYear}–${cache.horizon.endYear}`;
  elements.model.textContent=title(activeModel);
}
function renderBacktest() {
  const backtest=cache.backtest||{};
  elements.metrics.innerHTML=[['Tier match',percent(backtest.riskTierMatchPercent)],['Loss MAE',percent(backtest.lossMaePercent)],['Production RMSE',format(backtest.productionRmseKg,'kg')]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  const selected=selectedForecast();
  const comparisons=(backtest.comparisons||[]).filter((row)=>selected&&row.districtCode===selected.districtCode&&row.cropCode===selected.cropCode);
  elements.backtest.innerHTML=comparisons.length?`<table><thead><tr><th>Season</th><th>Predicted</th><th>Actual</th><th>Loss tier</th></tr></thead><tbody>${comparisons.map((row)=>`<tr><td>${row.season} 2025</td><td>${format(row.predicted?.productionKg,'kg')}</td><td>${format(row.actual?.weightedProductionKg,'kg')}</td><td>${row.predicted?.lossPercent==null?'—':`${percent(row.predicted.lossPercent)} → ${row.actual?.lossPercent==null?'—':percent(row.actual.lossPercent)}`}</td></tr>`).join('')}</tbody></table>`:'<p class="empty-state">No holdout comparison for this selection.</p>';
  return comparisons;
}
function renderImportance() {
  const rows=cache.featureImportances||[], max=Math.max(...rows.map((row)=>row.importance),1);
  elements.importance.innerHTML=rows.length?`<p class="importance-note">Model signals describe the fitted patterns; they are not evidence of cause.</p>${rows.map((row)=>`<div class="importance-row"><span>${row.feature} <small>${row.target||'model'}</small></span><span class="importance-track"><i style="width:${row.importance/max*100}%"></i></span><span class="importance-value">${(row.importance*100).toFixed(1)}%</span></div>`).join('')}`:'<p class="empty-state">No model signal metadata is available.</p>';
}
function renderAnalysis(forecast, series) {
  const future=(forecast.future||[]).map((row)=>({row,model:futureModel(row)})).filter((entry)=>Number.isFinite(entry.model.productionKg));
  const actual=series.filter((row)=>Number.isFinite(row.weightedProductionKg)), recent=actual.at(-1), first=future[0]?.model, last=future.at(-1)?.model;
  const movement=first&&last?last.productionKg>first.productionKg*1.05?'The model expects production to rise across the forecast horizon.':last.productionKg<first.productionKg*.95?'The model expects production to fall across the forecast horizon.':'The model expects production to stay broadly stable.':'There is not enough supported history to describe a future movement.';
  const confidence=forecast.lowHistory?'Limited history means higher uncertainty.':`${forecast.yearsAvailable} years of usable history.`;
  elements.analysis.innerHTML=`<div class="analysis-summary"><strong>${movement}</strong><span>${confidence}</span></div><div class="analysis-grid"><div><span>Recent observed production</span><strong>${format(recent?.weightedProductionKg,'kg')}</strong><small>${recent?`${recent.year} Season ${recent.season}`:'Unavailable'}</small></div><div><span>First forecast loss</span><strong>${percent(first?.lossPercent)}</strong><small>${future[0]?`${future[0].row.year} Season ${future[0].row.season}`:'Unavailable'}</small></div><div><span>Last forecast loss</span><strong>${percent(last?.lossPercent)}</strong><small>${future.at(-1)?`${future.at(-1).row.year} Season ${future.at(-1).row.season}`:'Unavailable'}</small></div><div><span>Risk tier</span><strong>${first?.riskTier?`${title(first.riskTier)} risk`:'Unavailable'}</strong><small>15% and 30% thresholds</small></div></div><p>Forecasts are estimates based on survey history; they do not include future weather, prices, pests, or policy changes.</p>`;
}
function renderCharts(series, forecast, comparisons) {
  const context=`${elements.district.selectedOptions[0].textContent} · ${elements.crop.selectedOptions[0].textContent} · ${title(activeModel)} model`;
  const pairContext=`${title(forecast.districtCode)} · ${title(forecast.cropName||forecast.cropCode)} · ${title(activeModel)} model`;
  const future=(forecast.future||[]).map((row)=>({label:`${String(row.year).slice(-2)} ${row.season}`,period:`Forecast · ${row.year} Season ${row.season}`,value:futureModel(row).productionKg/1000})).filter((row)=>Number.isFinite(row.value));
  const actual=series.filter((row)=>Number.isFinite(row.weightedProductionKg)).slice(-6).map((row)=>({label:`${String(row.year).slice(-2)} ${row.season}`,period:`Observed · ${row.year} Season ${row.season}`,value:row.weightedProductionKg/1000}));
  const allRows=filteredForecasts(), districtMap=new Map(), cropMap=new Map();
  allRows.forEach((entry)=>{const data=futureModel(entry.future?.[0]||entry);if(!Number.isFinite(data.productionKg))return;const district=districtMap.get(entry.districtCode)||{value:0};district.value+=data.productionKg/1000;districtMap.set(entry.districtCode,district);const crop=cropMap.get(entry.cropName||entry.cropCode)||{value:0};crop.value+=data.productionKg/1000;cropMap.set(entry.cropName||entry.cropCode,crop);});
  const riskCounts=['low','moderate','high'].map((tier)=>({label:`${title(tier)} risk`,value:allRows.filter((entry)=>futureModel(entry.future?.[0]||entry).riskTier===tier).length,color:riskColor(tier)}));
  const groups=comparisons.map((row)=>({label:`${row.season} 2025`,period:`2025 Season ${row.season}`,series:[{name:'Predicted',value:Number.isFinite(row.predicted?.productionKg)?row.predicted.productionKg/1000:null,color:'#6fa83c'},{name:'Actual',value:Number.isFinite(row.actual?.weightedProductionKg)?row.actual.weightedProductionKg/1000:null,color:'#c08a3e'}]}));
  renderChartGrid(elements.charts,[
    {type:'line',title:'Forecast Production by Season',eyebrow:'OBSERVED + FORECAST',description:`Historical production for ${title(forecast.cropName||forecast.cropCode)} in ${title(forecast.districtCode)}, followed by the selected model forecast.`,categoryLabel:'Survey period',measureLabel:'Weighted production (tonnes)',unit:'T',context:pairContext,data:[...actual,...future]},
    {type:'grouped',title:'2025 Backtest: Predicted vs Actual',eyebrow:'PREDICTED VS ACTUAL',description:'Holdout production comparison for this district and crop.',categoryLabel:'Season',measureLabel:'Weighted production (tonnes)',unit:'T',context:pairContext,data:groups},
    {type:'bar',title:'Top 10 Districts by Forecast Output',eyebrow:'DISTRICT OUTLOOK',description:'Forecast production ranked across the current crop selection.',categoryLabel:'District',measureLabel:'Forecast production (tonnes)',unit:'T',context,data:[...districtMap].sort((a,b)=>b[1].value-a[1].value).slice(0,10).map(([label,row])=>({label:title(label),value:row.value}))},
    {type:'donut',title:'Forecasts by Risk Tier',eyebrow:'RISK OUTLOOK',description:'Eligible district and crop forecasts grouped by risk tier.',categoryLabel:'Risk tier',measureLabel:'Forecast pairs',unit:'pairs',centerLabel:'PAIRS',context,data:riskCounts}
  ]);
}
async function renderSelection() {
  const version=++selectionVersion;
  historyController?.abort();
  const forecast=selectedForecast();
  if(!forecast){elements.status.textContent='No forecast for this filter';elements.charts.innerHTML='<p class="empty-state">No forecast is available for this district and crop.</p>';elements.backtest.innerHTML='<p class="empty-state">No matching backtest records.</p>';filterStatus.textContent='Updated just now';return;}
  elements.status.textContent=forecast.future?.[0]?.clamping?.lowConfidence?'Low confidence':forecast.lowHistory?'Limited history':`${forecast.yearsAvailable} years available`;
  const comparisons=renderBacktest();
  renderKpis();renderCharts([],forecast,comparisons);renderAnalysis(forecast,[]);
  filterStatus.textContent='Forecast ready - loading history...';
  historyController=new AbortController();
  fetch(`${apiBaseUrl}/api/timeseries?districtCode=${encodeURIComponent(forecast.districtCode)}&cropCode=${encodeURIComponent(forecast.cropCode)}`,{signal:historyController.signal,cache:'no-store'})
    .then((response)=>{if(!response.ok)throw new Error(`Historical series returned ${response.status}`);return response.json();})
    .then((series)=>{if(version!==selectionVersion)return;renderCharts(series,forecast,comparisons);renderAnalysis(forecast,series);filterStatus.textContent='Updated just now';})
    .catch((error)=>{if(error.name==='AbortError'||version!==selectionVersion)return;console.warn('Forecast history unavailable; showing the published forecast.',error);filterStatus.textContent='Forecast ready - history unavailable';});
}
async function renderMap() {
  const response=await fetch('/api/rwanda-districts'); if(!response.ok)throw new Error('Boundary service unavailable'); const geojson=await response.json();
  const totals=new Map(); cache.forecasts.forEach((entry)=>{const data=futureModel(entry.future?.[0]||entry), productionKg=Number(data.productionKg), lossPercent=Number(data.lossPercent);if(!Number.isFinite(productionKg)||!Number.isFinite(lossPercent))return;const k=key(entry.districtCode),row=totals.get(k)||{productionKg:0,weightedLoss:0,cropCount:0};row.productionKg+=productionKg;row.weightedLoss+=productionKg*lossPercent;row.cropCount++;totals.set(k,row);});
  const forecastByDistrict=new Map([...totals].map(([k,row])=>{const lossPercent=row.productionKg?row.weightedLoss/row.productionKg:null;return[k,{...row,lossPercent,riskTier:lossPercent>=30?'high':lossPercent>=15?'moderate':'low'}]}));
  if(!map)map=L.map(elements.map,{zoomControl:true,minZoom:7,maxZoom:11}).setView([-1.94,29.87],8);if(boundaryLayer)boundaryLayer.remove();
  boundaryLayer=L.geoJSON(geojson,{style:(feature)=>{const row=forecastByDistrict.get(key(feature.properties.district||feature.properties.name));return{color:'#fff',weight:1.2,fillColor:riskColor(row?.riskTier),fillOpacity:.78};},onEachFeature:(feature,layer)=>{const row=forecastByDistrict.get(key(feature.properties.district||feature.properties.name));layer.bindTooltip(`<strong>${title(feature.properties.district||feature.properties.name)}</strong><br>Weighted forecast loss: ${percent(row?.lossPercent)}<br>Risk: ${row?.riskTier||'Unavailable'}<br>${row?.cropCount||0} crop forecasts`,{sticky:true});}}).addTo(map);
  requestAnimationFrame(()=>{map.invalidateSize();map.fitBounds(boundaryLayer.getBounds(),{padding:[12,12]});});elements.mapStatus.textContent=`${forecastByDistrict.size} districts forecasted`;
}
async function loadModel() { filterStatus.textContent='Loading forecast...';const response=await fetch(`${apiBaseUrl}/api/forecast?model=${activeModel}`,{cache:'no-store'});if(!response.ok)throw new Error(`Forecast data returned ${response.status}`);cache=await response.json();updateSelectors();renderImportance();await renderSelection();try{await renderMap();}catch(error){elements.mapStatus.textContent='Map unavailable';console.warn('Forecast map unavailable.',error);} }
async function init() {
  document.querySelectorAll('[data-model]').forEach((button)=>button.addEventListener('click',()=>{activeModel=button.dataset.model;document.querySelectorAll('[data-model]').forEach((item)=>{item.classList.toggle('is-active',item===button);item.setAttribute('aria-pressed',String(item===button));});loadModel().catch(showError);}));
  elements.district.addEventListener('change',()=>renderSelection().catch(showError));elements.crop.addEventListener('change',()=>renderSelection().catch(showError));
  filterReset.addEventListener('click',()=>{elements.district.value='all';elements.crop.value='all';renderSelection().catch(showError);});
  await loadModel();
}
function showError(error) { elements.status.textContent='Data unavailable';elements.mapStatus.textContent=error.message;filterStatus.textContent='Update failed';elements.charts.innerHTML=`<p class="empty-state">${error.message}</p>`; }
init().catch(showError);
