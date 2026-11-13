const { chromium } = require('playwright');const path=require('path');const D=process.argv[2];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(D,'shot.html')+'?s=loaders&shot=1&theme=light');await p.evaluate(()=>document.fonts.ready);
const el=await p.$('.lq.xl');const box=await el.boundingBox();const clip={x:box.x-20,y:box.y-20,width:box.width+40,height:box.height+40};
await p.waitForTimeout(Number(process.argv[3]||7000));let i=0;
await p.screenshot({path:path.join(D,`f4-${i++}.png`),clip});
await p.evaluate(()=>{document.querySelector('.lq.xl').__lqFinish();});
for(let k=0;k<11;k++){await p.waitForTimeout(300);await p.screenshot({path:path.join(D,`f4-${i++}.png`),clip});}
console.log('errors',errs);await b.close();})();
