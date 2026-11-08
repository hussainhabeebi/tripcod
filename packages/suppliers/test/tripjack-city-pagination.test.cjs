const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
 const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const module = {exports:{}};
 new Function('require','module','exports',source)(id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id.replace(/\.js$/,'.ts'))):require(id),module,module.exports);
 return module.exports;
}
const {TripjackHotelV3Client}=load(path.resolve(__dirname,'../src/tripjack/hotel-v3.ts'));
test('city sync preserves opaque cursor, GET authentication and supplier diagnostics',async t=>{
 const real=global.fetch;t.after(()=>{global.fetch=real});
 const client=new TripjackHotelV3Client({baseUrl:'https://gateway.invalid',apiKey:'synthetic',proxyKey:'synthetic-internal'});
 global.fetch=async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.headers.apikey,'synthetic');assert.equal(opts.headers['X-Tripcod-Gateway-Key'],'synthetic-internal');
  assert.equal(new URL(url).searchParams.get('cursor'),'opaque+/=value');
  assert.equal(new URL(url).searchParams.get('limit'),'2000');
  return Response.json({errors:[{errCode:'synthetic-403',message:'Not authorised'}]},{status:403,headers:{'x-request-id':'synthetic-gateway-id','x-tripjack-upstream-status':'403'}});
 };
 await assert.rejects(client.cityRegionIds(2000,'opaque+/=value'),e=>{
  assert.equal(e.statusCode,403);assert.equal(e.code,'synthetic-403');assert.equal(e.gatewayRequestId,'synthetic-gateway-id');assert.equal(e.upstreamStatus,403);return true;
 });
});
test('a response body read failure keeps HTTP status and gateway request reference',async t=>{
 const real=global.fetch;t.after(()=>{global.fetch=real});
 global.fetch=async()=>({status:200,headers:new Headers({'x-request-id':'synthetic-read-id'}),text:async()=>{throw new Error('stream interrupted')}});
 await assert.rejects(new TripjackHotelV3Client({baseUrl:'https://gateway.invalid',apiKey:'synthetic'}).cityRegionIds(2000),e=>e.code==='RESPONSE_READ_FAILED'&&e.statusCode===200&&e.gatewayRequestId==='synthetic-read-id');
});
test('HTTP 200 with supplier errors is not a successful city page',async t=>{
 const real=global.fetch;t.after(()=>{global.fetch=real});
 global.fetch=async()=>Response.json({errors:[{errCode:'synthetic-auth',message:'Not authorised'}]},{headers:{'x-request-id':'synthetic-200-id'}});
 await assert.rejects(new TripjackHotelV3Client({baseUrl:'https://gateway.invalid',apiKey:'synthetic'}).cityRegionIds(2000),e=>e.code==='synthetic-auth'&&e.statusCode===200&&e.gatewayRequestId==='synthetic-200-id');
});
