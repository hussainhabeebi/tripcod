// Fully local workerd/R2 integration. No production bindings, credentials or network supplier.
// Local workerd does NOT enforce hosted CPU/memory quotas. Pair with the capped Node probe.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
async function main() {
 const wranglerRequire = createRequire(require.resolve('wrangler/package.json', {paths:[path.resolve(__dirname,'../')]}));
 const {Miniflare,convertV4MiniflareOptions} = wranglerRequire('miniflare');
 const {build} = wranglerRequire('esbuild');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tripcod-worker-city-'));
 let mf;
 try {
  const entry=path.join(dir,'worker.ts');
  await fs.writeFile(entry, `import {syncCityIndex,readCityMatches} from ${JSON.stringify(path.resolve(__dirname,'../src/lib/hotel-city-sync.ts'))};
export default {async fetch(request,env) {
 const mode=new URL(request.url).pathname;
 if(mode==='/lookup')return Response.json(await readCityMatches(env,['SYNTHETIC CITY 1']));
 const result=await syncCityIndex(env,{cityRegionIds:async(limit,cursor)=>{
  if(cursor!=='synthetic-next-129')throw new Error('Supplier cursor must resume at129');
  return {hotelCityRegionIds:[{cityName:'DUBAI',cityRegionId:999999,countryName:'UNITED ARAB EMIRATES'}],hasMore:false};
 }});return Response.json(result);
}};`);
  const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser'});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-11-01',r2Buckets:['DOCUMENTS_R2'],r2Persist:path.join(dir,'r2')}));
  const r2=await mf.getR2Bucket('DOCUMENTS_R2');
  const scenarios=[];
  for(const cityCount of [2000,256000]) {
   // Local test-only cleanup; never uses deployed bindings.
   let listing=await r2.list();for(const obj of listing.objects)await r2.delete(obj.key);
   let city=0,id=1;
   const encoder=new TextEncoder();
   const stream=new ReadableStream({pull(c){
    if(city===0)c.enqueue(encoder.encode('{"cities":{'));
    if(city===cityCount){c.enqueue(encoder.encode('},"pages":128,"count":256000,"cursor":"synthetic-next-129"}'));c.close();return;}
    let text='';for(let end=Math.min(city+200,cityCount);city<end;city++) {
     const rows=Array.from({length:256000/cityCount},()=>[id++,'UNITED ARAB EMIRATES']);
     text+=(city?',':'')+JSON.stringify('SYNTHETIC CITY '+city)+':'+JSON.stringify(rows);
    }c.enqueue(encoder.encode(text));
   }});
   const key='hotel-static/city-regions.partial.json';// Buffer only in the Node fixture seeder, outside the Worker under test.
   await r2.put(key,await new Response(stream).arrayBuffer());
   const before=await r2.head(key);const steps=[];
   for(let i=0;i<18;i++) {
    const concurrent=i===8?Array.from({length:4},async()=>{const response=await mf.dispatchFetch('http://local/lookup');assert.equal(response.status,200);assert.ok((await response.json()).length>0);}):[];
    const started=Date.now();const response=await mf.dispatchFetch('http://local/sync');assert.equal(response.status,200);
    await Promise.all(concurrent);
    const result=await response.json();steps.push({step:i,wallMs:Date.now()-started,...result});
    assert.equal(result.pages,i<17?128:129);assert.equal(result.done,i===17);
    if(i===0||i===16||i===17) {
     const lookup=await mf.dispatchFetch('http://local/lookup');assert.equal(lookup.status,200);
     const rows=await lookup.json();assert.ok(rows.length>0);
    }
   }
   const after=await r2.head(key);assert.equal(after.etag,before.etag);
   scenarios.push({cityCount,legacyBytes:before.size,originalEtagPreserved:after.etag===before.etag,concurrentLookupsDuringMigration:4,steps});
  }
  console.log(JSON.stringify({runtime:'Miniflare local workerd',quotaEnforcement:false,warning:'Hosted Worker limits and concurrent production load are not enforced by local workerd.',scenarios},null,2));
 } finally {if(mf)await mf.dispose();await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
