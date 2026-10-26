const test=require('node:test');const assert=require('node:assert/strict');const parser=require('../src/assistant/parser');
const catalog={crops:[{code:'101',name:'Maize'}],districts:[{code:'ngoma',name:'Ngoma'}]};
const env={LLM_API_KEY:'test-key',LLM_BASE_URL:'https://mock.invalid/v1',LLM_MODEL:'test-model',LLM_DAILY_BUDGET:'1'};
function mockFetch(args){return async(_url,options)=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{arguments:JSON.stringify(args)}}]}}]})});}
test('optional translator accepts only catalog-valid structured requests',async()=>{
 parser._resetBudgetForTests();const result=await parser.parse('show output for maize in ngoma during 2025',catalog,{env,fetchImpl:mockFetch({metric:'production',crop:'101',districts:['ngoma'],years:['2025'],seasons:'all',breakdown:'none',format:'table'})});
 assert.equal(result.parserUsed,'llm');assert.equal(result.parsed.request.crop,'101');
});
test('invalid or malicious structured output falls back without exposing model text',async()=>{
 parser._resetBudgetForTests();const result=await parser.parse('production in Ngoma 2025',catalog,{env,fetchImpl:mockFetch({metric:'production',crop:'<script>',districts:['ngoma'],years:['2025'],seasons:'all',breakdown:'none',format:'table',message:'unsafe'})});
 assert.equal(result.parserUsed,'deterministic');assert.equal(result.parsed.request.crop,'all');assert.equal(JSON.stringify(result).includes('<script>'),false);
});
test('daily model budget exhaustion silently uses the deterministic parser',async()=>{
 parser._resetBudgetForTests();let calls=0;const fetchImpl=async(...args)=>{calls++;return mockFetch({metric:'production',crop:'101',districts:['ngoma'],years:['2025'],seasons:'all',breakdown:'none',format:'table'})(...args);};
 const first=await parser.parse('maize production Ngoma 2025',catalog,{env,fetchImpl});const second=await parser.parse('maize yield Ngoma 2025',catalog,{env,fetchImpl});
 assert.equal(first.parserUsed,'llm');assert.equal(second.parserUsed,'deterministic');assert.equal(calls,1);
});
test('provider failure silently falls back to deterministic parsing',async()=>{
 parser._resetBudgetForTests();const result=await parser.parse('production in Ngoma 2025',catalog,{env,fetchImpl:async()=>{throw Error('provider down');}});assert.equal(result.parserUsed,'deterministic');
});
