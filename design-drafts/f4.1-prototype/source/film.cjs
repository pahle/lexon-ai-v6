const { chromium } = require('playwright');const path=require('path');const D=process.argv[2];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(D,'shot.html')+'?s=loaders&shot=1&theme=light');await p.evaluate(()=>document.fonts.ready);
const el=await p.$('.lq.xl');const box=await el.boundingBox();
for(let i=0;i<32;i++){await p.waitForTimeout(250);await p.screenshot({path:path.join(D,`fm-${String(i).padStart(2,'0')}.png`),clip:{x:box.x-20,y:box.y-20,width:box.width+40,height:box.height+40}});}
console.log('errors',errs);await b.close();})();
