#!/usr/bin/env python3
"""Generates the XMP brand assets (mark + lockups) and the raster icons.

The mark is drawn from geometry so it stays crisp at every size:
two mirrored parallelograms with vertical caps, a faceted overlap and a
warm ember gradient. Run `python3 scripts/build-brand-assets.py`.
"""

import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BRAND = os.path.join(ROOT, "assets", "branding")
BUILD = os.path.join(ROOT, "build")
SRC_ASSETS = os.path.join(ROOT, "src", "assets")

# --- geometry (1024 grid) -------------------------------------------------
CX, CY = 512, 500
DX, DY = 252, 196           # arm reach from centre
H_TOP, H_BOT = 74, 86       # vertical half-thickness, top / bottom caps
FONT = "Sora"


def para(sx, sy, ex, ey):
    """Parallelogram from (sx,sy) to (ex,ey) with vertical caps."""
    return (
        f"M{sx} {sy - H_TOP} L{ex} {ey - H_TOP} L{ex} {ey + H_BOT} "
        f"L{sx} {sy + H_BOT} Z"
    )


FWD = para(CX - DX, CY + DY, CX + DX, CY - DY)      # rising stroke  "/"
BACK = para(CX + DX, CY + DY, CX - DX, CY - DY)     # falling stroke "\"


def mark_svg(size=1024, plate=True, glow=True, wordmark=False, padding=0.084):
    """Full app mark. `padding` is the plate inset as a fraction of size."""
    s = size / 1024.0
    p = size * padding
    plate_w = size - 2 * p
    radius = size * (196 / 1024)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
             f'viewBox="0 0 1024 1024">']
    parts.append("""<defs>
    <linearGradient id="body" x1="96" y1="80" x2="928" y2="944" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#232C3D"/><stop offset="0.46" stop-color="#121822"/>
      <stop offset="1" stop-color="#070A10"/>
    </linearGradient>
    <linearGradient id="rim" x1="120" y1="120" x2="904" y2="904" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B7C0D2" stop-opacity="0.55"/>
      <stop offset="0.32" stop-color="#2A3140" stop-opacity="0.35"/>
      <stop offset="0.68" stop-color="#3B4455" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#8F9AB0" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="ember" x1="250" y1="230" x2="790" y2="790" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFB259"/><stop offset="0.34" stop-color="#FF7A2F"/>
      <stop offset="0.72" stop-color="#F8412F"/><stop offset="1" stop-color="#A91238"/>
    </linearGradient>
    <linearGradient id="emberFlat" x1="250" y1="230" x2="790" y2="790" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FF9C45"/><stop offset="1" stop-color="#D92540"/>
    </linearGradient>
    <linearGradient id="gloss" x1="180" y1="90" x2="680" y2="560" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="halo" cx="512" cy="520" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FF6A2C" stop-opacity="0.22"/>
      <stop offset="0.6" stop-color="#FF3B2F" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#FF3B2F" stop-opacity="0"/>
    </radialGradient>
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="22" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
    <filter id="soften" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
    </defs>""")
    if glow:
        parts.append(f'<rect width="1024" height="1024" fill="url(#halo)"/>')
    if plate:
        parts.append(
            f'<rect x="{p/s:.2f}" y="{p/s:.2f}" width="{plate_w/s:.2f}" '
            f'height="{plate_w/s:.2f}" rx="{radius/s:.2f}" fill="url(#body)" filter="url(#lift)"/>'
            f'<rect x="{p/s:.2f}" y="{p/s:.2f}" width="{plate_w/s:.2f}" '
            f'height="{plate_w/s:.2f}" rx="{radius/s:.2f}" fill="url(#gloss)"/>'
            f'<rect x="{(p+3)/s:.2f}" y="{(p+3)/s:.2f}" width="{(plate_w-6)/s:.2f}" '
            f'height="{(plate_w-6)/s:.2f}" rx="{(radius-3)/s:.2f}" fill="none" '
            f'stroke="url(#rim)" stroke-width="{3.4/s:.2f}"/>'
        )
    # ember bloom under the glyph
    parts.append(f'<g filter="url(#soften)" opacity="0.62">'
                 f'<path d="{FWD}" fill="#FF6A2C"/><path d="{BACK}" fill="#FF4D2D"/></g>')
    parts.append(f'<path d="{FWD}" fill="url(#ember)"/>')
    parts.append(f'<path d="{BACK}" fill="url(#emberFlat)"/>')
    # faceted overlap
    parts.append('<path d="M512 500 L624 371 L668 420 L556 549 Z" fill="#240910" opacity="0.20"/>')
    parts.append('<path d="M512 500 L400 629 L356 580 L468 451 Z" fill="#FFFFFF" opacity="0.05"/>')
    if wordmark:
        parts.append(
            f'<text x="512" y="872" text-anchor="middle" font-family="{FONT}, DejaVu Sans, sans-serif" '
            'font-weight="800" font-size="132" letter-spacing="14" fill="#F2F4F8">XMP</text>'
            '<rect x="356" y="906" width="312" height="7" rx="3.5" fill="url(#ember)"/>'
        )
    parts.append("</svg>")
    return "\n".join(parts)


def wordmark_svg(height=140):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{int(height*3.6)}" height="{height}" viewBox="0 0 504 140">
  <defs><linearGradient id="e" x1="0" y1="0" x2="504" y2="140" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFB259"/><stop offset="0.5" stop-color="#FF7A2F"/>
    <stop offset="1" stop-color="#D92540"/></linearGradient></defs>
  <text x="0" y="104" font-family="{FONT}, DejaVu Sans, sans-serif" font-weight="800"
        font-size="118" letter-spacing="12" fill="#F2F4F8">XMP</text>
  <text x="298" y="104" font-family="{FONT}, DejaVu Sans, sans-serif" font-weight="500"
        font-size="34" letter-spacing="7" fill="#8A94A6">LAUNCHER</text>
</svg>'''


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(data)
    print("wrote", os.path.relpath(path, ROOT))


def png(svg_text, out, size):
    import cairosvg

    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=out,
                     output_width=size, output_height=size)
    print("raster", os.path.relpath(out, ROOT), size)


def main():
    write(os.path.join(BRAND, "logo-mark.svg"), mark_svg(wordmark=True))
    write(os.path.join(BRAND, "logo-glyph.svg"), mark_svg(plate=False, glow=False, size=1024))
    write(os.path.join(BRAND, "wordmark.svg"), wordmark_svg())

    sizes = [16, 24, 32, 48, 64, 128, 256]
    tmp = os.path.join(BUILD, "tmp")
    os.makedirs(tmp, exist_ok=True)
    for s in sizes:
        png(mark_svg(size=1024), os.path.join(tmp, f"icon-{s}.png"), s)
    png(mark_svg(size=1024), os.path.join(BUILD, "icon-512.png"), 512)
    png(mark_svg(size=1024), os.path.join(SRC_ASSETS, "logo-256.png"), 256)

    # windows .ico (multi-size)
    subprocess.run(
        ["convert", *[os.path.join(tmp, f"icon-{s}.png") for s in sizes],
         os.path.join(BUILD, "icon.ico")], check=True)
    print("wrote build/icon.ico")

    # tray / taskbar glyph (transparent, light strokes read better at 16px)
    png(mark_svg(plate=False, glow=False), os.path.join(SRC_ASSETS, "tray.png"), 64)

    # store / readme artwork
    png(mark_svg(size=1024), os.path.join(BRAND, "icon-1024.png"), 1024)


if __name__ == "__main__":
    main()
