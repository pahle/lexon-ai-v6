import base64,sys
d=sys.argv[1]
b=lambda f,m: 'data:%s;base64,%s'%(m,base64.b64encode(open(d+'/'+f,'rb').read()).decode())
s=open(d+'/proto.src.html').read()
for k,f,m in [('__FONT_INTER__','Inter-latin-wght.woff2','font/woff2'),('__FONT_GARAMOND__','EBGaramond-latin-wght.woff2','font/woff2'),('__FONT_GARAMOND_IT__','EBGaramond-Italic-latin-wght.woff2','font/woff2'),('__FONT_BONUM__','TeXGyreBonum-Regular-latin.woff2','font/woff2'),('__FONT_BONUM_B__','TeXGyreBonum-Bold-latin.woff2','font/woff2'),('__MONO__','LEXON-monogram-micro-seal.svg','image/svg+xml'),('__WM_INK__','LEXON-wordmark-compact-ink.svg','image/svg+xml'),('__WM_WHITE__','LEXON-wordmark-compact-white.svg','image/svg+xml')]:
    s=s.replace(k,b(f,m))
open(d+'/lexon-v41-prototype.html','w').write(s)
open(d+'/shot.html','w').write('<!doctype html><html><head><meta charset="utf-8"></head><body>'+s+'</body></html>')
