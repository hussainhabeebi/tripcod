const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3003',out=process.env.QA_OUTPUT||'/tmp/tripcod-admin-hotels-qa';
const hotel=(status)=>({id:`hotel-${status}`,tenantId:'t1',userId:'customer-1',supplierBookingId:`TJH-${status}`,status,mode:'HOLD',holdDeadline:'2026-11-04T18:00',hotel:{name:'Dubai Marina Test Hotel',checkIn:'2026-11-10',checkOut:'2026-11-12'},contactEmail:'guest@example.test',amount:12000,currency:'INR',createdAt:'2026-10-31T00:00:00Z',payment:{status:'UNPAID',gateway:null},cancellation:{charge:0},occupancy:[{adults:2,childAges:[]}],guests:[]});
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/tripcod-chrome/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const ctx=await browser.newContext();await ctx.addCookies([{name:'tripcod_admin_token',value:'synthetic-admin',url:base}]);const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{assert.equal(route.request().method(),'GET');const p=new URL(route.request().url()).pathname;let data={};
 if(p==='/api/admin/me')data={user:{name:'Test Admin',email:'admin@example.test'},role:'SUPER_ADMIN',roleLabel:'Admin',fullAccess:true,sections:['bookings','logs'],canManageUsers:true};
 else if(p==='/api/admin/bookings')data={bookings:[{id:'flight-1',origin:'DEL',destination:'DXB',supplier:'TRIPJACK',pnr:'ABC123',status:'TICKETED',totalAmount:'9000',currency:'INR',channel:'WEB',departureDate:'2026-11-10',createdAt:'2026-10-30T00:00:00Z'}]};
 else if(p==='/api/admin/bookings/hotels')data={bookings:['ON_HOLD','CONFIRMED','CANCELLED'].map(hotel)};
 else if(p.includes('/hotel-certification')){if(p.endsWith('/zip'))return route.fulfill({contentType:'application/zip',body:'synthetic-zip'});data={packs:[]};}
 else if(p.endsWith('/certification.zip'))return route.fulfill({contentType:'application/zip',body:'synthetic-zip'});
 else if(p.endsWith('/exchanges'))data={exchanges:[{id:0,endpoint:'/oms/v3/hotel/book',startedAt:'2026-10-31T00:00:00Z',hasResponse:true}]};
 else if(/\/exchanges\/0\//.test(p))data=p.endsWith('/request')?{body:{bookingId:'TJH-ON_HOLD'}}:{status:{success:true}};
 else if(p==='/api/admin/bookings/hotels/hotel-ON_HOLD')data={booking:hotel('ON_HOLD')};
 else if(p==='/api/admin/supplier-logs')data={logs:[]};
 else if(p.endsWith('/exchanges'))data={exchanges:[]};
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 for(const width of [320,375,390,428,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.goto(`${base}/bookings`);await page.getByText('ABC123',{exact:true}).waitFor();
  assert.equal(await page.locator('tbody tr').count(),4);
  await page.getByRole('button',{name:'Hotels',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),3);assert.equal(await page.getByText('ABC123',{exact:true}).count(),0);
  for(const s of ['ON_HOLD','CONFIRMED','CANCELLED'])assert.equal(await page.locator('tbody').getByText(s,{exact:true}).count(),1);
  await page.getByRole('button',{name:'Flights',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),1);
  await page.getByRole('button',{name:'All',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`list overflow ${width}`);
  if([390,1440].includes(width))await page.screenshot({path:`${out}/bookings-${width}.png`,fullPage:true});
  await page.goto(`${base}/bookings/hotels/hotel-ON_HOLD`);await page.getByText('TJH-ON_HOLD',{exact:true}).waitFor();await page.getByRole('button',{name:'View Request JSON'}).waitFor();
  await page.getByRole('button',{name:'View Request JSON'}).click();await page.getByRole('region',{name:'Request/Response JSON'}).getByText(/TJH-ON_HOLD/).waitFor();
  await page.getByRole('button',{name:'Close JSON'}).click();await page.getByRole('button',{name:'View Response JSON'}).click();await page.getByRole('region',{name:'Request/Response JSON'}).getByText(/success/).waitFor();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download Certification ZIP'}).click();assert.match((await downloaded).suggestedFilename(),/tripjack-hotel-TJH-ON_HOLD.zip/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`detail overflow ${width}`);
  if([390,1440].includes(width))await page.screenshot({path:`${out}/details-${width}.png`,fullPage:true});
 }
 await page.goto(`${base}/supplier-logs`);assert.equal(await page.getByRole('heading',{name:'Hotel UAT certification logs (TripJack Hotel API v3)'}).count(),0);await page.getByRole('link',{name:'Hotel certification logs are now in Bookings →'}).waitFor();
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: combined bookings, All/Flights/Hotels, details, JSON view, ZIP download, seven widths, no document overflow, no mutations; certification UI moved.');
})().catch(e=>{console.error(e);process.exit(1)});
