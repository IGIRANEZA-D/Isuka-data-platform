const apiBase=process.env.ISUKA_API_URL||'http://localhost:3000';
async function json(path){const r=await fetch(`${apiBase}${path}`);if(!r.ok)throw Error(`${path} returned ${r.status}`);return r.json();}
async function query(request){const r=await fetch(`${apiBase}/api/data/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});const body=await r.json();if(!r.ok)throw Error(`assistant query failed: ${body.error}`);const row=body.rows.find(x=>x.status==='ok');if(!row)throw Error(`assistant query had no publishable value: ${JSON.stringify(request)}`);return row.value;}
function close(actual,expected,label){if(!Number.isFinite(actual)||!Number.isFinite(expected)||Math.abs(actual-expected)>Math.max(1e-7,Math.abs(expected)*1e-9))throw Error(`${label}: ${actual} != ${expected}`);}
async function main(){
 const national=await json('/api/overview?year=2025&season=all&district=all');
 close(await query({metric:'production',years:['2025'],seasons:'all'}),national.kpis.weightedProductionKg/1000,'2025 national production tonnes');
 close(await query({metric:'area',years:['2025'],seasons:'all'}),national.kpis.arableLandHa,'2025 national area');
 close(await query({metric:'lossRate',years:['2025'],seasons:'all'}),national.kpis.postHarvestLossPercent,'2025 national recorded loss');
 close(await query({metric:'yield',years:['2025'],seasons:'all'}),national.kpis.weightedProductionKg/national.kpis.arableLandHa/1000,'2025 national yield');
 const ngoma=await json('/api/overview?year=2025&season=all&district=ngoma');
 close(await query({metric:'production',districts:['ngoma'],years:['2025'],seasons:'all'}),ngoma.kpis.weightedProductionKg/1000,'2025 Ngoma production tonnes');
 const maize=national.productionByCrop.find(row=>row.cropCode==='101');
 close(await query({metric:'production',crop:'101',years:['2025'],seasons:'all'}),maize.productionKg/1000,'2025 maize production tonnes');
 const seasonA=await json('/api/overview?year=2025&season=A&district=all');
 close(await query({metric:'production',years:['2025'],seasons:['A']}),seasonA.kpis.weightedProductionKg/1000,'2025-A national production tonnes');
 process.stdout.write('PASS seven Ask Isuka results reconcile with existing Overview aggregates\n');
}
main().catch(error=>{console.error(`FAIL Ask Isuka consistency: ${error.message}`);process.exitCode=1;});
