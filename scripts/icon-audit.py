"""Audit every inline SVG in the app for the pixel-alignment defects that make
icons look blurry.

A stroke renders crisply only when its edges land on whole device pixels:
  edge = (coord ± strokeWidth/2) * (renderSize / viewBoxSize) * dpr
We check axis-aligned strokes (h/v lines, rect edges) at dpr 1 and 2.
"""
import re, glob, os, sys
from fractions import Fraction as F

SVG_RE = re.compile(r'<svg\b[^>]*>(.*?)</svg>', re.S)
ATTR   = lambda tag, name: (re.search(rf'{name}=(?:"([^"]*)"|\{{([^}}]*)\}})', tag) or [None])

def attr(tag, name):
    m = re.search(rf'\b{name}=(?:"([^"]*)"|\{{\s*([^}}]*?)\s*\}})', tag)
    if not m: return None
    return m.group(1) if m.group(1) is not None else m.group(2)

def num(v):
    if v is None: return None
    v = v.strip().strip('"\'')
    try: return F(v)
    except Exception: return None

def crisp(center, sw, scale):
    """True if both stroke edges land on integer device pixels."""
    for dpr in (1, 2):
        lo = (center - sw/2) * scale * dpr
        hi = (center + sw/2) * scale * dpr
        if lo.denominator != 1 or hi.denominator != 1:
            return False
    return True

findings = []
for path in sorted(glob.glob('src/components/*.tsx')) + sorted(glob.glob('src/**/*.tsx', recursive=True)):
    if not os.path.exists(path): continue
    src = open(path, encoding='utf-8').read()
    for m in SVG_RE.finditer(src):
        whole = m.group(0)
        head  = whole[:whole.index('>')+1]
        body  = m.group(1)
        line  = src[:m.start()].count('\n') + 1

        vb = attr(head, 'viewBox')
        w  = num(attr(head, 'width'))
        sw_default = num(attr(head, 'strokeWidth')) or num(attr(head, 'stroke-width')) or F(1)
        if not vb or w is None: continue
        parts = vb.replace(',', ' ').split()
        if len(parts) != 4: continue
        try: vbw = F(parts[2])
        except Exception: continue
        if vbw == 0: continue
        scale = w / vbw

        # 1) fractional units-per-pixel makes every coordinate land mid-pixel
        if scale.denominator not in (1,) and (scale * 2).denominator != 1:
            findings.append((path, line, 'FRACTIONAL_SCALE',
                             f'{w}px render of a {vbw}-unit viewBox = {float(scale):.3f} px/unit'))

        # 2) axis-aligned strokes that don't land on whole pixels
        bad = []
        for lm in re.finditer(r'<line\b[^>]*>', body):
            t = lm.group(0)
            x1,y1,x2,y2 = (num(attr(t,a)) for a in ('x1','y1','x2','y2'))
            sw = num(attr(t,'strokeWidth')) or num(attr(t,'stroke-width')) or sw_default
            if None in (x1,y1,x2,y2): continue
            if y1 == y2 and not crisp(y1, sw, scale): bad.append(f'h-line y={y1} sw={sw}')
            if x1 == x2 and not crisp(x1, sw, scale): bad.append(f'v-line x={x1} sw={sw}')
        for rm in re.finditer(r'<rect\b[^>]*>', body):
            t = rm.group(0)
            if 'stroke="none"' in t or 'fill="currentColor"' in t and 'stroke' not in t: continue
            x,y,rw,rh = (num(attr(t,a)) for a in ('x','y','width','height'))
            sw = num(attr(t,'strokeWidth')) or num(attr(t,'stroke-width')) or sw_default
            if None in (x,y,rw,rh): continue
            for c,lbl in ((x,'left'),(x+rw,'right'),(y,'top'),(y+rh,'bottom')):
                if not crisp(c, sw, scale): bad.append(f'rect {lbl}={c} sw={sw}')
        # simple h/v path commands: M x y h N  /  M x y v N
        for pm in re.finditer(r'<path\b[^>]*\bd="([^"]+)"[^>]*>', body):
            t = pm.group(0); d = pm.group(1)
            if 'stroke="none"' in t: continue
            sw = num(attr(t,'strokeWidth')) or num(attr(t,'stroke-width')) or sw_default
            for cm in re.finditer(r'M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*([hv])\s*(-?[\d.]+)', d):
                cx, cy, cmd, _ = num(cm.group(1)), num(cm.group(2)), cm.group(3), cm.group(4)
                if cx is None or cy is None: continue
                c = cy if cmd == 'h' else cx
                if not crisp(c, sw, scale):
                    bad.append(f'path {"h" if cmd=="h" else "v"}-run @{c} sw={sw}')
        if bad:
            uniq = sorted(set(bad))
            findings.append((path, line, 'BLURRY_STROKE', f'{w}px/{vbw}vb — ' + '; '.join(uniq[:4]) + (f' (+{len(uniq)-4} more)' if len(uniq)>4 else '')))

seen = set(); out = []
for f in findings:
    k = (f[0], f[1], f[2])
    if k in seen: continue
    seen.add(k); out.append(f)

by_kind = {}
for path, line, kind, detail in out:
    by_kind.setdefault(kind, []).append((path, line, detail))

for kind in ('FRACTIONAL_SCALE', 'BLURRY_STROKE'):
    items = by_kind.get(kind, [])
    print(f'\n=== {kind}: {len(items)} ===')
    for path, line, detail in items:
        print(f'  {path}:{line}  {detail}')
print(f'\nTOTAL: {len(out)} issues across {len(set(p for p,_,_,_ in out))} files')
