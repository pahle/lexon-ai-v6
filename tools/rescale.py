import re, sys, os, glob
root=sys.argv[1]
S={'square':{'full':.3793,'small':.4054,'micro':.4316},'tile':{'full':.3793,'small':.4054,'micro':.4316},'circle':{'full':.3558,'small':.3756,'micro':.3954}}
def tf(s): return f'transform="translate({256-261*s:.2f} {256-391.5*s:.2f}) scale({s:g})"'
def kind_tier(name):
    if name.startswith('favicon'): return 'tile','micro'
    if name.startswith('lexon-app-'): return 'square','full'
    if name.startswith('lexon-tile-'): return 'tile','full'
    m=re.match(r'LEXON-mark-(circle|square|tile)-[a-z]+(-small|-micro)?\.svg',name)
    if not m: return None
    return m.group(1),(m.group(2) or '-full')[1:]
files=glob.glob(f'{root}/01_VECTOR/marks/*.svg')+glob.glob(f'{root}/07_DEVELOPER_HANDOFF/public/LEXON-mark-*.svg')+[f'{root}/03_APP_ICONS/favicon.svg',f'{root}/07_DEVELOPER_HANDOFF/public/favicon.svg']+glob.glob(f'{root}/03_APP_ICONS/lexon-*.svg')
n=0
for f in files:
    kt=kind_tier(os.path.basename(f)); assert kt, f
    t=open(f).read()
    new,c=re.subn(r'transform="translate\([^)]*\) scale\([^)]*\)"',tf(S[kt[0]][kt[1]]),t)
    assert c==1,f
    open(f,'w').write(new); n+=1
print('rewrote',n)
