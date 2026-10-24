/* Run with JSDOM_PATH pointing to a local jsdom installation. No live supplier calls. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const ts = require('typescript');
for (const ext of ['.tsx','.ts']) require.extensions[ext] = (module, file) => {
 const source = require('node:fs').readFileSync(file,'utf8');
 module._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
};
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://example.test'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','MouseEvent','localStorage','CustomEvent']) global[key]=dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT = true;
window.requestAnimationFrame = fn=>fn();
global.fetch=async()=>({ok:true,json:async()=>({enabled:false})});
const React = require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const urls=[];
let query="";
const navPath=require.resolve('next/navigation');
require.cache[navPath]={id:navPath,filename:navPath,loaded:true,exports:{useRouter:()=>({push:u=>urls.push(u),prefetch:()=>{}}),useSearchParams:()=>new URLSearchParams(query)}};
const navigationPath=require.resolve('../app/lib/search-navigation.ts');
require.cache[navigationPath]={id:navigationPath,filename:navigationPath,loaded:true,exports:{navigateSearch:u=>urls.push(u)}};
const SearchWidget=require('../app/components/SearchWidget.tsx').default;
let root;
const click=async el=>act(async()=>el.dispatchEvent(new MouseEvent('click',{bubbles:true})));
const key=async(el,value)=>act(async()=>el.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true})));
const input=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.includes(text));
async function airport(id,code){const el=document.getElementById(id);await act(async()=>el.focus());await input(el,code);await key(el,'ArrowDown');await key(el,'Enter');}
async function mount(){urls.length=0;await act(async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(SearchWidget));});}
async function cleanup(){await act(async()=>root.unmount());}
test('airport keyboard selection, clear and editing cannot submit a stale selected code',async()=>{
 await mount();await airport('sw-origin','COK');assert.equal(document.getElementById('sw-origin').value,'Kochi (COK)');
 await act(async()=>document.getElementById('sw-origin').focus());await input(document.getElementById('sw-origin'),'unknown');
 assert.match(document.body.textContent,/No matching airports/);
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(urls.length,0);assert.match(document.querySelector('[role=alert]').textContent,/airport suggestions/);
 await airport('sw-origin','COK');await click(document.querySelector('[aria-label="Clear from airport"]'));assert.equal(document.getElementById('sw-origin').value,'');
 await cleanup();
});
test('round trip supports business cabin and preserves the existing journey request format',async()=>{
 await mount();await click(button('Round Trip'));await airport('sw-origin','COK');await airport('sw-dest','DXB');
 await input(document.getElementById('sw-depart'),'2027-01-10');await input(document.getElementById('sw-return'),'2027-01-20');
 const cabin=document.querySelector('.flight-cabin-label select');await act(async()=>{cabin.value='Business';cabin.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const url=new URL(urls[0],'https://example.test');assert.equal(url.pathname,'/search/journey');
 for(const [k,v]of Object.entries({origin:'COK',destination:'DXB',tripType:'ROUNDTRIP',cabinClass:'BUSINESS',departureDate:'2027-01-10',returnDate:'2027-01-20',adults:'1',children:'0',infants:'0'}))assert.equal(url.searchParams.get(k),v);
 await cleanup();
});
test('multi-city sends every selected segment through the existing legs parameter',async()=>{
 await mount();await click(button('Multi-city'));await airport('sw-origin','COK');await airport('sw-dest','DXB');await input(document.getElementById('sw-depart'),'2027-01-10');
 await airport('sw-leg-0-from','DXB');await airport('sw-leg-0-to','DOH');await input(document.getElementById('sw-leg-0-date'),'2027-01-15');
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const url=new URL(urls[0],'https://example.test');assert.equal(url.searchParams.get('legs'),'COK-DXB-2027-01-10,DXB-DOH-2027-01-15');assert.equal(url.searchParams.get('tripType'),'MULTICITY');
 await cleanup();
});
test('traveller counts enforce one infant per adult and Escape closes the picker',async()=>{
 await mount();await click(document.querySelector('.passengers-select'));
 const addInfant=document.querySelector('[aria-label="Add infants"]');await click(addInfant);assert.equal(addInfant.disabled,true);
 await click(document.querySelector('[aria-label="Add adults"]'));assert.equal(addInfant.disabled,false);
 await click(addInfant);await click(document.querySelector('[aria-label="Remove adults"]'));
 assert.equal(document.querySelector('[aria-label="Add infants"]').disabled,true);
 await key(document,'Escape');assert.equal(document.getElementById('traveller-picker'),null);
 await cleanup();
});
test('same-airport selection gives an actionable message and does not navigate',async()=>{
 await mount();await airport('sw-origin','COK');await airport('sw-dest','COK');
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(urls.length,0);assert.match(document.querySelector('[role=alert]').textContent,/different departure and arrival/);
 await cleanup();
});

test('filter reset removes active filters while retaining route, travellers and sort',async()=>{
 query='origin=COK&destination=DXB&departureDate=2027-01-10&adults=2&sort=duration&stops=0&arrBand=06%E2%80%9312&maxPrice=100&maxPriceCurrency=INR';
 const Controls=require('../app/search/SearchResultControls.tsx').default;
 urls.length=0;await act(async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(Controls,{origin:'COK',destination:'DXB',departureDate:'2027-01-10'}));});
 await click(document.querySelector('.filter-sidebar-title a'));
 const url=new URL(urls.at(-1),'https://example.test');
 for(const k of ['stops','arrBand','maxPrice','maxPriceCurrency'])assert.equal(url.searchParams.has(k),false);
 for(const [k,v]of Object.entries({origin:'COK',destination:'DXB',adults:'2',sort:'duration'}))assert.equal(url.searchParams.get(k),v);
 await click(document.querySelector('.mobile-filter-toggle'));assert.equal(document.body.style.overflow,'hidden');
 assert.equal(document.querySelector('[role=dialog]').getAttribute('aria-modal'),'true');
 await key(document,'Escape');assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(document.body.style.overflow,'');
 await cleanup();query='';
});
test('mobile filters batch changes until Apply and closing discards the draft',async()=>{
 query='origin=COK&destination=DXB&departureDate=2027-01-10&adults=1';urls.length=0;
 const Controls=require('../app/search/SearchResultControls.tsx').default;
 await act(async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(Controls,{origin:'COK',destination:'DXB',departureDate:'2027-01-10'}));});
 await click(document.querySelector('.mobile-filter-toggle'));await click(button('Nonstop'));assert.equal(urls.length,0);
 await click(document.querySelector('.filter-close'));assert.equal(button('Nonstop').getAttribute('aria-pressed'),'false');
 await click(document.querySelector('.mobile-filter-toggle'));await click(button('Nonstop'));await click(button('Show flights'));
 assert.equal(new URL(urls[0],'https://example.test').searchParams.get('stops'),'0');
 await cleanup();query='';
});

test('AI prompt is absent and mounting normal search makes no AI request',async()=>{
 const requests=[];global.fetch=async(url)=>{requests.push(String(url));return{ok:true,json:async()=>({})};};
 await mount();assert.equal(document.querySelector('.flight-ai-search'),null);assert.equal(document.querySelector('.ai-search'),null);
 assert.doesNotMatch(document.body.textContent,/Prefer to describe your trip|Fill search/);assert.equal(requests.some(url=>url.includes('/api/ai/')),false);
 assert.ok(document.getElementById('sw-origin'));assert.ok(document.getElementById('sw-dest'));assert.ok(button('Search live flights'));await cleanup();
});
