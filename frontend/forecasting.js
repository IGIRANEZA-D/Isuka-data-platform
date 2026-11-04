import { animateMetric } from './lib/metric-animation.js';
import { renderChartGrid, chartFormat } from './chart-kit.js';

const elements = {
  district:document.getElementById('forecast-district'), crop:document.getElementById('forecast-crop'), accuracy:document.getElementById('forecast-accuracy'), districts:document.getElementById('forecast-districts'), horizon:document.getElementById('forecast-horizon'), model:document.getElementById('forecast-model'), charts:document.getElementById('forecast-charts'), metrics:document.getElementById('backtest-metrics'), backtest:document.getElementById('backtest-table'), productionOutlook:document.getElementById('production-outlook-chart'), analysis:document.getElementById('forecast-analysis'), map:document.getElementById('forecast-map'), mapStatus:document.getElementById('map-status')
};
const controls = document.querySelector('.forecast-controls');
controls.insertAdjacentHTML('beforeend','<div class="shared-filter-actions"><span data-shared-filter-status>Ready</span><button type="button" data-shared-filter-reset>Reset</button></div>');
const filterStatus = controls.querySelector('[data-shared-filter-status]'), filterReset = controls.querySelector('[data-shared-filter-reset]');
filterStatus.hidden = true;
let cache, forecastCachePromise, boundaryDataPromise, activeModel='ensemble', map, boundaryLayer, mapRenderVersion=0, modelLoadVersion=0;
const format = chartFormat.compact;
const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const title = (value) => String(value || '').replace(/\b\w/g,(letter)=>letter.toUpperCase());
const key = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g,'').replace('nyarugenege','nyarugenge');
const riskColor = (tier) => tier==='high'?'#a83c3c':tier==='moderate'?'#c08a3e':'#6fa83c';
const modelEntry = (entry) => entry?.models?.[activeModel] || {};
const futureModel = (period) => period?.productionKg !== undefined ? period : period?.models?.[activeModel] || {};
function boundaryCollection(artifact) {
  if(!Array.isArray(artifact?.districts)||artifact.districts.length!==30)throw new Error(`District boundary data is incomplete (${artifact?.districts?.length||0} of 30).`);
  const degreesPerMap=2.1;
  return {type:'FeatureCollection',features:artifact.districts.map((district)=>{
    const polygons=district.polygons.map((polygon)=>polygon.map((ring)=>ring.map(([x,y])=>[29.87+(x-.5)*degreesPerMap,-1.94-(y-.5)*degreesPerMap])));
    const isPolygon=polygons.length===1;
    return {type:'Feature',properties:{district:district.name,name:district.name,code_dist:district.code},geometry:{type:isPolygon?'Polygon':'MultiPolygon',coordinates:isPolygon?polygons[0]:polygons}};
  })};
}
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
function renderProductionOutlook() {
  const actual=new Map(), projected=new Map();
  filteredForecasts().forEach((entry)=>{
    (entry.history||[]).forEach((row)=>{
      if(!Number.isFinite(row.weightedProductionKg))return;
      actual.set(row.year,(actual.get(row.year)||0)+row.weightedProductionKg/1000);
    });
    (entry.future||[]).forEach((period)=>{
      const value=futureModel(period).productionKg;
      if(Number.isFinite(value))projected.set(period.year,(projected.get(period.year)||0)+value/1000);
    });
  });
  const data=[...actual].sort(([a],[b])=>a-b).map(([year,value])=>({label:String(year),period:`Observed · Seasons A–C · ${year}`,value,kind:'actual'}));
  [...projected].sort(([a],[b])=>a-b).forEach(([year,value])=>data.push({label:String(year),period:`Projected · Seasons A–C · ${year}`,value,kind:'forecast'}));
  renderChartGrid(elements.productionOutlook,[{type:'forecast-line',title:'Annual agricultural production · tonnes',eyebrow:'OBSERVED + PROJECTED',description:'Annual production sums Seasons A, B and C across the selected district and crop filters. Projected years use the active forecasting model.',categoryLabel:'Year',measureLabel:'Weighted production (tonnes)',unit:'tonnes',context:`${elements.district.selectedOptions[0]?.textContent||'All districts'} · ${elements.crop.selectedOptions[0]?.textContent||'All crops'} · ${title(activeModel)} model`,data}]);
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
function renderSelection() {
  const forecast=selectedForecast();
  renderProductionOutlook();
  if(!forecast){elements.charts.innerHTML='<p class="empty-state">No forecast is available for this district and crop.</p>';elements.backtest.innerHTML='<p class="empty-state">No matching backtest records.</p>';filterStatus.textContent='No forecasts match these filters';return;}
  const confidence=forecast.future?.[0]?.clamping?.lowConfidence?'limited confidence':forecast.lowHistory?'limited history':`${forecast.yearsAvailable} years of history`;
  const comparisons=renderBacktest();
  const history=forecast.history||[];
  renderKpis();renderCharts(history,forecast,comparisons);renderAnalysis(forecast,history);
  filterStatus.textContent=`${filteredForecasts().length} pairs · ${confidence}`;
}
function showMapError() {
  map=null;
  boundaryLayer=null;
  elements.mapStatus.textContent='Map unavailable';
  elements.map.innerHTML='<div class="forecast-map-error"><span>District boundaries could not be loaded.</span><button type="button">Retry map</button></div>';
  elements.map.querySelector('button')?.addEventListener('click',()=>renderMap().catch((error)=>{console.warn('District boundaries could not be loaded.',error);showMapError();}));
}
async function renderMap() {
  const version=++mapRenderVersion, visibleForecasts=cache?filteredForecasts():[];
  elements.mapStatus.textContent=cache?'Updating map':'Loading district boundaries...';
  if(!window.L)throw new Error('District map renderer unavailable.');
  if(!boundaryDataPromise)boundaryDataPromise=fetch('/data/landing-art.json',{cache:'force-cache',signal:AbortSignal.timeout(10000)}).then((response)=>{if(!response.ok)throw new Error(`District map asset returned ${response.status}`);return response.json();}).then(boundaryCollection).catch((error)=>{boundaryDataPromise=null;throw error;});
  const geojson=await boundaryDataPromise; if(version!==mapRenderVersion)return;
  const totals=new Map(); visibleForecasts.forEach((entry)=>{(entry.future||[]).filter((period)=>period.year===cache?.horizon?.startYear).forEach((period)=>{const data=futureModel(period), productionKg=Number(data.productionKg), lossPercent=Number(data.lossPercent);if(!Number.isFinite(productionKg)||!Number.isFinite(lossPercent))return;const k=key(entry.districtCode),row=totals.get(k)||{productionKg:0,weightedLoss:0,cropCount:0};row.productionKg+=productionKg;row.weightedLoss+=productionKg*lossPercent;row.cropCount++;totals.set(k,row);});});
  const forecastByDistrict=new Map([...totals].map(([k,row])=>{const lossPercent=row.productionKg?row.weightedLoss/row.productionKg:null;return[k,{...row,lossPercent,riskTier:lossPercent>=30?'high':lossPercent>=15?'moderate':'low'}]}));
  if(!map)map=L.map(elements.map,{zoomControl:true,minZoom:7,maxZoom:11}).setView([-1.94,29.87],8);if(boundaryLayer)boundaryLayer.remove();
  boundaryLayer=L.geoJSON(geojson,{style:(feature)=>{const row=forecastByDistrict.get(key(feature.properties.district||feature.properties.name));return{color:'#fff',weight:1.2,fillColor:row?riskColor(row.riskTier):'#d8e2d2',fillOpacity:row&&row.cropCount?0.78:0.48};},onEachFeature:(feature,layer)=>{const districtName=feature.properties.district||feature.properties.name;const row=forecastByDistrict.get(key(districtName));layer.bindTooltip(`<strong>${title(districtName)}</strong><br>Weighted forecast loss: ${percent(row?.lossPercent)}<br>Risk: ${row?.riskTier?`${row.riskTier} risk`:'No forecast for this filter'}<br>${row?.cropCount||0} crop forecasts`,{sticky:true});layer.on({click:()=>{const option=[...elements.district.options].find((item)=>item.value!=='all'&&key(item.value)===key(districtName));if(option){elements.district.value=option.value;elements.district.dispatchEvent(new Event('change'));}}});}}).addTo(map);
  requestAnimationFrame(()=>{map.invalidateSize();map.fitBounds(boundaryLayer.getBounds(),{padding:[12,12]});});elements.mapStatus.textContent=cache?`${forecastByDistrict.size} of 30 districts in this view`:'30 districts · forecast loading';
}
async function getForecastCache() {
  if(!forecastCachePromise)forecastCachePromise=fetch('/data/forecast-cache.json',{cache:'force-cache',signal:AbortSignal.timeout(15000)}).then((response)=>{if(!response.ok)throw new Error(`Published forecast data returned ${response.status}`);return response.json();}).then((data)=>{if(!Array.isArray(data.forecasts))throw new Error('Published forecast data is incomplete.');return data;}).catch((error)=>{forecastCachePromise=null;throw error;});
  return forecastCachePromise;
}
async function loadModel() { const version=++modelLoadVersion;filterStatus.textContent='Loading forecast data...';const nextCache=await getForecastCache();if(version!==modelLoadVersion)return;cache=nextCache;updateSelectors();renderSelection();try{await renderMap();}catch(error){if(version===modelLoadVersion){console.warn('Forecast map unavailable.',error);showMapError();}} }
async function init() {
  document.querySelectorAll('[data-model]').forEach((button)=>button.addEventListener('click',()=>{activeModel=button.dataset.model;document.querySelectorAll('[data-model]').forEach((item)=>{item.classList.toggle('is-active',item===button);item.setAttribute('aria-pressed',String(item===button));});loadModel().catch(showError);}));
  const refreshSelection=()=>{renderSelection().catch(showError);renderMap().catch((error)=>{console.warn('Forecast map could not be updated for this filter.',error);showMapError();});};
  elements.district.addEventListener('change',refreshSelection);elements.crop.addEventListener('change',refreshSelection);
  filterReset.addEventListener('click',()=>{elements.district.value='all';elements.crop.value='all';refreshSelection();});
  renderMap().catch((error)=>{console.warn('District boundaries could not be loaded.',error);showMapError();});
  await loadModel();
}
function showError(error) { if(map)elements.mapStatus.textContent='District boundaries shown · forecast unavailable';filterStatus.textContent='Forecast data unavailable';elements.charts.replaceChildren();const panel=document.createElement('div');panel.className='forecast-load-error';const message=document.createElement('p');message.textContent=`Forecast data could not be loaded: ${error.message}`;const retry=document.createElement('button');retry.type='button';retry.textContent='Retry data';retry.addEventListener('click',()=>loadModel().catch(showError));panel.append(message,retry);elements.charts.append(panel); }
init().catch(showError);
