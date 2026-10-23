const fs=require('node:fs'),cp=require('node:child_process'),ts=require('typescript'),assert=require('node:assert/strict');
const base='0375431a5d716fdce44faf0b2ac1568a46422b33';
const checks=[];
function sourceAt(file){return cp.execFileSync('git',['show',base+':'+file],{encoding:'utf8'});}
function fn(source,name){const ast=ts.createSourceFile('file.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);assert.ok(found,'Function exists: '+name);return found;}
for(const [file,names] of Object.entries({
 'apps/web/app/search/page.tsx':['searchFlights','buildBookUrl','inChosenCurrency'],
 'apps/web/app/book/page.tsx':['start','submit','startNomodPayment','payWithWallet','holdFare'],
 'apps/web/app/checkout/[token]/CheckoutFlow.tsx':['saveAndReview'],
 'apps/web/app/checkout/[token]/CheckoutClient.tsx':['initiatePayment','ensureRazorpay'],
}))for(const name of names){assert.equal(fn(fs.readFileSync(file,'utf8'),name),fn(sourceAt(file),name));checks.push({file,function:name,result:'unchanged'});}
for(const file of ['apps/web/app/lib/customer-api.ts','apps/web/app/lib/fx.ts']){assert.equal(fs.readFileSync(file,'utf8'),sourceAt(file));checks.push({file,result:'byte-for-byte unchanged'});}
const backend=cp.execFileSync('git',['diff','--name-only',base,'--','apps/api','packages/suppliers','packages/db','apps/web/middleware.ts','.github','apps/web/wrangler.jsonc'],{encoding:'utf8'}).trim();assert.equal(backend,'');
const paymentFile='apps/web/app/checkout/[token]/CheckoutClient.tsx';
assert.equal(fs.readFileSync(paymentFile,'utf8'),sourceAt(paymentFile).replaceAll('#94a3b8','#626568'));
const report={base,protectedBackendPathsUnchanged:true,paymentComponentOnlyColorEdits:true,checks};
fs.writeFileSync('docs/qa-tripcod/regression.json',JSON.stringify(report,null,2));console.log('PASS',checks.length,'request/payment/auth invariants; backend paths unchanged');
