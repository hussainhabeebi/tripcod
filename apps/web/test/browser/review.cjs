// Browser verification against test-only fixtures. Requires Playwright + a Chromium executable.
const {spawn}=require('node:child_process');
const path=require('node:path');const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const {createMockApi}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'../../../..');const out=path.join(root,'docs/qa-tripcod');
const interactions=require('./interactions.cjs');
const widths=process.env.QA_WIDTHS ? process.env.QA_WIDTHS.split(",").map(Number) : [320,375,390,428,768,1024,1440];
const search='/search?origin=COK&destination=DXB&departureDate=2027-01-10&adults=1&cabinClass=ECONOMY&tripType=ONEWAY&currency=INR';
const book='/book?fareId=qa-fare-1&supplier=TRIPJACK&from=COK&to=DXB&dep=2027-01-10T10%3A00%3A00%2B05%3A30&arr=2027-01-10T12%3A30%3A00%2B04%3A00&dur=240&price=10000&cur=INR&adults=1&airline=QA%20Airways&fn=QA101&ref=1&bag=25%20kg&cab=7%20kg';
const routes={home:'/',results:search,passengers:book,checkout:'/checkout/qa-fixture-token',trips:'/trips',journey:'/search/journey?origin=COK&destination=DXB&departureDate=2027-01-10&returnDate=2027-01-20&adults=1&tripType=ROUNDTRIP'};
(async()=>{let browser,server;const mock=createMockApi();const report={browser:null,fixture:true,viewports:[],errors:[],interactions:[]};
try{server=spawn(process.execPath,['node_modules/next/dist/bin/next',process.env.QA_DEV ? 'dev' : 'start','-H','127.0.0.1','-p','4789'],{cwd:path.join(root,'apps/web'),env:{...process.env,NEXT_PUBLIC_API_URL:'http://127.0.0.1:4788'},stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4789');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(log);}

browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/tmp/tripcod-chrome/chromium',headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});report.browser=browser.version();
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addCookies([{name:'tripcod_token',value:'qa-only-not-a-real-token',domain:'127.0.0.1',path:'/'}]);
await context.route('**/*',async route=>{const host=new URL(route.request().url()).hostname;if(['127.0.0.1','localhost'].includes(host))return route.continue();return route.abort();});
const page=await context.newPage();page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(10000);page.on('pageerror',e=>report.errors.push({url:page.url(),message:e.message}));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',page.url(),m.text().slice(0,1500));});
for(const width of widths){await page.setViewportSize({width,height:900});for(const [screen,url]of Object.entries(routes).filter(([screen])=>!process.env.QA_SCREENS || process.env.QA_SCREENS.split(",").includes(screen))){await page.goto('http://127.0.0.1:4789'+url,{waitUntil:'networkidle'});await page.locator('main').first().waitFor();
const row=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,headings:[...document.querySelectorAll('h1')].map(x=>x.textContent),overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left < -1 || r.right > innerWidth+1)&&getComputedStyle(e).position!=='absolute';}).slice(0,10).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,60)})),smallTargets:[...document.querySelectorAll('main button,main input,main select')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24);}).map(e=>({text:e.getAttribute('aria-label')||e.textContent.slice(0,30),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));report.viewports.push({width,screen,...row});console.log(width,screen,row.documentWidth>width?'OVERFLOW':'ok',row.overflow.length+' extended elements');
if([390,1440].includes(width)&&['home','results','passengers','checkout','trips'].includes(screen))await page.screenshot({path:path.join(out,'screenshots',`${screen}-${width}.jpg`),type:'jpeg',quality:82,fullPage:true});
try{await interactions(page,screen,width);report.interactions.push({width,screen,result:'PASS'});}catch(e){report.interactions.push({width,screen,result:'FAIL',message:e.message});console.log('FAIL STATE',await page.locator('.result-refresh').allTextContents(),await page.locator('.stops-btn').allTextContents());console.log('INTERACTION FAILURE',width,screen,page.url(),e.message.slice(0,350));}
}}
report.bookingOrPaymentSubmissions=mock.requests.filter(r=>r.path==='/api/book'||r.path==='/api/payments/checkout').length;
if(report.errors.length || report.interactions.some(r=>r.result==='FAIL') || report.viewports.some(r=>r.documentWidth>r.width) || report.bookingOrPaymentSubmissions)process.exitCode=1;
fs.writeFileSync(path.join(out,process.env.QA_REPORT_NAME || 'responsive.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(out,process.env.QA_REPORT_NAME || 'responsive.json'));
}finally{await browser?.close();server?.kill();mock.server.close();}})().catch(e=>{console.error(e);process.exitCode=1});
