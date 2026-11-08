// Local-only QA: supplier traffic is intercepted; never runs a booking.
const assert=require('node:assert/strict');
const chromiumModule=require(process.env.CHROMIUM_MODULE || '@sparticuz/chromium');
const chromium=chromiumModule.default ?? chromiumModule;
const puppeteer=require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || await chromium.executablePath(),args:chromium.args,headless:true});
 const page=await browser.newPage();let searches=0;
 const leg=(id,tripKey,stops=0)=>({id,supplier:'TRIPJACK',tripKey,airline:'AA',airlineName:'Air A',flightNumber:id,origin:tripKey==='RETURN'?'BOM':'DEL',destination:tripKey==='RETURN'?'DEL':'BOM',departureTime:'2030-01-01T08:00:00',arrivalTime:'2030-01-01T10:00:00',duration:120,stops,totalFare:1000,currency:'INR',isRefundable:true,baggage:{checked:'15 KG'}});
 let fares=[leg('OUT0','ONWARD'),leg('OUT1','ONWARD',1),leg('RET0','RETURN'),leg('RET1','RETURN',1)];
 await page.setRequestInterception(true);
 page.on('request',r=>{if(r.url().startsWith('http://127.0.0.1'))return r.continue();if(r.url().includes('/api/search')&&r.method()==='POST'){searches++;return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({fares,searchId:'synthetic'})});}return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body:'{}'});});
 const url='http://127.0.0.1:3105/search/journey?tripType=ROUNDTRIP&origin=DEL&destination=BOM&departureDate=2030-01-01&returnDate=2030-01-10';
 const report=[];
 for(const width of [320,375,390,428,768,1024,1440]){
  await page.setViewport({width,height:900});await page.goto(url);await page.waitForSelector('#leg-ONWARD');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`overflow ${width}`);
  if(width<=900){await page.click('.mobile-filter-toggle');await page.waitForSelector('.filter-sidebar.open');}
  await page.evaluate(()=>[...document.querySelectorAll('.stops-btn')].find(b=>b.textContent==='Nonstop').click());
  if(width<=900)await page.click('.filter-apply');
  await page.waitForFunction(()=>location.search.includes('stops=0'));
  await page.waitForFunction(()=>!document.body.innerText.includes('OUT1'));
  assert.equal(await page.evaluate(()=>document.body.innerText.includes('RET1')),false);
  await page.evaluate(()=>document.querySelector('#leg-ONWARD button').click());
  await page.evaluate(()=>document.querySelector('#leg-RETURN button').click());
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Continue')));
  if(width===390||width===1440)await page.screenshot({path:`/tmp/journey-filters-${width}.png`,fullPage:true});
  report.push({width,overflow:false,filters:'passed',selection:'passed'});
 }
 const seg=(origin,destination,hour)=>({origin,destination,departureTime:`2030-01-01T${hour}:00:00`,arrivalTime:`2030-01-01T${Number(hour)+2}:00:00`,duration:120,airlineName:'Air A',airline:'AA',flightNumber:'10'});
 fares=[{...leg('COMBO0','COMBO'),segments:[seg('BOM','DXB','08'),seg('DXB','SIN','14')],origin:'BOM',destination:'DXB'},{...leg('COMBO1','COMBO',1),segments:[seg('BOM','AUH','08'),seg('AUH','DXB','11'),seg('DXB','SIN','14')],origin:'BOM',destination:'DXB'}];
 await page.setViewport({width:1440,height:900});const before=searches;
 await page.goto('http://127.0.0.1:3105/search/journey?tripType=MULTICITY&legs=BOM-DXB-2030-01-01,DXB-SIN-2030-01-03&origin=BOM&destination=SIN&departureDate=2030-01-01');await page.waitForFunction(()=>document.body.innerText.includes('COMBO1'));
 await page.evaluate(()=>[...document.querySelectorAll('.stops-btn')].find(b=>b.textContent==='Nonstop').click());await page.waitForFunction(()=>!document.body.innerText.includes('COMBO1'));
 assert.equal(searches-before,1,'filter changes must not refetch supplier');
 await browser.close();console.log(JSON.stringify({responsive:report,multicity:'passed',supplierCallsOnFilter:0},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
