// Local Node resource probe, not a Cloudflare runtime measurement. No network or production bindings.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const LEGACY = 'hotel-static/city-regions.partial.json';
async function main() {
 if(process.argv[2] !== '--measure') {
  const ts=require('typescript'); const {execFileSync}=require('node:child_process');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tripcod-city-resource-'));
  try {
   const modulePath=path.join(dir,'logic.mjs');
   const legacySource=await fs.readFile(path.resolve(__dirname,'../src/lib/hotel-city-legacy.ts'),'utf8');
   await fs.writeFile(path.join(dir,'hotel-city-legacy.js'),ts.transpileModule(legacySource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
   const source=await fs.readFile(path.resolve(__dirname,'../src/lib/hotel-city-sync.ts'),'utf8');
   await fs.writeFile(modulePath,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
   const results=[];
   for(const cityCount of [2000,256000]) {
    const work=path.join(dir,String(cityCount)); await fs.mkdir(work);
    const filename=path.join(work,Buffer.from(LEGACY).toString('base64url'));
    async function* json(){
     yield '{"pages":128,"count":256000,"cursor":"synthetic-next-129","cities":{';
     let id=1;
     for(let c=0;c<cityCount;c++) {
      const rows=Array.from({length:256000/cityCount},()=>[id++,'UNITED ARAB EMIRATES']);
      yield (c?',':'')+JSON.stringify('SYNTHETIC CITY '+c)+':'+JSON.stringify(rows);
     }
     yield '}}';
    }
    await fs.writeFile(filename,json());
    const output=execFileSync(process.execPath,['--max-old-space-size=64','--expose-gc',__filename,'--measure',work,modulePath],{encoding:'utf8'});
    results.push({cityCount,...JSON.parse(output)});
   }
   console.log(JSON.stringify({runtime:process.version,childHeapLimitMiB:64,warning:'Local Node only; heap samples and CPU are not Worker measurements or guarantees.',scenarios:results},null,2));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
  return;
 }
 const dir=process.argv[3], modulePath=process.argv[4];
 const {syncCityIndex,readCityMatches}=await import(pathToFileURL(modulePath).href);
 const file=key=>path.join(dir,Buffer.from(key).toString('base64url'));
 const seed=await fs.stat(file(LEGACY));
 const meta=new Map([[LEGACY,{etag:'seed',size:seed.size}]]);
 let revision=0,operations=0,peakHeap=0;
 const sample=()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);};
 const r2={
  head:async key=>{operations++;return meta.get(key)??null;},
  get:async key=>{
   operations++;const m=meta.get(key);if(!m)return null;
   return {...m,get body(){return require('node:stream').Readable.toWeb(require('node:fs').createReadStream(file(key)));},json:async()=>{const text=await fs.readFile(file(key),'utf8');const value=JSON.parse(text);sample();return value;}};
  },
  put:async(key,value,options={})=>{
   operations++;sample();const old=meta.get(key);
   if(options.onlyIf?.etagMatches && old?.etag!==options.onlyIf.etagMatches)return null;
   if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
   await fs.writeFile(file(key),value);
   const item={etag:String(++revision),size:(await fs.stat(file(key))).size,customMetadata:options.customMetadata};meta.set(key,item);sample();return item;
  },
 };
 const measurements=[];
 async function measure(phase,call){
  global.gc();peakHeap=process.memoryUsage().heapUsed;const startCpu=process.cpuUsage(),startTime=performance.now(),before=operations;
  const result=await call();sample();const cpu=process.cpuUsage(startCpu);
  measurements.push({phase,cpuMs:Math.round((cpu.user+cpu.system)/1000),wallMs:Math.round(performance.now()-startTime),peakSampledHeapMiB:Math.round(peakHeap/1048576),r2Operations:operations-before});
  return result;
 }
 let supplierCalls=0;
 const client={cityRegionIds:async()=>{supplierCalls++;return {hotelCityRegionIds:Array.from({length:2000},(_,i)=>({cityName:'NEW CITY '+i,cityRegionId:300000+i,countryName:'UNITED ARAB EMIRATES'})),hasMore:false};}};
 const env={DOCUMENTS_R2:r2};
 for(let i=0;i<17;i++)await measure(i===0?'legacy-initialization':'migration-'+(i-1),()=>syncCityIndex(env,client));
 const migratedSupplierCalls=supplierCalls;
 const complete=await measure('next-page-and-publication',()=>syncCityIndex(env,client));
 if (!complete.done) throw new Error('Probe did not complete the synthetic index');
 await measure('lookup',()=>readCityMatches(env,['SYNTHETIC CITY 1']));
 const shardSizes=[...meta.entries()].filter(([key])=>key.endsWith('.json')&&!key.includes('legacy')&&!key.includes('regions')).map(([,m])=>m.size);
 console.log(JSON.stringify({legacyBytes:seed.size,maxShardBytes:Math.max(...shardSizes),migratedSupplierCalls,totalMockSupplierCalls:supplierCalls,complete,measurements}));
}
main().catch(e=>{console.error(e);process.exit(1);});
