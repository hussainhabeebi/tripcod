// Extract the packaged QA browser without tar ownership changes (restricted containers).
// First: npm install --prefix /tmp/tripcod-browser @sparticuz/chromium lighthouse jsdom --ignore-scripts
const fs=require('node:fs'),z=require('node:zlib'),cp=require('node:child_process');
const src='/tmp/tripcod-browser/node_modules/@sparticuz/chromium/bin/';const out='/tmp/tripcod-chrome';
fs.mkdirSync(out,{recursive:true});
for(const name of ['chromium','fonts.tar','swiftshader.tar','al2023.tar']){
 const bytes=z.brotliDecompressSync(fs.readFileSync(src+name+'.br'));
 fs.writeFileSync(out+'/'+name,bytes,{mode:name==='chromium'?0o700:0o600});
 if(name!=='chromium')cp.execFileSync('tar',['--no-same-owner','-xf',out+'/'+name,'-C',out]);
}
console.log('Chromium extracted to '+out+'/chromium');
