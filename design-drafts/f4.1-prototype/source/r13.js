/* ===== Revision 13 (owner review round 4): page patterns for every remaining screen ===== */
Object.assign(I,{
 mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
 lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 linkoff:'<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><path d="M8 12h4"/><path d="m2 2 20 20"/>',
 back:'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
 monitor:'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
 phone:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
 users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 compass:'<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
 key:'<path d="M2.6 18.4A2 2 0 0 0 2 19.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5"/>'
});
const MOB=qs.get('m')==='1';
const isDark=()=>document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);
const wm=()=>`<img src="${isDark()?WM_WHITE:WM_INK}" alt="Lexon" style="width:128px">`;
const backLink=(t='Back to sign in')=>`<a class="slink" href="#">${sv('back',16)}${t}</a>`;
const head=(title,text,icon)=>`<div class="ahead">${icon?`<span class="aicon">${sv(icon,22)}</span>`:''}<h1>${title}</h1>${text?`<p>${text}</p>`:''}</div>`;
const fld=(id,label,{value='',ph='',type='text',hint='',aside='',eye=false,ro=false}={})=>`<div class="field"><label for="${id}">${label}${aside}</label><div style="position:relative"><input id="${id}" class="inp lg" type="${type}" value="${value}" placeholder="${ph}" ${ro?'readonly':''}>${eye?`<button class="ib" style="position:absolute;right:6px;top:6px" aria-label="Show password">${sv('eye')}</button>`:''}</div>${hint?`<span class="fhint">${hint}</span>`:''}</div>`;
// Shared auth frame: one wordmark (form column), form block centered at the same position on every page, Night cover with the statement only.
function authFrame(body){
 if(MOB) return `<div class="authm">${wm()}<div class="ablock">${body}</div></div>`;
 return `<div class="auth"><div class="side">${wm()}<div class="formwrap"><div class="ablock">${body}</div></div><div style="height:44px"></div></div>
 <div class="cover"><div class="rule">The AI workspace for Indonesian legal practitioners</div><div class="quote">Read, draft, and check Indonesian law in one quiet workspace.</div><div style="display:flex;justify-content:flex-end"><small>lexon-ai.com</small></div></div></div>`;
}
function authState(S){
 const email='ayu@hukum-nusantara.co.id';
 switch(S){
 case 'signin': case 'signin-errors': {const bad=S==='signin-errors';
  return authFrame(`${head('Sign in to Lexon','Enter your work email and password.')}
  <div class="field"><label for="em">Email</label><input id="em" class="inp lg ${bad?'bad':''}" value="${bad?'ayu@':''}" placeholder="you@firm.co.id">${bad?'<span class="ferr">Enter a valid email address.</span>':''}</div>
  <div class="field"><label for="pw">Password <a href="#">Forgot password?</a></label><div style="position:relative"><input id="pw" type="password" class="inp lg ${bad?'bad':''}" placeholder="••••••••"><button class="ib" style="position:absolute;right:6px;top:6px" aria-label="Show password">${sv('eye')}</button></div>${bad?'<span class="ferr">Enter your password.</span>':''}</div>
  <button class="btn primary lg full">Sign in</button><p class="alt">New to Lexon? <a href="#">Create an account</a></p>`);}
 case 'signup': return authFrame(`${head('Create your account','Your legal workspace starts here.')}${fld('nm','Full name',{ph:'Ayu Wardani'})}${fld('em','Work email',{ph:'you@firm.co.id'})}${fld('pw','Password',{type:'password',ph:'••••••••',eye:true,hint:'Use at least 12 characters.'})}<button class="btn primary lg full">Create account</button><p class="alt">Already have an account? <a href="#">Sign in</a></p>`);
 case 'forgot': return authFrame(`${head('Reset your password','Enter the email you use for Lexon and we will send you a link to reset your password.')}${fld('em','Email',{ph:'you@firm.co.id'})}<button class="btn primary lg full">Send reset link</button>${backLink()}`);
 case 'forgot-sent': return authFrame(`${head('Check your email',`If an account exists for <b>${email}</b>, we sent a link to reset your password. The link expires in 30 minutes.`,'mail')}<button class="btn outline lg full">Resend link</button>${backLink()}`);
 case 'reset': return authFrame(`${head('Choose a new password','Use at least 12 characters. You will be signed out on your other devices.')}${fld('pw','New password',{type:'password',ph:'••••••••',eye:true})}${fld('pw2','Confirm new password',{type:'password',ph:'••••••••',eye:true})}<button class="btn primary lg full">Update password</button>${backLink()}`);
 case 'reset-invalid': return authFrame(`${head('This link has expired','Reset links work once and expire after 30 minutes. Request a new link to continue.','linkoff')}<button class="btn primary lg full">Request a new link</button>${backLink()}`);
 case 'verify': return authFrame(`${head('Verify your email',`We sent a verification link to <b>${email}</b>. Open it to activate your account.`,'mail')}<button class="btn outline lg full">Resend email</button><p class="alt">Wrong email? <a href="#">Create the account again</a></p>${backLink()}`);
 case 'twofactor': return authFrame(`${head('Two-step verification','Enter the 6-digit code from your authenticator app.','shield')}<div class="field"><label for="otp">Authentication code</label><div class="otp" id="otp">${[4,8,1,'','',''].map((d,i)=>`<span class="slot ${i===3?'cur':''}">${d}</span>`).join('')}</div></div><button class="btn primary lg full">Verify</button><div class="links"><a class="slink" href="#">${sv('key',16)}Use a recovery code</a>${backLink()}</div>`);
 case 'invite': return authFrame(`${head('Join Hukum Nusantara','Rizky Pratama invited you to work together in Lexon.')}<div class="icard"><div style="display:flex;gap:12px;align-items:center"><span class="ini" style="width:40px;height:40px;border-radius:10px">HN</span><div class="two"><span class="a">Hukum Nusantara</span><span class="b">12 members</span></div></div><div class="idl"><span>Your role</span><b>Member</b><span>Invited by</span><b>Rizky Pratama</b><span>Expires</span><b>21 Nov 2026</b></div></div><button class="btn primary lg full">Accept invitation</button><button class="btn outline lg full">Decline</button><p class="alt">Signed in as ${email}. <a href="#">Not you?</a></p>`);
 case 'invite-invalid': return authFrame(`${head('Invitation unavailable','This invitation was cancelled, has expired, or has already been used. Ask the person who invited you to send a new one.','linkoff')}<button class="btn primary lg full">Go to Lexon</button>${backLink()}`);
 case 'setup': return authFrame(`${head('Set up the first administrator','Create the platform administrator account for this Lexon deployment. This link works once.')}${fld('nm','Full name',{ph:'Dimas Prasetyo'})}${fld('em','Email',{value:'admin@hukum-nusantara.co.id',ro:true,hint:'Set by the setup link.'})}${fld('pw','Password',{type:'password',ph:'••••••••',eye:true,hint:'Use at least 12 characters.'})}<button class="btn primary lg full">Create administrator</button>`);
 case 'setup-invalid': return authFrame(`${head('Setup link unavailable','This setup link has expired or has already been used. Ask your operator for a new link.','linkoff')}<button class="btn primary lg full">Go to sign in</button>`);
 case 'onboard-1': return authFrame(`<div class="steps"><span class="on"></span><span></span><em>Step 1 of 2</em></div>${head('Welcome to Lexon','Tell your colleagues who you are. You can change this later in Settings.')}${fld('nm','Display name',{value:'Ayu Wardani'})}${fld('jt','Job title',{ph:'Senior Associate',aside:'<span class="opt">Optional</span>',hint:'Shown under your name in the sidebar.'})}<button class="btn primary lg full">Continue</button>`);
 case 'onboard-2': return authFrame(`<div class="steps"><span class="on"></span><span class="on"></span><em>Step 2 of 2</em></div>${head('You have an invitation','Join your team now, or keep working in your personal workspace.')}<div class="icard row"><span class="ini" style="width:40px;height:40px;border-radius:10px">HN</span><div class="two"><span class="a">Hukum Nusantara</span><span class="b">Member · invited by Rizky Pratama</span></div><button class="btn primary">Join</button></div><button class="btn outline lg full">Continue to my workspace</button><p class="alt">You can accept invitations later from the organization switcher.</p>`);
 }
}
// Shared status pattern: centered icon, serif title, one sentence, primary action, secondary link. Never a full-width button.
const status=({icon,title,text,primary,secondary})=>`<div class="status"><span class="sicon">${sv(icon,24)}</span><h1>${title}</h1><p>${text}</p><div class="sact">${primary?`<button class="btn primary lg">${primary}</button>`:''}${secondary?`<a class="slink" href="#">${secondary}</a>`:''}</div></div>`;
const STATUS={
 'notfound':{icon:'compass',title:'Page not found',text:'The page you are looking for does not exist or has moved.',primary:'Go to Lexon'},
 'org-notfound':{icon:'users',title:'Workspace not found',text:'This organization does not exist, or you are no longer a member.',primary:'Go to my workspace'},
 'ws-error':{icon:'alert',title:'Something went wrong',text:'We could not load this page. Your work is saved.',primary:'Try again',secondary:'Go to my workspace'},
 'noaccess':{icon:'lock',title:'You do not have access',text:'This page is available to platform administrators only.',primary:'Go to my workspace'}
};
function statusPage(S){
 if(S==='notfound') return `<div class="${MOB?'app mobile':'app'} plain" style="flex-direction:column"><div style="padding:${MOB?'24px':'40px'}">${wm()}</div><div class="view" style="justify-content:center;padding-bottom:120px">${status(STATUS[S])}</div></div>`;
 const main=`<div class="main">${topbar('')}<div class="view" style="justify-content:center;padding-bottom:120px">${status(STATUS[S])}</div></div>`;
 return MOB?`<div class="app mobile">${main}</div>`:`<div class="app">${sidebar('x',{active:null})}${main}</div>`;
}
function historyLoading(){
 const rows=[0,1,2,3,4,5].map(i=>`<div class="hrow"><div class="ht"><div class="skel" style="width:${[62,48,70,55,40,66][i]}%"></div><div class="skel" style="width:52px"></div></div></div>`).join('');
 return `<div class="main">${topbar('')}<div class="view"><div class="hist"><div style="display:flex;justify-content:space-between;align-items:flex-end"><h1 class="ptitle">Chats</h1><button class="btn primary">${sv('plus')}New chat</button></div><div style="position:relative"><span style="position:absolute;left:12px;top:10px;color:var(--mfg)">${sv('search')}</span><input class="inp" style="padding-left:36px" aria-label="Search chats" placeholder="Search chats"></div><div class="glabel" style="padding:10px 12px 0"><div class="skel" style="width:56px"></div></div>${rows}</div></div></div>`;
}
function settingsExtra(S){
 const nav=[['Account'],['Profile'],['Appearance'],['Security',S==='security'],['Hukum Nusantara'],['Members',S==='members'],['Invitations'],['General']].map(([t,on])=>on===undefined&&!['Profile','Appearance','Security','Members','Invitations','General'].includes(t)?`<div class="glabel" style="padding:12px 8px 4px">${t}</div>`:`<button class="nb ${on?'on':''}">${t}</button>`).join('');
 const sess=[['monitor','Chrome on macOS','Jakarta, Indonesia · Active now',true],['phone','Safari on iPhone','Jakarta, Indonesia · Signed in 3 days ago',false],['monitor','Edge on Windows','Surabaya, Indonesia · Signed in 9 days ago',false]];
 const secBody=`<h3 class="sh">Security</h3><p class="sd">Manage how you sign in and where you are signed in.</p><div class="srow"><div><div class="rt">Password</div><div class="rd">Last changed 2 months ago.</div></div><button class="btn outline">Change password</button></div><div class="srow"><div><div class="rt">Two-step verification <span class="badge">On</span></div><div class="rd">Authenticator app. 8 recovery codes left.</div></div><button class="btn outline">Manage</button></div><div style="padding:20px 0 8px;font-weight:600">Where you are signed in</div>${sess.map(([ic,d,m,cur])=>`<div class="srow"><div style="display:flex;gap:12px;align-items:center"><span class="dev">${sv(ic,18)}</span><div><div class="rt">${d}${cur?' <span class="badge">This device</span>':''}</div><div class="rd">${m}</div></div></div>${cur?'':'<button class="btn outline">Sign out</button>'}</div>`).join('')}`;
 const mem=[['MC','Maya Chen (you)','maya.chen@hukum-nusantara.co.id','Owner'],['JL','Jordan Lee','jordan.lee@hukum-nusantara.co.id','Admin'],['AR','Alex Rivera','alex.rivera@hukum-nusantara.co.id','Member']];
 const memBody=`<div style="display:flex;justify-content:space-between;align-items:center"><h3 class="sh" style="margin:0">Members</h3><button class="btn primary">${sv('plus')}Invite people</button></div><p class="sd">3 members in Hukum Nusantara.</p>${mem.map(([i,n,e,r],k)=>`<div class="mrow"><span class="avatar">${i}</span><div class="two"><span class="a">${n}</span><span class="b">${e}</span></div>${k===0?`<span class="badge">${r}</span>`:`<button class="btn outline sm">${r}${sv('down2',14)}</button><button class="ib" aria-label="More actions for ${n}">${sv('dots')}</button>`}</div>`).join('')}`;
 const body=S==='security'?secBody:memBody;
 if(MOB) return `<div class="app mobile"><div class="sdlg m" role="dialog" aria-modal="true" aria-label="Settings"><div class="shd"><button class="ib" aria-label="Back to sections">${sv('left')}</button><h2>${S==='security'?'Security':'Members'}</h2><button class="ib" aria-label="Close settings">${sv('x')}</button></div><div class="sbody">${body}</div></div></div>`;
 return `<div class="app">${sidebar('x',{active:'a'})}${thread('thread')}<div class="overlay"></div><div class="sdlg" role="dialog" aria-modal="true" aria-label="Settings"><div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 24px;border-bottom:1px solid var(--border)"><h2 style="margin:0;font-size:16px;font-weight:600">Settings</h2><button class="ib" aria-label="Close settings">${sv('x')}</button></div><div style="flex:1;display:flex;min-height:0"><nav style="width:240px;flex:none;padding:12px;border-right:1px solid var(--sb-border);background:var(--sidebar);display:flex;flex-direction:column;gap:2px">${nav}</nav><div class="sbody">${body}</div></div></div></div>`;
}
const AUTH_STATES=['signin','signin-errors','signup','forgot','forgot-sent','reset','reset-invalid','verify','twofactor','invite','invite-invalid','setup','setup-invalid','onboard-1','onboard-2'];
const STATUS_STATES=['notfound','org-notfound','ws-error','noaccess'];
const R13_STATES=[...AUTH_STATES,...STATUS_STATES,'history-loading','security','members'];
