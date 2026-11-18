/* ===== Revision 14: one prototype state per captured route (ids = capture ids), mobile for every state ===== */
var UI={};
function chatShell(b,{c=composer(),toast='',scroll=false}={}){
 return `<div class="main">${topbar(crumbT)}<div class="view"><div style="flex:1;width:100%;display:flex;justify-content:center;overflow:hidden"><div class="thread">${b}</div></div>${scroll?`<div class="scrolldown" aria-label="Scroll to latest">${sv('down2',18)}</div>`:''}${c}</div>${toast}</div>`;
}
const toastEl=t=>`<div class="toast" role="status">${sv('check')}<span>${t}</span></div>`;
function starterPill(){
 const comp=composer({text:'x'}).replace(/<textarea[^>]*>x<\/textarea>/,'<div class="ctext" role="textbox" aria-multiline="true" aria-label="Message">Explain Article <span class="ph">[number]</span> of <span class="ph">[law or regulation]</span> in plain language.<span class="cur"></span></div>');
 return `<div class="main home">${topbar('')}<div class="view" style="justify-content:center;gap:22px;padding-bottom:80px"><div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"><h1 style="margin:0;font-family:var(--serif);font-weight:400;font-size:46px;letter-spacing:-.01em">Good morning, Ayu</h1></div>${comp}<div class="chips" style="margin-top:14px"><button class="chip on" aria-pressed="true">Explain an article</button><button class="chip">Compare two rules</button><button class="chip">Check a clause</button><button class="chip">Summarize a regulation</button></div></div></div>`;
}
/* sign-in variants */
function signinVariant(kind){
 const email='ayu@hukum-nusantara.co.id', pend=kind==='pending', al=kind==='alert';
 return authFrame(`${head('Sign in to Lexon','Enter your work email and password.')}
 ${al?`<div class="falert" role="alert">${sv('alert')}<span>Email or password is incorrect. Check them and try again.</span></div>`:''}
 <div class="field"><label for="em">Email</label><input id="em" class="inp lg" value="${email}" ${pend?'disabled':''}></div>
 <div class="field"><label for="pw">Password <a href="#">Forgot password?</a></label><div style="position:relative"><input id="pw" type="password" class="inp lg" value="password12345" ${pend?'disabled':''}><button class="ib" style="position:absolute;right:6px;top:6px" aria-label="Show password">${sv('eye')}</button></div></div>
 <button class="btn primary lg full" ${pend?'aria-disabled="true"':''}>${pend?'<span class="spin" aria-hidden="true"></span>Signing in…':'Sign in'}</button><p class="alt">New to Lexon? <a href="#">Create an account</a></p>`);
}
/* settings: one dialog, six sections, fixed size; full-screen sheet on mobile */
function settingsAll(sec,{toast=''}={}){
 const L={profile:'Profile',appearance:'Appearance',security:'Security',members:'Members',invitations:'Invitations',general:'General'};
 const nb=k=>`<button class="nb ${k===sec?'on':''}">${L[k]}</button>`, gl=t=>`<div class="glabel" style="padding:12px 8px 4px">${t}</div>`;
 const nav=gl('Account')+nb('profile')+nb('appearance')+nb('security')+gl('Hukum Nusantara')+nb('members')+nb('invitations')+nb('general');
 const save=t=>`<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary">${t}</button></div>`;
 const B={};
 B.profile=`<h3 class="sh">Profile</h3><p class="sd">How you appear to people in your organizations.</p><div class="srow"><div><div class="rt">Display name</div><div class="rd">How people in your organizations see you.</div></div><input class="inp" style="width:280px" value="Ayu Wardani" aria-label="Display name"></div><div class="srow"><div><div class="rt">Job title</div><div class="rd">Shown under your name in the sidebar.</div></div><input class="inp" style="width:280px" value="Senior Associate" aria-label="Job title"></div><div class="srow"><div><div class="rt">Email</div><div class="rd">Used to sign in. Change it in Security.</div></div><span style="color:var(--mfg)">ayu@hukum-nusantara.co.id</span></div>${save('Save')}`;
 const t=[['Light','#F5F4F4','#FFFFFF','#DDDADA',false],['Dark','#181516','#121011','#3A3536',false],['System','linear-gradient(90deg,#F5F4F4 50%,#181516 50%)','linear-gradient(90deg,#FFFFFF 50%,#121011 50%)','#9A9495',true]];
 B.appearance=`<h3 class="sh">Appearance</h3><p class="sd" style="margin-bottom:20px">Choose how Lexon looks on this device.</p><div role="radiogroup" aria-label="Theme" style="display:flex;gap:16px">${t.map(([n,l,r,line,on])=>`<button class="tcard ${on?'on':''}" role="radio" aria-checked="${on}"><span class="prev"><span style="flex:1;background:${l}"></span><span style="flex:2;background:${r};padding:12px;display:flex;flex-direction:column;gap:6px"><span style="height:8px;width:60%;border-radius:4px;background:${line}"></span><span style="height:8px;width:80%;border-radius:4px;background:${line}"></span></span></span><span style="font-weight:500">${n}</span></button>`).join('')}</div>`;
 const sess=[['monitor','Chrome on macOS','Active now',true],['phone','Safari on iPhone','Signed in 3 days ago',false],['monitor','Edge on Windows','Signed in 9 days ago',false]];
 B.security=`<h3 class="sh">Security</h3><p class="sd">Manage how you sign in and where you are signed in.</p><div class="srow inl"><div><div class="rt">Password</div><div class="rd">Last changed 2 months ago.</div></div><button class="btn outline">Change password</button></div><div class="srow inl"><div><div class="rt">Email</div><div class="rd">ayu@hukum-nusantara.co.id</div></div><button class="btn outline">Change email</button></div><div class="srow inl"><div><div class="rt">Two-step verification <span class="badge">On</span></div><div class="rd">Authenticator app. 8 recovery codes left.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn outline">Recovery codes</button><button class="btn outline">Manage</button></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:20px"><div style="font-weight:600">Where you are signed in</div><button class="btn outline">Sign out other sessions</button></div>${sess.map(([ic,d,m,cur])=>`<div class="srow inl"><div style="display:flex;gap:12px;align-items:center"><span class="dev">${sv(ic,18)}</span><div><div class="rt">${d}${cur?' <span class="badge">This device</span>':''}</div><div class="rd">${m}</div></div></div>${cur?'':'<button class="btn outline">Sign out</button>'}</div>`).join('')}`;
 const mem=[['AW','Ayu Wardani (you)','ayu@hukum-nusantara.co.id','Owner'],['RP','Rizky Pratama','rizky@hukum-nusantara.co.id','Admin'],['SW','Sari Wibowo','sari@hukum-nusantara.co.id','Member']];
 B.members=`<div style="display:flex;justify-content:space-between;align-items:center"><h3 class="sh" style="margin:0">Members</h3><button class="btn primary">${sv('plus')}Invite people</button></div><p class="sd">3 members in Hukum Nusantara.</p>${mem.map(([i,n,e,r],k)=>`<div class="mrow"><span class="avatar">${i}</span><div class="two"><span class="a">${n}</span><span class="b">${e}</span></div>${k===0?`<span class="badge">${r}</span>`:`<button class="btn outline sm">${r}${sv('down2',14)}</button><button class="ib" aria-label="More actions for ${n}">${sv('dots')}</button>`}</div>`).join('')}`;
 B.members+=`<div style="display:flex;justify-content:flex-end;padding-top:16px"><button class="btn outline">Leave organization</button></div>`;
 const inv=[['dimas@hukum-nusantara.co.id','Member','Expires 25 Nov 2026',false],['lina@hukum-nusantara.co.id','Admin','Expires 24 Nov 2026',false],['bagus@hukum-nusantara.co.id','Member','Expired 12 Nov 2026',true]];
 B.invitations=`<h3 class="sh">Invitations</h3><p class="sd">Invite people by email. An invitation expires after 7 days.</p><div class="irow"><input class="inp" placeholder="name@firm.co.id" aria-label="Email to invite"><button class="btn outline">Member${sv('down2',14)}</button><button class="btn primary">Send invitation</button></div><div class="ssub">Pending invitations</div>${inv.map(([e,r,x,bad])=>`<div class="mrow"><span class="avatar">${sv('mail',16)}</span><div class="two"><span class="a">${e}</span><span class="b">${r} · <span style="${bad?'color:var(--redtext)':''}">${x}</span></span></div><button class="btn outline sm">Resend</button><button class="btn ghost sm">Cancel</button></div>`).join('')}`;
 B.general=`<h3 class="sh">General</h3><p class="sd">Settings for everyone in Hukum Nusantara.</p><div class="srow"><div><div class="rt">Organization name</div><div class="rd">Shown in the organization switcher.</div></div><input class="inp" style="width:280px" value="Hukum Nusantara" aria-label="Organization name"></div><div class="srow"><div><div class="rt">Slug</div><div class="rd">Used in links. Lowercase letters, numbers, and hyphens.</div></div><input class="inp" style="width:280px" value="hukum-nusantara" aria-label="Slug"></div><div class="srow inl"><div><div class="rt">Require two-step verification</div><div class="rd">Members without it must set it up before they can open this workspace.</div></div><span class="sw" role="switch" aria-checked="false" aria-label="Require two-step verification"></span></div>${save('Save changes')}`;
 if(MOB) return `<div class="app mobile"><div class="sdlg m" role="dialog" aria-modal="true" aria-label="Settings"><div class="shd"><button class="ib" aria-label="Back to sections">${sv('left')}</button><h2>${L[sec]}</h2><button class="ib" aria-label="Close settings">${sv('x')}</button></div><div class="sbody">${B[sec]}</div></div>${toast}</div>`;
 return `<div class="app">${sidebar('x',{active:'a'})}${thread('thread')}<div class="overlay"></div><div class="sdlg" role="dialog" aria-modal="true" aria-label="Settings"><div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 24px;border-bottom:1px solid var(--border)"><h2 style="margin:0;font-size:16px;font-weight:600">Settings</h2><button class="ib" aria-label="Close settings">${sv('x')}</button></div><div style="flex:1;display:flex;min-height:0"><nav style="width:240px;flex:none;padding:12px;border-right:1px solid var(--sb-border);background:var(--sidebar);display:flex;flex-direction:column;gap:2px">${nav}</nav><div class="sbody">${B[sec]}</div></div></div>${toast}</div>`;
}
/* platform pages (F4.1 scope: today's provisioning and account status; F4.3 replaces them with Accounts and Organizations) */
const fs=(id,label,{ph='',value='',hint='',span=false}={})=>`<div class="field ${span?'span':''}"><label for="${id}">${label}</label><input id="${id}" class="inp" placeholder="${ph}" value="${value}">${hint?`<span class="fhint">${hint}</span>`:''}</div>`;
const pcard=(t,d,body)=>`<section class="pcard"><div><h2>${t}</h2>${d?`<p class="pd">${d}</p>`:''}</div>${body}</section>`;
function platformPage(kind){
 const prov=pcard('Provision a team organization','The organization has no members or content until its first owner accepts the invitation.',`<div class="pgrid">${fs('on','Organization name',{ph:'Hukum Nusantara'})}${fs('os','Organization slug',{ph:'hukum-nusantara',hint:'Lowercase letters, numbers, and hyphens.'})}${fs('oe','First owner email',{ph:'owner@firm.co.id',span:true})}</div><div class="pacts"><button class="btn primary">Provision organization</button></div>`);
 const rows=[['Harbor Legal Partners','harbor-legal-partners','Pending','21 Nov 2026',false],['Sinar Hukum','sinar-hukum','Expired','12 Nov 2026',true],['Kantor Hukum Wibowo','kantor-hukum-wibowo','Pending','23 Nov 2026',false]];
 const th=`<div class="tr th"><span>Organization</span><span>Owner invitation</span><span>Expires</span><span></span></div>`;
 let list;
 if(kind==='populated') list=`<div class="tbl">${th}${rows.map(([n,s,st,x,bad])=>`<div class="tr"><span class="c1"><b style="font-weight:500">${n}</b><small>${s}</small></span><span class="c2"><span class="badge ${bad?'warn':''}">${st}</span></span><span class="c3">${x}</span><span class="go">${sv('right')}</span></div>`).join('')}</div>`;
 if(kind==='loading') list=`<div class="tbl">${th}${[60,44,52].map(w=>`<div class="tr"><span class="c1"><div class="skel" style="width:${w}%"></div></span><span class="c2"><div class="skel" style="width:64px"></div></span><span class="c3"><div class="skel" style="width:88px"></div></span><span></span></div>`).join('')}</div>`;
 if(kind==='empty') list=`<div class="empty" style="padding:40px 0;border:1px dashed var(--border);border-radius:12px"><div class="ic">${sv('users',20)}</div><h2>No organizations are waiting for an owner</h2><p style="margin:0">Organizations you provision appear here until their first owner accepts.</p></div>`;
 if(kind==='error') list=`<div class="erow" role="alert"><span class="ic">${sv('alert',18)}</span><span class="tx">We could not load organizations.</span><button class="btn outline" style="flex:none">${sv('regen',14)}Try again</button></div>`;
 const sec=`<div class="psec"><div><h2>Awaiting first owner</h2><p class="pd">Organizations stay in provisioning until the first owner accepts the invitation.</p></div>${list}</div>`;
 return `<div class="ppage"><div class="phead"><h1 class="ptitle">Organization provisioning</h1><p>Create team organizations and track their first owner invitations.</p></div>${prov}${sec}</div>`;
}
function platformDetail(){
 return `<div class="ppage"><a class="slink" href="#" style="align-self:flex-start;margin:0 0 -12px -10px">${sv('back',16)}Provisioning</a><div class="phead"><div class="row"><h1 class="ptitle">Harbor Legal Partners</h1><span class="badge">Provisioning</span></div><p>harbor-legal-partners · Provisioned 14 Nov 2026</p></div>
 ${pcard('Owner invitation','',`<div class="idl wide"><span>State</span><b>Provisioning</b><span>Owner invitation</span><b>Pending</b><span>Expires</span><b>21 Nov 2026, 11:00</b></div><div class="pacts" style="justify-content:flex-start"><button class="btn outline">Resend invitation</button><button class="btn outline dtext">Cancel provisioning</button></div>`)}
 ${pcard('Replace owner email','Sends a new invitation to a different person. The current invitation stops working.',`${fs('re','New owner email',{ph:'owner@firm.co.id'})}<div class="pacts"><button class="btn primary">Replace and send</button></div>`)}</div>`;
}
function platformAccounts(){
 return `<div class="ppage"><div class="phead"><h1 class="ptitle">Account status</h1><p>Disable an account to sign it out everywhere and block sign-in. Its organizations and content stay unchanged.</p></div>
 ${pcard('Find an account','Enter the user ID from the audit log or a support request.',`${fs('uid','User ID',{ph:'usr_01J…'})}<div class="pacts"><button class="btn outline">Enable account</button><button class="btn danger">Disable account</button></div>`)}</div>`;
}
const GROUPS=[
 ['Auth',['sign-in','sign-in-field-errors','sign-in-form-alert','sign-in-pending','sign-up','forgot-password','forgot-password-sent','reset-password','reset-password-invalid','verify-email','two-factor','accept-invitation','accept-invitation-declined','accept-invitation-unavailable','admin-setup','admin-setup-activate','admin-setup-unavailable','onboarding','onboarding-invitations','onboarding-team']],
 ['Status',['not-found','organizations-not-found','workspace-error','platform-no-access']],
 ['Shell',['shell-personal','shell-team','organization-switcher-open','user-menu-open','recent-menu','sidebar-collapsed','mobile-sheet-open']],
 ['Chat',['chat-new','chat-starter-pill','chat-deep-thinking','chat-thinking','chat-streaming-scroll','chat-reasoning-collapsed','chat-reasoning-open','chat-answer-actions','chat-copied','chat-feedback','chat-edit','chat-branch','chat-stopped','chat-error','chat-reconnecting','chat-thread-loading','chat-floating-menu','chat-rename','chat-delete']],
 ['Chats',['chats-history','chats-search','chats-no-results','chats-empty','chats-loading']],
 ['Settings',['settings-profile','settings-appearance','settings-security','settings-members','settings-invitations','settings-general','toast-success']],
 ['Platform',['platform-accounts','platform-provisioning-populated','platform-provisioning-empty','platform-provisioning-loading','platform-provisioning-error','platform-provisioning-detail']],
 ['Indicator',['indicator']]
];
const AUTHMAP={'sign-in':'signin','sign-in-field-errors':'signin-errors','sign-up':'signup','forgot-password':'forgot','forgot-password-sent':'forgot-sent','reset-password':'reset','reset-password-invalid':'reset-invalid','verify-email':'verify','two-factor':'twofactor','accept-invitation':'invite','accept-invitation-unavailable':'invite-invalid','admin-setup':'setup','admin-setup-unavailable':'setup-invalid','onboarding':'onboard-1','onboarding-invitations':'onboard-2','onboarding-team':'onboard-3','accept-invitation-declined':'invite-declined','admin-setup-activate':'setup-activate'};
const STATUSMAP={'not-found':'notfound','organizations-not-found':'org-notfound','workspace-error':'ws-error','platform-no-access':'noaccess'};
const THREADMAP={'chat-thinking':'thinking','chat-streaming-scroll':'streaming','chat-reasoning-collapsed':'thread','chat-reasoning-open':'reasoning','chat-answer-actions':'actions','chat-edit':'edit','chat-branch':'branch','chat-stopped':'stopped','chat-error':'error','chat-reconnecting':'reconnect','chat-thread-loading':'loading','chat-floating-menu':'thread','chat-rename':'thread','chat-delete':'thread','organization-switcher-open':'thread','user-menu-open':'thread','recent-menu':'thread','sidebar-collapsed':'thread','mobile-sheet-open':'thread'};
function screen(st){
 UI={fmenu:st==='chat-floating-menu'};
 const app=(sb,main,extra='',sheet=false)=>`<div class="app ${MOB?'mobile':''} ${MOB&&sheet?'sheet':''}">${MOB&&sheet?'<div class="overlay"></div>':''}${sb}${main}${extra}</div>`;
 if(AUTHMAP[st]) return `<div class="app ${MOB?'mobile':''}">${authState(AUTHMAP[st])}</div>`;
 if(st==='sign-in-form-alert'||st==='sign-in-pending') return `<div class="app ${MOB?'mobile':''}">${signinVariant(st==='sign-in-pending'?'pending':'alert')}</div>`;
 if(STATUSMAP[st]) return statusPage(STATUSMAP[st]);
 if(st.startsWith('settings-')) return settingsAll(st.slice(9));
 if(st==='toast-success') return settingsAll('profile',{toast:toastEl('Changes saved.')});
 if(st.startsWith('platform-')){const p=st==='platform-accounts'?'acct':'prov';const main=`<div class="main">${topbar('',{nopill:true})}<div class="view">${st==='platform-accounts'?platformAccounts():st==='platform-provisioning-detail'?platformDetail():platformPage(st.replace('platform-provisioning-',''))}</div></div>`;return app(sidebar('personal',{platform:p,none:true}),main);}
 if(st==='indicator') return app(sidebar('x',{active:'a'}),thread('loaders'));
 if(st.startsWith('chats-')){const k={'chats-history':'history','chats-search':'search','chats-no-results':'noresults','chats-empty':'empty'}[st];
  if(st==='chats-loading') return app(sidebar('x',{page:true,loading:true}),historyLoading());
  return app(sidebar('x',{page:true,active:'a',none:k==='empty'}),history(k));}
 if(['shell-personal','shell-team','chat-new','chat-deep-thinking','chat-starter-pill'].includes(st)){
  const sb=sidebar(st==='shell-personal'?'personal':'x',{home:true,active:null});
  const main=st==='chat-starter-pill'?starterPill():home(st==='chat-deep-thinking'?'deep':'newchat');
  return app(sb,main);}
 const sk={'organization-switcher-open':'org','user-menu-open':'user','sidebar-collapsed':MOB?'x':'collapsed'}[st]||'x';
 const c={active:'a',menu:st==='recent-menu'?'b':null};
 const sheet=['mobile-sheet-open','organization-switcher-open','user-menu-open','recent-menu'].includes(st);
 let main;
 if(st==='chat-copied') main=chatShell(um(Q1)+`<div class="am">${who('Thought for 14 seconds',false)}${A1}${abar({copied:true})}</div>`);
 else if(st==='chat-feedback') main=chatShell(um(Q1)+`<div class="am">${who('Thought for 14 seconds',false)}${A1}${abar({fb:'up'})}</div>`,{toast:toastEl('Thanks for your feedback.')});
 else main=thread(THREADMAP[st]||'thread');
 let extra='';
 if(st==='chat-delete') extra=`<div class="overlay"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dt"><h2 id="dt">Delete this chat?</h2><p>“Syarat sah perjanjian (Pasal 1320)” and all its messages will be permanently deleted. This cannot be undone.</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn outline">Cancel</button><button class="btn danger">Delete chat</button></div></div>`;
 if(st==='chat-rename') extra=`<div class="overlay"></div><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="rt"><h2 id="rt">Rename chat</h2><div class="field"><label for="rn">Chat title</label><input id="rn" class="inp focus" value="Syarat sah perjanjian (Pasal 1320)"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn outline">Cancel</button><button class="btn primary">Save</button></div></div>`;
 return app(sidebar(sk,c),main,extra,sheet);
}
const ALLIDS=GROUPS.flatMap(g=>g[1]);
function render(){
 const S=(qs.get('s')||location.hash.slice(1)||'chat-new'); const st=ALLIDS.includes(S)?S:'chat-new';
 const inner=screen(st);
 const href=(k,m)=>`?${m?'m=1&':''}${document.documentElement.dataset.theme?'theme='+document.documentElement.dataset.theme+'&':''}#${k}`;
 const picker=isShot?'':`<nav class="picker" aria-label="Prototype states">${GROUPS.map(([g,ks])=>`<b style="width:64px">${g}</b>${ks.map(k=>`<a class="${k===st?'cur':''}" href="${href(k,MOB)}">${k}</a>`).join('')}<span style="flex-basis:100%;height:0"></span>`).join('')}<b style="width:64px">View</b><a class="${MOB?'':'cur'}" href="${href(st,false)}">Desktop 1440×900</a><a class="${MOB?'cur':''}" href="${href(st,true)}">Mobile 390×844</a><a href="javascript:void 0" onclick="document.documentElement.dataset.theme='light';render()">Light</a><a href="javascript:void 0" onclick="document.documentElement.dataset.theme='dark';render()">Dark</a><span style="color:var(--chrome-fg);font-size:12px;margin-left:8px">State names match the F4.1 capture ids.</span></nav>`;
 document.getElementById('root').innerHTML=picker+`<div class="stage" id="stage">${inner}</div>`;fit();
}
