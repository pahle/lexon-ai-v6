const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const errs=[];
const S=process.argv[2].split(',');const out=process.argv[3];
for(const spec of S){const [st,v,th]=spec.split(':');const mob=v==='m';
 const p=await b.newPage({viewport:mob?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:1});
 p.on('pageerror',e=>errs.push(st+': '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(st+': '+m.text())});
 await p.goto('file://'+process.cwd()+'/shot.html?shot=1'+(mob?'&m=1':'')+(th?'&theme='+th:'')+'#'+st);await p.waitForTimeout(400);
 await p.screenshot({path:`${out}/${st}-${mob?'m':'d'}${th?'-'+th:''}.png`});await p.close();}
console.log(errs.length?errs.join('\n'):'no errors');await b.close();})();
