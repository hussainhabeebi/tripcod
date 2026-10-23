const {spawn}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');
const {createMockApi}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'../../../..');
(async()=>{const mock=createMockApi();let server,browser;try{
server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','4789'],{cwd:path.join(root,'apps/web'),env:{...process.env,NEXT_PUBLIC_API_URL:'http://127.0.0.1:4788'},stdio:'ignore'});
for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4789')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
browser=await chromium.launch({executablePath:'/tmp/tripcod-chrome/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-port=9223']});
const {default:lighthouse}=await import('/tmp/tripcod-browser/node_modules/lighthouse/core/index.js');
const pages={home:'/',results:'/search?origin=COK&destination=DXB&departureDate=2027-01-10&adults=1&cabinClass=ECONOMY&tripType=ONEWAY&currency=INR',checkout:'/checkout/qa-fixture-token'};
const summary={measured:true,productionBuild:true,browser:browser.version(),mockSupplier:true,externalFontsBlocked:true,device:'Lighthouse mobile default emulation/throttling',runs:{}};
for(const [screen,url]of Object.entries(pages)){
const result=await lighthouse('http://127.0.0.1:4789'+url,{port:9223,onlyCategories:['performance','accessibility','best-practices'],output:'json',logLevel:'error',blockedUrlPatterns:['*fonts.googleapis.com*','*fonts.gstatic.com*']});const lhr=result.lhr;fs.writeFileSync('/tmp/tripcod-lighthouse-'+screen+'.json',JSON.stringify(lhr,null,2));
summary.runs[screen]={version:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,scores:Object.fromEntries(Object.entries(lhr.categories).map(([k,v])=>[k,Math.round(v.score*100)])),warnings:lhr.runWarnings,failedAudits:Object.fromEntries(Object.entries(lhr.audits).filter(([k,v])=>v.score!==null&&v.score<1).map(([k,v])=>[k,{title:v.title,score:v.score,displayValue:v.displayValue,details:v.details}]))};
fs.writeFileSync(path.join(root,'docs/qa-tripcod/lighthouse.json'),JSON.stringify(summary,null,2));console.log(screen,summary.runs[screen].scores);
}
}finally{await browser?.close();server?.kill();mock.server.close();}})().catch(e=>{console.error(e);process.exitCode=1});
