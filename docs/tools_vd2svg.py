"""Convert Android VectorDrawable XML -> SVG. Colors become currentColor so CSS can theme them."""
import os, re, sys, glob, json
import xml.etree.ElementTree as ET

A = '{http://schemas.android.com/apk/res/android}'

NAMED = {
    '@android:color/white': '#ffffff',
    '@android:color/black': '#000000',
}

def color(v, default=None):
    if v is None:
        return default
    v = v.strip()
    if v in NAMED:
        v = NAMED[v]
    if v.startswith('@') or v.startswith('?'):
        return default
    if v.startswith('#'):
        h = v[1:]
        if len(h) == 8:      # AARRGGBB
            a, rgb = h[:2], h[2:]
            if a.lower() == 'ff':
                return '#' + rgb
            return ('#' + rgb, int(a, 16) / 255.0)
        if len(h) == 4:      # ARGB
            a, rgb = h[0], h[1:]
            rgb = ''.join(c * 2 for c in rgb)
            if a.lower() == 'f':
                return '#' + rgb
            return ('#' + rgb, int(a * 2, 16) / 255.0)
        return v
    return default


def paint(el, attr, out, key, default=None):
    """Resolve a fill/stroke color into out[key] (+ opacity)."""
    c = color(el.get(A + attr), default)
    if c is None:
        return
    if isinstance(c, tuple):
        out[key] = c[0]
        out[key + '-opacity'] = f'{c[1]:.3f}'.rstrip('0').rstrip('.')
    else:
        out[key] = c


def num(el, attr, default=0.0):
    v = el.get(A + attr)
    if v is None:
        return default
    v = re.sub(r'(dip|dp|px|sp)$', '', v.strip())
    try:
        return float(v)
    except ValueError:
        return default


def group_transform(g):
    tx, ty = num(g, 'translateX'), num(g, 'translateY')
    sx, sy = num(g, 'scaleX', 1.0), num(g, 'scaleY', 1.0)
    rot = num(g, 'rotation')
    px, py = num(g, 'pivotX'), num(g, 'pivotY')
    parts = []
    if tx or ty:
        parts.append(f'translate({fmt(tx)},{fmt(ty)})')
    if rot:
        if px or py:
            parts.append(f'rotate({fmt(rot)},{fmt(px)},{fmt(py)})')
        else:
            parts.append(f'rotate({fmt(rot)})')
    if sx != 1.0 or sy != 1.0:
        if px or py:
            parts.append(f'translate({fmt(px)},{fmt(py)}) scale({fmt(sx)},{fmt(sy)}) translate({fmt(-px)},{fmt(-py)})')
        else:
            parts.append(f'scale({fmt(sx)},{fmt(sy)})')
    return ' '.join(parts)


def fmt(f):
    s = f'{f:.4f}'.rstrip('0').rstrip('.')
    return s if s not in ('', '-0') else '0'


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;'))


def convert_path(p, mono):
    d = p.get(A + 'pathData')
    if not d:
        return ''
    attrs = {'d': d}
    fill = {}
    paint(p, 'fillColor', fill, 'fill')
    stroke = {}
    paint(p, 'strokeColor', stroke, 'stroke')
    sw = num(p, 'strokeWidth')

    if mono:
        # Single-color icon: drive everything from CSS `color`.
        if fill:
            fill['fill'] = 'currentColor'
        if stroke:
            stroke['stroke'] = 'currentColor'

    if not fill and not stroke:
        attrs['fill'] = 'currentColor' if mono else '#000000'
    attrs.update(fill)
    if stroke:
        attrs.update(stroke)
        attrs['stroke-width'] = fmt(sw or 1.0)
        cap = p.get(A + 'strokeLineCap')
        join = p.get(A + 'strokeLineJoin')
        miter = num(p, 'strokeMiterLimit')
        if cap:
            attrs['stroke-linecap'] = cap
        if join:
            attrs['stroke-linejoin'] = join
        if miter:
            attrs['stroke-miterlimit'] = fmt(miter)
    if not fill:
        attrs.setdefault('fill', 'none')

    ft = p.get(A + 'fillType')
    if ft and ft.lower() == 'evenodd':
        attrs['fill-rule'] = 'evenodd'
        attrs['clip-rule'] = 'evenodd'
    alpha = p.get(A + 'fillAlpha')
    if alpha:
        try:
            a = float(alpha)
            if a != 1.0:
                attrs['fill-opacity'] = fmt(a)
        except ValueError:
            pass
    return '<path ' + ' '.join(f'{k}="{esc(str(v))}"' for k, v in attrs.items()) + '/>'


def walk(node, mono, depth=1):
    out = []
    pad = '  ' * depth
    for child in node:
        tag = child.tag.split('}')[-1]
        if tag == 'path':
            s = convert_path(child, mono)
            if s:
                out.append(pad + s)
        elif tag == 'group':
            inner = walk(child, mono, depth + 1)
            if not inner:
                continue
            t = group_transform(child)
            if t:
                out.append(f'{pad}<g transform="{t}">')
                out.extend(inner)
                out.append(pad + '</g>')
            else:
                out.extend(inner)
        elif tag == 'clip-path':
            continue
    return out


def is_mono(root):
    """True when every painted color in the icon is the same -> safe to use currentColor."""
    seen = set()
    for p in root.iter():
        if p.tag.split('}')[-1] != 'path':
            continue
        for attr in ('fillColor', 'strokeColor'):
            c = color(p.get(A + attr))
            if c is not None:
                seen.add(c if isinstance(c, str) else c[0])
    return len(seen) <= 1


def convert(path):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return None
    if root.tag.split('}')[-1] != 'vector':
        return None
    vw = num(root, 'viewportWidth', 24.0)
    vh = num(root, 'viewportHeight', 24.0)
    mono = is_mono(root)
    body = walk(root, mono)
    if not body:
        return None
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(vw)} {fmt(vh)}" '
            f'width="100%" height="100%" fill="none">\n' + '\n'.join(body) + '\n</svg>\n')


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    made, skipped = [], []
    for f in sorted(glob.glob(os.path.join(src, '*.xml'))):
        name = os.path.splitext(os.path.basename(f))[0]
        svg = convert(f)
        if svg is None:
            skipped.append(name)
            continue
        with open(os.path.join(dst, name + '.svg'), 'w', encoding='utf-8') as fh:
            fh.write(svg)
        made.append(name)
    print(f'converted {len(made)} skipped {len(skipped)}')
    print('skipped:', ', '.join(skipped))
    return made


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
