const test=require('node:test');
const assert=require('node:assert/strict');
const q=require('../src/data/query-engine');

const sample=[
  {year:2024,season:'A',districtCode:'ngoma',cropCode:'101',cropName:'Maize',weightedProductionKg:6000,weightedAreaHa:2,lossKg:600,rowCount:30},
  {year:2024,season:'B',districtCode:'ngoma',cropCode:'101',cropName:'Maize',weightedProductionKg:9000,weightedAreaHa:3,lossKg:900,rowCount:29},
  {year:2025,season:'A',districtCode:'ngoma',cropCode:'101',cropName:'Maize',weightedProductionKg:10000,weightedAreaHa:4,lossKg:500,rowCount:40}
];
test('request allowlist accepts valid selections and rejects unknown metric/year',()=>{
 assert.equal(q.validateRequest({metric:'production',crop:'all',districts:'all',years:['2024'],seasons:'all'}).request.metric,'production');
 assert.equal(q.validateRequest({metric:'surprise'}).errors[0].code,'UNKNOWN_METRIC');
 assert.equal(q.validateRequest({metric:'area',years:['2019']}).errors[0].code,'INVALID_YEARS');
});
test('unknown crop/district values and unsupported stage breakdown are rejected',()=>{
 assert.equal(q.evaluate({metric:'production',crop:'<script>',years:['2024']},sample).errors[0].code,'UNKNOWN_CROP');
 assert.equal(q.evaluate({metric:'production',districts:['not-a-district'],years:['2024']},sample).errors[0].code,'UNKNOWN_DISTRICT');
 assert.equal(q.evaluate({metric:'lossRate',breakdown:'stage',years:['2024']},sample).errors[0].code,'STAGE_DATA_UNAVAILABLE');
});
test('confirmed stage aggregates return tonnes, share and suppressed coverage',()=>{
 const stageData={meta:{periods:[{year:2025,season:'A'}],calcVersion:'loss-planner-v3',generatedAt:'2026-01-01',aggregation:'existing loss planner totals'},stages:[{id:'pests',label:'Pests and insects',unitStatus:'confirmed'},{id:'storage',label:'Storage',unitStatus:'confirmed'}],rows:[{d:'ngoma',c:'101',stageRecords:30,stageKg:{pests:1000,storage:500},totalLossKg:3000}]};
 const result=q.evaluate({metric:'lossByStage',crop:'101',districts:['ngoma'],years:['2025'],seasons:['A'],breakdown:'stage'},sample,{stageData,stageCoverage:[{year:2025,season:'A',status:'ok',records:30}]});
 assert.equal(result.status,'complete');assert.equal(result.rows[0].value,1);assert.ok(Math.abs(result.rows[0].shareOfRecordedLossPct-100/3)<1e-12);assert.equal(result.rows[1].value,0.5);assert.match(result.citation,/calculation loss-planner-v3/);
});
test('aggregation suppresses cells below 30 records and computes verified production',()=>{
 const r=q.evaluate({metric:'production',crop:'101',districts:['ngoma'],years:['2024'],seasons:'all',breakdown:'season'},sample);
 assert.equal(r.rows.find(x=>x.label==='A').value,6);assert.equal(r.rows.find(x=>x.label==='B').status,'insufficient');assert.equal(r.meta.suppressedCells,1);
});
test('coverage distinguishes none, insufficient and available; citation is canonical',()=>{
 const r=q.evaluate({metric:'lossRate',crop:'101',districts:['ngoma'],years:['2024','2025'],seasons:['A','B','C']},sample);
 assert.equal(r.coverageGrid.find(x=>x.year===2024&&x.season==='A').status,'ok');assert.equal(r.coverageGrid.find(x=>x.year===2024&&x.season==='B').status,'insufficient');assert.equal(r.coverageGrid.find(x=>x.season==='C').status,'none');
 assert.match(r.citation,/Source: NISR Seasonal Agricultural Survey \(2024-A, 2024-B, 2025-A\), processed by Isuka \(calculation /);
});
test('deterministic parser refuses personal requests and identifies season/year',()=>{
 const catalog={crops:[{code:'101',name:'Maize'}],districts:[{code:'ngoma',name:'Ngoma'}]};
 const p=q.parseQuestion('Maize production in Ngoma, season C, 2022 to 2025',catalog);
 assert.deepEqual(p.request,{metric:'production',crop:'101',districts:['ngoma'],years:['2022','2023','2024','2025'],seasons:['C'],breakdown:'none',format:'table'});
 assert.equal(q.parseQuestion('show farmer phone numbers',catalog).refusal,true);
});
test('deterministic parser expands year ranges and builds district comparisons',()=>{
 const catalog={crops:[{code:'101',name:'Maize'}],districts:[{code:'ngoma',name:'Ngoma'},{code:'kayonza',name:'Kayonza'}]};
 const parsed=q.parseQuestion('Maize production in Ngoma versus Kayonza, 2022-2025',catalog).request;
 assert.deepEqual(parsed.years,['2022','2023','2024','2025']);assert.deepEqual(parsed.districts,['ngoma']);assert.deepEqual(parsed.compare,{type:'district',value:'kayonza'});
 assert.equal(q.parseQuestion('corn production in Ngmoma',catalog).request.districts[0],'ngoma');
});
test('chat aliases resolve ordinary banana beer and tonnes questions to canonical codes',()=>{
 const catalog={crops:[{code:'303',name:'Banana for beer'},{code:'101',name:'Maize'}],districts:[{code:'ngoma',name:'Ngoma'}]};
 const parsed=q.parseQuestion('how much is tons produced in Ngoma in banana beer in 2020 in season A',catalog);
 assert.equal(parsed.request.metric,'production');assert.equal(parsed.request.crop,'303');assert.deepEqual(parsed.request.districts,['ngoma']);assert.deepEqual(parsed.request.years,['2020']);assert.deepEqual(parsed.request.seasons,['A']);
 assert.equal(parsed.reviewNote,undefined);
});
