const assert=require('node:assert/strict');
const path=require('node:path');
const shot=async(page,name,width)=>{if(width===390)await page.screenshot({path:path.resolve(__dirname,'../../../../docs/qa-tripcod/screenshots/'+name+'-390.jpg'),type:'jpeg',quality:82,fullPage:false});};
module.exports=async function interaction(page,screen,width){
 if(screen==='home'){
  for(const [id,code]of [['sw-origin','COK'],['sw-dest','DXB']]){const el=page.locator('#'+id);await el.fill(code);await el.press('ArrowDown');await el.press('Enter');await page.waitForFunction(({id,code})=>document.getElementById(id)?.value.includes('('+code+')'),{id,code});}
  await page.getByRole('button',{name:'Swap airports',exact:true}).click();await page.waitForFunction(()=>document.getElementById('sw-origin')?.value.includes('(DXB)'));assert.match(await page.locator('#sw-origin').inputValue(),/DXB/);assert.match(await page.locator('#sw-dest').inputValue(),/COK/);
  await page.getByRole('button',{name:'Round Trip',exact:true}).click();await page.locator('#sw-depart').fill('2027-01-10');const dateBox=await page.locator('#sw-depart').boundingBox();await page.locator('#sw-depart').click({position:{x:dateBox.width-18,y:dateBox.height/2}});await page.waitForTimeout(300);await shot(page,'calendar',width);await page.keyboard.press('Escape');await page.locator('#sw-return').fill('2027-01-09');assert.equal(await page.locator('#sw-return').evaluate(e=>e.checkValidity()),false);await page.locator('#sw-return').fill('2027-01-20');await page.locator('.flight-cabin-label select').selectOption('Business');
  await page.locator('.passengers-select').click();await page.getByRole('button',{name:'Add infants',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Add infants',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Done',exact:true}).click();
  if(width<1024){await page.locator('.home-mobile-menu summary').click();assert.equal(await page.locator('.home-mobile-menu-panel').isVisible(),true);await page.locator('.home-mobile-menu-panel').getByRole('link',{name:'My Trips',exact:true}).click();await page.waitForURL('**/trips');}
 }
 if(screen==='results'){
  await page.locator('.fare-card-v2-details summary').first().click();assert.equal(await page.locator('.flight-timeline').first().isVisible(),true);
  if(width<=900){await page.locator('.mobile-filter-toggle').click();assert.equal(await page.locator('[role=dialog]').isVisible(),true);await shot(page,'filters',width);await page.locator('.filter-apply').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('[role=dialog]').evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.filter-apply').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('[role=dialog]').count(),0);await page.locator('.mobile-filter-toggle').click();}
  await page.getByRole('button',{name:'Nonstop',exact:true}).click();if(width<=900)await page.getByRole('button',{name:'Show flights',exact:true}).click();
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('stops')==='0',null,{timeout:15000});
  await page.locator('.result-refresh').waitFor({state:'hidden'});assert.equal(await page.locator('.fare-card-v2').count(),1);
  if(width<=900)await page.locator('.mobile-filter-toggle').click();
  await page.locator('.filter-sidebar-title a').click();if(width<=900)await page.getByRole('button',{name:'Show flights',exact:true}).click();
  await page.waitForFunction(()=>!new URL(location.href).searchParams.has('stops'),null,{timeout:15000});
  await page.locator('.result-refresh').waitFor({state:'hidden'});assert.equal(await page.locator('.fare-card-v2').count(),2);
  if(width<=900 && await page.locator('.filter-close').isVisible())await page.locator('.filter-close').click();
  const more=page.locator('.fare-variants-toggle');if(await more.count()){await more.first().click();await page.locator('.fare-variant input').last().check();assert.match(await page.locator('.fare-variant-book').last().getAttribute('href'),/qa-fare-flex/);}
 }
 if(screen==='passengers'){
  for(const [label,value]of Object.entries({'First name':'Alex','Last name':'Traveller','Date of birth':'1990-01-01','Passport number':'QA0000001','Passport expiry':'2030-01-01','Passport issue date':'2020-01-01','Email address':'sample@example.test','Mobile number':'+919000000000'}))await page.getByLabel(label,{exact:true}).fill(value);
  const bar=await page.locator('.ck .pay').boundingBox();assert.ok(bar.x>=-1&&bar.x+bar.width<=width+1);assert.ok(bar.y+bar.height<=901);
  await page.getByRole('button',{name:'Review booking',exact:true}).click();await page.getByRole('heading',{name:'Review your booking',exact:true}).waitFor();await shot(page,'booking-review',width);assert.equal(await page.locator('.booking-progress [aria-current=step]').innerText(),'3\nBooking review');await page.getByRole('button',{name:'Edit details',exact:true}).click();assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Alex');
 }
 if(screen==='checkout'){
  await page.getByRole('button',{name:'Review booking →',exact:true}).click();await page.getByRole('heading',{name:'Confirm passenger details'}).waitFor();await page.locator('#exact-confirm').check();await page.getByRole('button',{name:'Continue to payment →',exact:true}).click();await page.getByRole('button',{name:/Pay now/}).waitFor();await shot(page,'payment',width);assert.equal(await page.locator('.booking-progress [aria-current=step]').innerText(),'4\nPayment');
 }
 if(screen==='trips'){
  await page.getByRole('button',{name:/^Cancelled/}).click();assert.equal(await page.locator('main article').count(),1);await page.getByRole('button',{name:/^Upcoming/}).click();assert.equal(await page.locator('main article').count(),1);
 }
 if(screen==='journey'){
  await page.getByRole('heading',{name:'Complete journey fares'}).waitFor();await page.getByRole('button',{name:/^QA Airways/}).click();await page.getByRole('button',{name:/Continue/}).waitFor();
 }
};
