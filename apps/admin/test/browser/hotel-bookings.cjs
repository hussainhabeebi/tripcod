const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3003',out=process.env.QA_OUTPUT||'/tmp/tripcod-admin-hotels-qa';
const hotel=(status)=>({id:`hotel-${status}`,tenantId:'4c86636b-fb0a-4948-92ff-d62d602642b8',userId:'4404f481-de7c-4c04-a283-34554422d8d2',supplierBookingId:`TJH-${status}`,status,mode:'HOLD',holdDeadline:'2026-11-04T18:00',hotel:{name:'Dubai Marina Test Hotel',city:'Dubai',countryCode:'AE',address:'Marina Walk',stars:4,checkIn:'2026-11-10',checkOut:'2026-11-12',nights:2},contactEmail:'guest@example.test',contactPhone:'9876543210',dialCode:'+91',amount:12000,currency:'INR',createdAt:'2026-10-31T00:00:00Z',payment:{status:'UNPAID',gateway:null},cancellation:status==='CANCELLED'?{requestedAt:'2026-10-31T01:00:00Z',charge:0,refund:0,basis:'UNPAID_HOLD',previousStatus:'ON_HOLD'}:null,occupancy:[{adults:2,childAges:[6]}],guests:[[{title:'Mr',firstName:'Arun',lastName:'Guest',type:'ADULT',pan:'ABCDE1234F'},{title:'Ms',firstName:'Bina',lastName:'Guest',type:'ADULT'},{title:'Master',firstName:'Cian',lastName:'Guest',type:'CHILD'}]],option:{roomInfo:[{id:'r1',name:'Deluxe King'}],mealBasis:'Breakfast',inclusions:['Free WiFi'],pricing:{totalPrice:12000,basePrice:10500,taxes:1500,discount:0,mf:0,mft:0},cancellation:{isRefundable:true,deadlineDateTime:'2026-11-08T23:59',penalties:[{from:'2026-10-31T00:00',to:'2026-11-08T23:59',amount:0},{from:'2026-11-09T00:00',to:'2026-11-10T12:00',amount:6000}]}}});
const exchanges=[
 {id:0,step:'Search',label:'Search',name:'HotelSearch',endpoint:'/hms/v3/hotel/listing',startedAt:'2026-10-31T00:00:00Z',httpStatus:200,durationMs:812,ok:true,hasResponse:true,requestId:'hotel-req-1',gatewayRequestId:'gw-1',supplierStatus:null,supplierError:null,errorCode:null},
 {id:1,step:'HoldBook',label:'Hold',name:'HotelHoldBook',endpoint:'/oms/v3/hotel/book',startedAt:'2026-10-31T00:01:00Z',httpStatus:200,durationMs:2310,ok:true,hasResponse:true,requestId:'hotel-req-2',gatewayRequestId:null,supplierStatus:null,supplierError:null,errorCode:null},
 {id:2,step:'BookingDetails',label:'Booking Details',name:'HotelBookingDetail',endpoint:'/oms/v3/hotel/booking-details',startedAt:'2026-10-31T00:01:10Z',httpStatus:403,durationMs:95,ok:false,hasResponse:true,requestId:'hotel-req-3',gatewayRequestId:'gw-3',supplierStatus:null,supplierError:'Invalid API key',errorCode:'403'}];
const certification={scenario:'HOLD',covered:['Search','HoldBook','BookingDetails'],missing:['Review'],holdLifecycle:{outcome:'ON_HOLD'}};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/tripcod-chrome/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const ctx=await browser.newContext();await ctx.addCookies([{name:'tripcod_admin_token',value:'synthetic-admin',url:base}]);const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{assert.equal(route.request().method(),'GET');const url=new URL(route.request().url()),p=url.pathname;let data={};
 if(p==='/api/admin/bookings')assert.notEqual(url.searchParams.get('status'),'ON_HOLD','hotel-only status must not reach the flight enum');
 if(p==='/api/admin/me')data={user:{name:'Test Admin',email:'admin@example.test'},role:'SUPER_ADMIN',roleLabel:'Admin',fullAccess:true,sections:['bookings','logs'],canManageUsers:true};
 else if(p==='/api/admin/bookings')data={bookings:[{id:'flight-1',userId:'4404f481-de7c-4c04-a283-34554422d8d2',tenantId:'4c86636b-fb0a-4948-92ff-d62d602642b8',origin:'DEL',destination:'DXB',supplier:'TRIPJACK',pnr:'ABC123',status:'TICKETED',totalAmount:'9000',currency:'INR',channel:'WEB',departureDate:'2026-11-10',createdAt:'2026-10-30T00:00:00Z'}]};
 else if(p==='/api/admin/bookings/hotels')data={bookings:['ON_HOLD','CONFIRMED','CANCELLED'].filter(s=>!url.searchParams.get('status')||s===url.searchParams.get('status')).map(hotel)};
 else if(p.includes('/hotel-certification')){if(p.endsWith('/zip'))return route.fulfill({contentType:'application/zip',body:'synthetic-zip'});data={packs:[]};}
 else if(p.endsWith('/certification.zip'))return route.fulfill({contentType:'application/zip',headers:{'Content-Disposition':'attachment; filename="hotel-DELHI-1A-0C-1R-ON-HOLD-TJH-ON_HOLD.zip"','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Disposition'},body:'synthetic-zip'});
 else if(p.endsWith('/exchanges'))data={exchanges,certification};
 else if(/\/exchanges\/\d\//.test(p)){const part=p.endsWith('/request')?'Request':'Response';return route.fulfill({contentType:'application/json',headers:{'Content-Disposition':`attachment; filename="TJH-ON_HOLD-02-HotelHoldBook${part}.json"`,'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Disposition'},body:JSON.stringify(part==='Request'?{url:'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/book',headers:{apikey:'uat-••••••••-key'},body:{bookingId:'TJH-ON_HOLD'}}:{status:{success:true}})});}
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
  const region=page.getByRole('region',{name:'Booking results',exact:true});
  const action=page.locator('td[data-label="Details"] a').first();
  async function checkAction(){const box=await action.boundingBox(),frame=await region.boundingBox();assert.ok(box.x>=frame.x&&box.x+box.width<=frame.x+frame.width,`Details clipped at ${width}`);}
  await checkAction();
  const originalWidth=await region.evaluate(el=>el.querySelector('table').getBoundingClientRect().width);
  const summary=page.locator('summary[aria-label="Show full tenant ID"]').first();
  assert.equal(await summary.getAttribute('title'),'4c86636b-fb0a-4948-92ff-d62d602642b8');
  assert.ok(await summary.evaluate(el=>el.scrollWidth<=el.clientWidth),'short ID must fit without a second truncation');
  assert.equal(await page.locator('summary[aria-label="Show full customer"]').first().getAttribute('title'),'4404f481-de7c-4c04-a283-34554422d8d2');
  await summary.evaluate(el=>{const region=el.closest('[role="region"]');region.scrollLeft=el.closest('td').offsetLeft-10;});
  await summary.click();await page.locator('details[open]').getByText('4c86636b-fb0a-4948-92ff-d62d602642b8',{exact:true}).waitFor();
  assert.equal(await region.evaluate(el=>el.querySelector('table').getBoundingClientRect().width),originalWidth);
  await summary.click();
  assert.equal(await page.locator('td[data-label="Status"]').first().evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
  await region.evaluate(el=>el.scrollLeft=el.scrollWidth);await checkAction();
  assert.ok(await region.evaluate(el=>el.scrollLeft>0),`horizontal scroll missing ${width}`);
  await region.evaluate(el=>el.scrollLeft=0);
  if([390,1440].includes(width))await page.screenshot({path:`${out}/bookings-${width}.png`,fullPage:true});
  await page.locator('td[data-label="Details"] a').first().click();await page.getByRole('heading',{name:'Dubai Marina Test Hotel'}).waitFor();
  // Overview: readable cards, no raw JSON.
  for(const t of ['Booking','Hotel','Amounts','Customer & supplier'])await page.getByRole('heading',{name:t,exact:true}).waitFor();
  await page.getByText('Deluxe King',{exact:true}).waitFor();assert.equal(await page.locator('pre').count(),0,'no raw JSON blocks');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overview overflow ${width}`);
  if([390,1440].includes(width))await page.screenshot({path:`${out}/details-overview-${width}.png`,fullPage:true});
  // Rooms & guests: PAN masked.
  await page.getByRole('tab',{name:'Rooms & guests (1)'}).click();await page.getByText('Mr Arun Guest',{exact:true}).waitFor();
  assert.equal(await page.getByText('ABCDE1234F').count(),0,'PAN never shown in full');await page.getByText('AB••••••4F',{exact:true}).waitFor();
  // Cancellation policy: readable windows.
  await page.getByRole('tab',{name:'Cancellation policy'}).click();await page.getByText('Free',{exact:true}).waitFor();await page.getByText('INR 6,000.00',{exact:true}).waitFor();
  // API logs: structured table, indicators, separate request / response files.
  await page.getByRole('tab',{name:'API logs (3)'}).click();
  // Table on desktop / tablet, one card per call on phones.
  const call=(i)=>width>640?page.locator('tbody tr').nth(i):page.locator(`[data-call="${i}"]`);
  if(width>640)for(const hd of ['Time','API Call','HTTP Status','Duration','Request','Response'])await page.getByRole('columnheader',{name:hd,exact:true}).waitFor();
  else assert.equal(await page.locator('table').count(),0,'phones get cards, not a wide table');
  for(const [i,c] of ['Search','Hold','Booking Details'].entries())await call(i).locator('strong').getByText(c,{exact:true}).waitFor();
  await page.getByText('403: Invalid API key',{exact:true}).waitFor();await page.getByText('✗ 403',{exact:true}).waitFor();await call(1).getByText(/2310 ms/).waitFor();
  await page.getByText('req gw-1',{exact:true}).waitFor();await page.getByText('✗ Review',{exact:true}).waitFor();await page.getByText('✓ Hold',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`logs overflow ${width}`);
  if([390,1440].includes(width))await page.screenshot({path:`${out}/details-logs-${width}.png`,fullPage:true});
  await call(1).getByRole('button',{name:'View'}).first().click();
  const dialog=page.getByRole('dialog');await dialog.getByText(/TJH-ON_HOLD/).first().waitFor();assert.equal(await dialog.getByText(/uat-hotel-key/).count(),0);
  await dialog.getByRole('button',{name:'Close'}).click();
  let dl=page.waitForEvent('download');await call(1).getByRole('button',{name:'Download'}).nth(1).click();assert.equal((await dl).suggestedFilename(),'TJH-ON_HOLD-02-HotelHoldBookResponse.json');
  dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download TripJack Certification ZIP'}).click();assert.equal((await dl).suggestedFilename(),'hotel-DELHI-1A-0C-1R-ON-HOLD-TJH-ON_HOLD.zip');
 }
 await page.goto(`${base}/bookings?status=ON_HOLD&type=hotels`);await page.locator('tbody').getByText('ON_HOLD',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);
 await page.goto(`${base}/supplier-logs`);assert.equal(await page.getByRole('heading',{name:'Hotel UAT certification logs (TripJack Hotel API v3)'}).count(),0);await page.getByRole('link',{name:'Hotel certification logs are now in Bookings →'}).waitFor();
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: fixed columns, full ID reveal, sticky Details at both scroll positions; combined bookings, All/Flights/Hotels, hotel details tabs (overview, rooms with masked PAN, cancellation policy, API logs table with indicators, View / Download request + response, certification ZIP), seven widths, no document overflow, no mutations; certification UI moved.');
})().catch(e=>{console.error(e);process.exit(1)});
