import sys, os
SP='/tmp/claude-0/-home-user-lexon-ai-v6/4f27ae7e-1789-58ca-acd8-2d3aa77ee090/scratchpad'
CAP='<path d="M0 0 H340 V37 C288.6 40 270.1 55 246.0 116 H94.0 C69.9 55 51.4 40 0 37 Z"/>'
FOOT='<path d="M0 746 C51.4 743 69.9 728 94.0 667 H246.0 C264.0 700 312.0 732 366.0 746 C441.0 750 520.1 689.6 565.1 636.0 L598.0 663.6 L600 783 H0 Z"/>'
PIL={'micro':'<path d="M104 137 H236 V646 H104 Z"/>',
     'small':'<path d="M104 137 H138 V646 H104 Z"/><path d="M153 137 H187 V646 H153 Z"/><path d="M202 137 H236 V646 H202 Z"/>',
     'full':'<path d="M104 137 H138 V646 H104 Z"/><path d="M153 137 H187 V646 H153 Z"/><path d="M202 137 H236 V646 H202 Z"/>'}
OX,OY=261.0,391.5
CUR={'tile':{'full':.46,'small':.5,'micro':.54},'square':{'full':.46,'small':.5,'micro':.54},'circle':{'full':.4,'small':.42,'micro':.44}}
# proposed: tile/square L height 58/62/66 %; circle max radius 72/76/80 %
def hs(p): return round(p*512/783,4)
def cs(p): return round(p*256/518,4)
NEW={'tile':{'full':hs(.58),'small':hs(.62),'micro':hs(.66)},'square':{'full':hs(.58),'small':hs(.62),'micro':hs(.66)},'circle':{'full':cs(.72),'small':cs(.76),'micro':cs(.80)}}
TONES={'seal':('#7A1F2E','#F6EFE2'),'ink':('#1F1717','#F6EFE2'),'midnight':('#2A1519','#F6EFE2'),'parchment':('#F6EFE2','#7A1F2E')}
def shape(kind,bg,stroke=''):
    if kind=='circle': return f'<circle cx="256" cy="256" r="256" fill="{bg}"{stroke}/>'
    rx=' rx="96"' if kind=='tile' else ''
    return f'<rect x="0" y="0" width="512" height="512"{rx} fill="{bg}"{stroke}/>'
def svg(kind,tier,tone,s,inline=False,px=None,label=''):
    bg,fg=TONES[tone]
    stroke=' stroke="#D8C9AD" stroke-width="8"' if tone=='parchment' else ''
    tx,ty=round(256-OX*s,2),round(256-OY*s,2)
    size=f' width="{px}" height="{px}"' if px else ' width="512" height="512"'
    head='' if inline else '<?xml version="1.0" encoding="UTF-8"?>\n'
    t='' if inline else f'<title id="logo-title">Lexon mark ({kind}, {tone})</title>'
    a=f' role="img" aria-label="{label}"' if inline else ' role="img" aria-labelledby="logo-title"'
    return f'{head}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"{size}{a}>{t}\n{shape(kind,bg,stroke)}<g transform="translate({tx} {ty}) scale({s})" fill="{fg}">{CAP}{PIL[tier]}{FOOT}</g>\n</svg>\n'
def tier_for(px): return 'micro' if px<40 else 'small' if px<64 else 'full'
if sys.argv[1]=='files':
    out=os.path.join(SP,'marks-proposed'); os.makedirs(out,exist_ok=True)
    for kind in NEW:
        for tone in TONES:
            for tier,suf in (('full',''),('small','-small'),('micro','-micro')):
                open(os.path.join(out,f'LEXON-mark-{kind}-{tone}{suf}.svg'),'w').write(svg(kind,tier,tone,NEW[kind][tier]))
    print(NEW)
else:
    rows=[]
    for kind in ('tile','square','circle'):
        for label,table in (('Current',CUR),('Proposed',NEW)):
            cells=''.join(f'<div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 140px;">{svg(kind,tier_for(px),"seal",table[kind][tier_for(px)],True,px,f"{label} {kind} {px}px")}<span style="font-size: 12px; color: #5E5248;">{px}px</span></div>' for px in (16,24,32,48,96,128))
            rows.append(f'<div style="display: flex; align-items: center; gap: 24px;"><div style="width: 180px; font-size: 14px;"><b style="text-transform: capitalize;">{kind}</b><br><span style="color: #5E5248;">{label}</span></div>{cells}</div>')
    body='\n'.join(rows)
    print(f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lexon marks: current vs proposed</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;display=swap">
<style>body{{margin:0}}</style>
</helmet>
<div style="width: 1440px; height: 1100px; box-sizing: border-box; padding: 48px 64px; background: #F6EFE2; color: #1F1717; font-family: Inter, system-ui, sans-serif; display: flex; flex-direction: column; gap: 28px;">
<div><h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px;">Marks: current vs proposed</h1>
<p style="margin: 6px 0 0; color: #5E5248; font-size: 14px;">Same L, same optical center and tiers. Proposed L height: tile and square 58 / 62 / 66% (full / small / micro, was 71 / 77 / 83%); circle farthest point 72 / 76 / 80% of the radius (was 81 / 85 / 89%).</p></div>
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1100}}}}'>
class Component extends DCLogic {{ renderVals() {{ return {{}}; }} }}
</script>
</body>
</html>''')
