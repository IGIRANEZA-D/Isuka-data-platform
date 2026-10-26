const crypto = require('node:crypto');

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const SEASONS = ['A', 'B', 'C'];
const MIN_RECORDS = 30;
const METRICS = {
  production: { label: 'Production', unit: 'tonnes', definition: 'Survey-weighted crop production, converted from kilograms to tonnes.', source: 'NISR Seasonal Agricultural Survey production fields.' },
  area: { label: 'Cultivated area', unit: 'hectares', definition: 'Survey-weighted cultivated area in hectares.', source: 'NISR Seasonal Agricultural Survey area fields.' },
  yield: { label: 'Yield', unit: 'tonnes per hectare', definition: 'Survey-weighted production divided by survey-weighted area.', source: 'Derived from the same verified production and area aggregates.' },
  lossRate: { label: 'Recorded loss rate', unit: '%', definition: 'Recorded post-harvest loss as a share of weighted production.', source: 'NISR Seasonal Agricultural Survey loss fields; recorded loss is not total waste.' },
  lossByStage: { label: 'Recorded loss by stage', unit: 'tonnes', definition: 'Confirmed recorded loss by post-harvest stage, with each stage share of recorded loss.', source: 'Confirmed kilogram stage groups from the existing Loss Planner aggregate.' }
};
const CALC_VERSION = 'loss-label-resolver-v1-crop-labels-v1-production-aliases-v1';
function editDistance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prior=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prior+(a[i-1]===b[j-1]?0:1));prior=old;}}return row[b.length];}

function validateRequest(input = {}) {
  const errors = [];
  const metric = String(input.metric || '').trim();
  if (!METRICS[metric]) errors.push({ code: 'UNKNOWN_METRIC', field: 'metric' });
  const crop = input.crop === 'all' || input.crop == null ? 'all' : String(input.crop).trim();
  const districts = input.districts === 'all' || input.districts == null ? 'all' : input.districts;
  if (districts !== 'all' && (!Array.isArray(districts) || districts.some((d) => typeof d !== 'string'))) errors.push({ code: 'INVALID_DISTRICTS', field: 'districts' });
  const years = input.years === 'all' || input.years == null ? YEARS.map(String) : (Array.isArray(input.years) ? input.years.map(String) : [String(input.years)]);
  if (years.some((y) => !YEARS.includes(Number(y)))) errors.push({ code: 'INVALID_YEARS', field: 'years' });
  const seasons = input.seasons === 'all' || (typeof input.seasons === 'string' && input.seasons.toLowerCase() === 'all') || input.seasons == null ? [...SEASONS] : (Array.isArray(input.seasons) ? input.seasons.map((s) => String(s).toUpperCase()) : [String(input.seasons).toUpperCase()]);
  if (seasons.some((s) => !SEASONS.includes(s))) errors.push({ code: 'INVALID_SEASONS', field: 'seasons' });
  const breakdown = input.breakdown || 'none';
  if (!['none', 'year', 'season', 'district', 'crop', 'stage'].includes(breakdown)) errors.push({ code: 'INVALID_BREAKDOWN', field: 'breakdown' });
  if (input.compare && (!['district', 'crop'].includes(input.compare.type) || typeof input.compare.value !== 'string')) errors.push({ code: 'INVALID_COMPARE', field: 'compare' });
  if (errors.length) return { errors };
  const normalizedBreakdown = metric === 'lossByStage' && breakdown === 'none' ? 'stage' : breakdown;
  return { request: { metric, crop, districts: districts === 'all' ? 'all' : [...new Set(districts)], years: [...new Set(years)].sort(), seasons: [...new Set(seasons)].sort(), breakdown:normalizedBreakdown, ...(input.compare ? { compare: input.compare } : {}), format: ['table', 'chart', 'csv'].includes(input.format) ? input.format : 'table' } };
}

function makeCatalog(rows) {
  const crops = new Map(); const districts = new Map(); const coverage = {};
  for (const row of rows) {
    crops.set(row.cropCode, row.cropName); districts.set(row.districtCode, row.districtCode);
    const key = [row.cropCode, row.districtCode, row.year, row.season].join('|');
    coverage[key] = (coverage[key] || 0) + row.rowCount;
  }
  return { crops: [...crops].map(([code, name]) => ({ code, name })).sort((a,b)=>a.name.localeCompare(b.name)), districts: [...districts].map(([code])=>({ code, name: code.replace(/\b\w/g, c=>c.toUpperCase()) })).sort((a,b)=>a.name.localeCompare(b.name)), years: YEARS, seasons: SEASONS, metrics: Object.entries(METRICS).map(([id, m])=>({ id, ...m })), coverage };
}

function evaluate(input, rows, options = {}) {
  const checked = validateRequest(input);
  if (checked.errors) return { errors: checked.errors };
  const request = checked.request;
  const observed = makeCatalog(rows);
  const cropCodes = new Set(observed.crops.map(c=>c.code));
  const districtCodes = new Set(observed.districts.map(d=>d.code));
  if(request.crop!=='all'&&!cropCodes.has(request.crop))return {errors:[{code:'UNKNOWN_CROP',field:'crop'}]};
  if(request.districts!=='all'&&request.districts.some(d=>!districtCodes.has(d)))return {errors:[{code:'UNKNOWN_DISTRICT',field:'districts'}]};
  if(request.compare&&(request.compare.type==='crop'?!cropCodes.has(request.compare.value):!districtCodes.has(request.compare.value)))return {errors:[{code:'UNKNOWN_COMPARISON',field:'compare'}]};
  if(request.breakdown==='stage'&&request.metric!=='lossByStage')return {errors:[{code:'STAGE_DATA_UNAVAILABLE',field:'breakdown'}]};
  if(request.metric==='lossByStage')return evaluateStageRequest(request,options.stageData,options.stageCoverage,options.baseUrl);
  const selected = rows.filter((r) => request.years.includes(String(r.year)) && request.seasons.includes(r.season)
    && (request.crop === 'all' || request.crop === r.cropCode || (request.compare?.type === 'crop' && request.compare.value === r.cropCode))
    && (request.districts === 'all' || request.districts.includes(r.districtCode) || (request.compare?.type === 'district' && request.compare.value === r.districtCode)));
  const buckets = new Map();
  for (const r of selected) {
    let key = 'all';
    if (request.compare?.type === 'district') key = `district:${r.districtCode}`;
    else if (request.compare?.type === 'crop') key = `crop:${r.cropCode}`;
    else if (request.breakdown === 'year') key = String(r.year);
    if (request.breakdown === 'season') key = r.season;
    if (request.breakdown === 'district') key = r.districtCode;
    if (request.breakdown === 'crop') key = r.cropCode;
    const b = buckets.get(key) || { year:r.year, season:r.season, districtCode:r.districtCode, cropCode:r.cropCode, cropName:r.cropName, productionKg:0, areaHa:0, lossKg:0, records:0 };
    b.productionKg += r.weightedProductionKg; b.areaHa += r.weightedAreaHa; b.lossKg += r.lossKg || 0; b.records += r.rowCount; buckets.set(key,b);
  }
  const raw = [...buckets].map(([label,b])=>({ label:label.startsWith('district:')?b.districtCode:label.startsWith('crop:')?b.cropName:label, ...b }));
  let suppressedCells = 0;
  const resultRows = raw.map((b) => {
    if (b.records < MIN_RECORDS) { suppressedCells++; return { label:b.label, status:'insufficient', value:null, records:null }; }
    const value = request.metric === 'production' ? b.productionKg / 1000 : request.metric === 'area' ? b.areaHa : request.metric === 'yield' ? (b.areaHa > 0 ? b.productionKg / b.areaHa / 1000 : null) : (b.productionKg > 0 ? b.lossKg / b.productionKg * 100 : null);
    return { label:b.label, status:value == null ? 'none' : 'ok', value, unit:METRICS[request.metric].unit, records:b.records, year:b.year, season:b.season, districtCode:b.districtCode, cropCode:b.cropCode, cropName:b.cropName };
  });
  const status = !resultRows.some((r)=>r.status==='ok') ? 'unavailable' : resultRows.some((r)=>r.status!=='ok') ? 'partial' : 'complete';
  const periods = [...new Set(selected.map((r)=>`${r.year}-${r.season}`))].sort();
  const coverageGrid = request.years.flatMap(year => request.seasons.map(season => {
    const matching = selected.filter(r=>String(r.year)===year && r.season===season);
    const count = matching.reduce((sum,r)=>sum+r.rowCount,0);
    return { year:Number(year), season, status:count===0?'none':count<MIN_RECORDS?'insufficient':'ok', records:count<MIN_RECORDS?null:count };
  }));
  const citation = `Source: NISR Seasonal Agricultural Survey (${periods.length?periods.join(', '):'no matching periods'}), processed by Isuka (calculation ${CALC_VERSION}). Not an official NISR statement.`;
  const alternatives = [];
  if(status!=='complete'){
    for(const year of [...YEARS].map(String).sort((a,b)=>Math.abs(Number(a)-2025)-Math.abs(Number(b)-2025))){
      if(alternatives.length>=3)break;
      const candidate={...request,years:[year]};
      const count=rows.filter(r=>String(r.year)===year&&candidate.seasons.includes(r.season)&&(candidate.crop==='all'||r.cropCode===candidate.crop)&&(candidate.districts==='all'||candidate.districts.includes(r.districtCode))).reduce((sum,r)=>sum+r.rowCount,0);
      if(count>=MIN_RECORDS&&JSON.stringify(candidate)!==JSON.stringify(request))alternatives.push(candidate);
    }
    if(alternatives.length<3&&request.seasons.length<3){const candidate={...request,seasons:[...SEASONS]};const count=rows.filter(r=>request.years.includes(String(r.year))&&(candidate.crop==='all'||r.cropCode===candidate.crop)&&(candidate.districts==='all'||candidate.districts.includes(r.districtCode))).reduce((sum,r)=>sum+r.rowCount,0);if(count>=MIN_RECORDS)alternatives.push(candidate);}
  }
  const permalink = options.baseUrl ? `${options.baseUrl}/dashboard/?assistant=${encodeURIComponent(JSON.stringify(request))}` : '';
  const selectedCropName=request.crop==='all'?'':` for ${observed.crops.find(crop=>crop.code===request.crop)?.name||request.crop}`;
  return { request, interpretation:`${METRICS[request.metric].label}${selectedCropName} · ${request.years.join('–')} · ${request.seasons.join(', ')}`, status, rows:resultRows, series:resultRows.filter(r=>r.status==='ok').map(r=>({label:r.label,value:r.value})), coverageGrid, alternatives, caveats:[...(request.metric==='lossRate'?['Loss figures are recorded losses, not total waste.']:[]),'Survey data is self-reported by farmers.'], meta:{calcVersion:CALC_VERSION,generatedAt:new Date().toISOString(),periods,recordsUsed:resultRows.reduce((s,r)=>s+(r.records||0),0),suppressedCells,aggregation:'Selected period totals are summed from the existing weighted aggregate outputs.'}, citation, permalink };
}

function evaluateStageRequest(request,stageData,stageCoverage,baseUrl){
  if(!stageData)return {errors:[{code:'STAGE_DATA_UNAVAILABLE',field:'metric'}]};
  const selected=stageData.rows.filter(row=>(request.districts==='all'||request.districts.includes(row.d))&&(request.crop==='all'||request.crop===row.c));
  const records=selected.reduce((sum,row)=>sum+(row.stageRecords||0),0);
  const totalLossKg=selected.reduce((sum,row)=>sum+(Number.isFinite(row.totalLossKg)?row.totalLossKg:0),0);
  let suppressedCells=0;
  const resultRows=stageData.stages.map(stage=>{
    if(stage.unitStatus!=='confirmed')return {label:stage.label,status:'none',value:null,records:null};
    if(records<MIN_RECORDS){suppressedCells++;return {label:stage.label,status:'insufficient',value:null,records:null};}
    const kg=selected.reduce((sum,row)=>sum+(Number.isFinite(row.stageKg?.[stage.id])?row.stageKg[stage.id]:0),0);
    const shareOfRecordedLossPct=totalLossKg>0?kg/totalLossKg*100:null;
    return {label:shareOfRecordedLossPct===null?stage.label:`${stage.label} · ${shareOfRecordedLossPct.toFixed(1)}%`,status:'ok',value:kg/1000,unit:'tonnes',shareOfRecordedLossPct,records};
  });
  const status=!resultRows.some(r=>r.status==='ok')?'unavailable':resultRows.some(r=>r.status!=='ok')?'partial':'complete';
  const periods=(stageData.meta.periods||[]).map(p=>`${p.year}-${p.season}`);
  const citation=`Source: NISR Seasonal Agricultural Survey (${periods.length?periods.join(', '):'no matching periods'}), processed by Isuka (calculation ${stageData.meta.calcVersion}). Not an official NISR statement.`;
  const grid=stageCoverage||[];
  const alternatives=[];
  const permalink=baseUrl?`${baseUrl}/dashboard/?assistant=${encodeURIComponent(JSON.stringify(request))}`:'';
  return {request,interpretation:`Recorded loss by stage · ${request.years.join('–')} · ${request.seasons.join(', ')}`,status,rows:resultRows,series:resultRows.filter(r=>r.status==='ok').map(r=>({label:r.label,value:r.value})),coverageGrid:grid,alternatives,caveats:['Stage data is incomplete; coverage varies by stage, period, crop and district. Storage loss may be under-recorded.','Loss figures are recorded losses, not total waste.','Survey data is self-reported by farmers.'],meta:{calcVersion:stageData.meta.calcVersion,generatedAt:stageData.meta.generatedAt,periods,recordsUsed:records,suppressedCells,aggregation:stageData.meta.aggregation},citation,permalink};
}

function parseQuestion(text, catalog) {
  const q = String(text||'').trim().slice(0,300); const n=q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const phoneLike=(q.match(/\+?\d[\d\s().-]{7,}\d/g)||[]).some(value=>value.replace(/\D/g,'').length>=9);
  if (/^(hi|hey|hello|hola|muraho|good\s+(morning|afternoon|evening)|howdy|yo)([\s,!.?]|$)/.test(n) || /^(hi|hey|hello|muraho)[\s!.?]*$/.test(n)) return { greeting:true };
  if (/\bfarmer ids?\b|\b(farmer names?|respondent|raw records|plot level|phone|email|personal|advice|password|my name is|my phone|my email|individual farmer|specific farmer|household id|respondent id)\b/.test(n) || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(q) || phoneLike) return { refusal:true };
  const cropAliases=[['maize',['maize','corn','ibigori']],['beans',['beans','bean','ibishyimbo']],['irish potato',['irish potato','potato','ibirayi']],['cassava',['cassava','imyumbati']],['banana for beer',['banana for beer','bananas for beer','banana beer','beer banana','beer bananas','beer banana crop']]];
  const kinyarwandaHit=['ibigori','ibishyimbo','ibirayi','imyumbati'].some(term=>n.includes(term));
  const cropHits=catalog.crops.filter(c=>n.includes(c.name.toLowerCase()));
  const cropAliasHit=cropAliases.map(([name,terms])=>terms.some(t=>n.includes(t))?catalog.crops.find(c=>c.name.toLowerCase().includes(name)):null).find(Boolean);
  const cropHit=catalog.crops.find(c=>n.includes(c.name.toLowerCase())) || cropAliasHit;
  if(/\bbeans?\b|ibishyimbo/.test(n)&&!catalog.crops.some(c=>n.includes(c.name.toLowerCase()))){const beanOptions=catalog.crops.filter(c=>/bean/i.test(c.name));if(beanOptions.length>1)return {clarification:{question:'Which bean category do you mean? The survey records several types.',options:beanOptions.slice(0,6).map(c=>({label:c.name,request:{metric:/loss/.test(n)?'lossRate':'production',crop:c.code,districts:'all',years:['2025'],seasons:'all',breakdown:'none',format:'table'}}))}};}
  const exactDistricts=catalog.districts.filter(d=>n.includes(d.name.toLowerCase())||n.includes(d.code.toLowerCase()));
  const words=n.split(/[^a-z0-9]+/).filter(Boolean);
  // Require 4+ letters and tight distance so short greetings like "hey" never match "huye".
  const fuzzyDistrict=exactDistricts.length?null:catalog.districts.find(d=>words.some(word=>{
    if(word.length<4)return false;
    const maxDist=word.length>=6?2:1;
    return Math.abs(word.length-d.code.length)<=maxDist&&editDistance(word,d.code)<=maxDist;
  }));
  const districtHit=exactDistricts[0]||fuzzyDistrict;
  const districtHits=exactDistricts.length?exactDistricts:(fuzzyDistrict?[fuzzyDistrict]:[]);
  let years=[...n.matchAll(/20(?:2[0-5])/g)].map(m=>m[0]);
  const range=n.match(/(20(?:2[0-5]))\s*(?:to|through|until|[-\u2013])\s*(20(?:2[0-5]))/);
  if(range){const start=Number(range[1]),end=Number(range[2]);if(end>=start&&end-start<=5)years=Array.from({length:end-start+1},(_,i)=>String(start+i));}
  const season=(n.match(/season\s*([abc])/i)||[])[1]?.toUpperCase();
  if(/last year/.test(n))years=['2025'];
  const since=n.match(/since\s+(20(?:2[0-5]))/);if(since)years=YEARS.filter(y=>y>=Number(since[1])).map(String);
  const metricMatchers=[
    [/loss\s+by\s+stage|stage\s+loss/,'lossByStage'],
    [/\bloss\b/,'lossRate'],
    [/\byield\b/,'yield'],
    [/\barea\b|\bhectare/,'area'],
    [/\bproduction\b|\bproduce[sd]?\b|\btonnes?\b|\btons?\b|\bharvest(ed)?\b/,'production']
  ];
  const metricHits=metricMatchers.map(([re,id])=>{const m=n.match(re);return m?{id,index:m.index}:null}).filter(Boolean).sort((a,b)=>a.index-b.index);
  let uniqueMetrics=[...new Set(metricHits.map(item=>item.id))];
  if(!uniqueMetrics.length&&/\b(chart|graph|plot|show|give)\b/.test(n))uniqueMetrics=['production'];
  if(!uniqueMetrics.length)uniqueMetrics=['production'];
  let metric=uniqueMetrics[0];
  const breakdown=/by district|districts/.test(n)?'district':/by season/.test(n)?'season':/by stage/.test(n)||metric==='lossByStage'?'stage':/trend|over time|by year/.test(n)?'year':'none';
  if (!cropHit&&!districtHit&&!years.length&&!season&&breakdown==='none'&&!/production|loss|yield|area|crop|survey|harvest|chart|graph|tonnes?|tons?/.test(n)) return {refusal:true};
  if ((!cropHit && !districtHit && !years.length && !/production|loss|yield|area|crop|chart|graph|tonnes?|tons?/.test(n)) || (!cropHit&&!districtHit&&!years.length&&!season&&breakdown==='none'&&uniqueMetrics.length===1&&metric==='production'&&!/production|harvest|tonnes?|tons?|chart|graph|show|give|how much/.test(n))) return { clarification:{ question:'Which crop, district, or measure should I look up?', options:catalog.crops.slice(0,3).map(c=>({label:c.name,request:{metric:'production',crop:c.code,districts:'all',years:['2025'],seasons:'all'}})) } };
  const compareIntent=/\b(vs\.?|versus|compared with)\b/.test(n);
  const compareDistrict=compareIntent&&districtHits.length>1;
  const compareCrop=compareIntent&&cropHits.length>1;
  const base={crop:compareCrop?cropHits[0].code:cropHit?.code||'all',districts:compareDistrict?[districtHits[0].code]:districtHit?[districtHit.code]:'all',years:years.length?[...new Set(years)]:['2025'],seasons:season?[season]:'all',format:'table',...(compareDistrict?{compare:{type:'district',value:districtHits[1].code}}:compareCrop?{compare:{type:'crop',value:cropHits[1].code}}:{})};
  const request={metric,breakdown:metric==='lossByStage'?'stage':breakdown,...base};
  const related=uniqueMetrics.slice(1).map(id=>({label:METRICS[id].label,request:{metric:id,breakdown:id==='lossByStage'?'stage':breakdown,...base}}));
  return { request, ...(related.length?{related}:{}) , confidence:cropHit||districtHit||years.length?0.9:0.7,...(kinyarwandaHit||/\bakarere ka\b/.test(n)?{reviewNote:'A Kinyarwanda crop or place term matched a draft alias; needs review by a Rwandan teammate.'}:{}) };
}

function permalinkHash(request) { return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0,16); }
module.exports={ YEARS,SEASONS,METRICS,MIN_RECORDS,CALC_VERSION,validateRequest,makeCatalog,evaluate,evaluateStageRequest,parseQuestion,permalinkHash };
