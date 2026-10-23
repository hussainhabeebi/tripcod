// Isolated QA fixtures. Never load these in the production application.
const http = require('node:http');
const fs = require('node:fs');
const segments=[{key:'qa-segment',airline:'QA',airlineName:'QA Airways',flightNumber:'QA101',origin:'COK',destination:'DXB',departureTime:'2027-01-10T10:00:00+05:30',arrivalTime:'2027-01-10T12:30:00+04:00',duration:240,ssr:{baggage:[],meal:[],extra:[]}}];
const fare={id:'qa-fare-1',supplier:'TRIPJACK',isBookable:true,airline:'QA',airlineName:'QA Airways',flightNumber:'QA101',origin:'COK',destination:'DXB',departureTime:segments[0].departureTime,arrivalTime:segments[0].arrivalTime,duration:240,stops:0,stopDetails:[],cabinClass:'ECONOMY',baseFare:8000,taxes:2000,totalFare:10000,displayPrice:10000,currency:'INR',isRefundable:true,refundableType:1,baggage:{cabin:'7 kg',checked:'25 kg'},fareClass:'PUBLISHED',fareIdentifier:'PUBLISHED',seatsLeft:4,segments,raw:{}};
const fares=[fare,{...fare,id:'qa-fare-flex',fareIdentifier:'FLEX',totalFare:12000,displayPrice:12000,baggage:{cabin:'7 kg',checked:'30 kg'}},{...fare,id:'qa-fare-2',airline:'QB',airlineName:'QA Connect',flightNumber:'QB202',departureTime:'2027-01-10T14:00:00+05:30',arrivalTime:'2027-01-10T19:30:00+04:00',stops:1,duration:420,totalFare:9000,displayPrice:9000,isRefundable:false,segments:[{...segments[0],flightNumber:'QB201',destination:'BOM',arrivalTime:'2027-01-10T16:00:00+05:30'},{...segments[0],flightNumber:'QB202',origin:'BOM',departureTime:'2027-01-10T17:00:00+05:30',arrivalTime:'2027-01-10T19:30:00+04:00'}]}];
const conditions={holdAllowed:false,seatApplicable:false,emergencyContactRequired:false,gstMandatory:false,gstApplicable:false,passportMandatory:true,passportExpiryRequired:true,dobRequired:{ADULT:true,CHILD:true,INFANT:true},panApplicable:false,documentIdApplicable:false,documentIdMandatory:false};
const passenger={id:'qa-passenger',passengerType:'ADULT',firstName:'Sample',lastName:'Traveller',dob:'1990-01-01',gender:'M',nationality:'IN',passportNumber:'QA0000001',passportExpiry:'2030-01-01',passportCountry:'IN',title:'MR'};
const booking={id:'qa-booking',status:'PAYMENT_PENDING',origin:'COK',destination:'DXB',totalAmount:'10000',currency:'INR',heldUntil:null,contactEmail:'sample@example.test',contactPhone:'+919000000000',flightData:fare,adultCount:1,childCount:0,infantCount:0};
function createMockApi(port=4788){const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await (const c of req)body+=c;const path=new URL(req.url,'http://localhost').pathname;requests.push({method:req.method,path,body:body?JSON.parse(body):null,auth:req.headers.authorization});fs.writeFileSync('/tmp/tripcod-qa-requests.json',JSON.stringify(requests,null,2));res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS'){res.end('{}');return;}
let data={};let status=200;
if(path==='/api/search')data={fares:body && JSON.parse(body).tripType==='ROUNDTRIP' ? [{...fare,id:'qa-combo',tripKey:'COMBO',segments:[...segments,{...segments[0],origin:'DXB',destination:'COK',departureTime:'2027-01-20T10:00:00+04:00',arrivalTime:'2027-01-20T15:30:00+05:30',isReturn:true}],totalFare:20000,displayPrice:20000}] : fares,searchId:'qa-search',isIndicative:false};
else if(path==='/api/search/fx')data={rates:{AED:22.8,USD:83.7,INR:1}};
else if(path==='/api/ai/status')data={tripSearch:false};
else if(path==='/api/book/review')data={bookingId:'qa-review',totalFare:10000,displayTotal:10000,currency:'INR',fareIdentifiers:['PUBLISHED'],segments,conditions};
else if(path.includes('/fare-rules/'))data={fareRules:[{category:'CANCELLATION',description:'QA fixture: verify supplier rules before purchase.'}]};
else if(path.endsWith('/passengers') && req.method==='PUT')data={success:true};
else if(path.startsWith('/api/checkout/session/'))data={booking,passengers:[passenger],meta:{whatsappPhone:null,agentId:null,tokenExpiresAt:'2027-01-11T00:00:00Z'}};
else if(path==='/api/profile/account')data={account:{name:'QA Traveller',currency:'INR'}};
else if(path==='/api/profile/passengers')data={passengers:[]};
else if(path==='/api/profile/trips')data={trips:[{...booking,status:'TICKETED',pnr:'QAONLY',departureDate:'2027-01-10',totalAmount:10000,createdAt:'2026-10-23T10:00:00Z'},{...booking,id:'qa-cancelled',status:'CANCELLED',pnr:null,departureDate:'2026-01-10',totalAmount:10000,createdAt:'2026-01-01T00:00:00Z'}]};
else if(path.includes('/payments/config')||path.includes('/payments/methods'))data={NOMOD:true,RAZORPAY:false,gateways:{NOMOD:true,RAZORPAY:false}};
else if(req.method==='POST'||req.method==='PUT'){status=409;data={error:'QA: writes are intentionally disabled'};}
else data={};res.writeHead(status);res.end(JSON.stringify(data));});server.listen(port,'127.0.0.1');return {server,requests};}
module.exports={createMockApi,fare,fares,booking,passenger};
if(require.main===module){createMockApi();console.log('Mock-only API on 4788');}
