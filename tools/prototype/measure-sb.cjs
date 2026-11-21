const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});
for(const id of ['shell-team','sidebar-collapsed','chat-reasoning-collapsed']){await p.goto('file://'+process.cwd()+'/shot.html?shot=1#'+id);await p.waitForTimeout(200);
 const r=await p.evaluate(()=>{const out=[];const sb=document.querySelector('.sb');
  const box=(el)=>{const r=el.getBoundingClientRect();return [Math.round(r.left*10)/10,Math.round(r.right*10)/10]};
  const glyph=(svg)=>{let mn=1e9,mx=-1e9;svg.querySelectorAll('path,circle,rect').forEach(e=>{const r=e.getBoundingClientRect();if(r.width||r.height){mn=Math.min(mn,r.left);mx=Math.max(mx,r.right)}});return [Math.round(mn*10)/10,Math.round(mx*10)/10]};
  sb.querySelectorAll('.ini,.avatar').forEach(e=>out.push(e.className+' '+box(e)));
  sb.querySelectorAll('.nb').forEach(nb=>{const t=nb.querySelector('.t,.two');const svgs=[...nb.querySelectorAll(':scope>svg,:scope>span>svg')];const k=nb.querySelector('.kbd');
   out.push((t?t.textContent.trim().slice(0,14):'-')+' | text '+(t?box(t)[0]:'')+' | first '+(svgs[0]?glyph(svgs[0]):'')+' | last '+(svgs.length>1?glyph(svgs[svgs.length-1]):'')+(k?' | kbd '+box(k)[1]:''))});
  return out;});
 console.log('== '+id);r.forEach(x=>console.log(x));}
await b.close();})();
