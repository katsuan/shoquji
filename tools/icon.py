#!/usr/bin/env python3
"""しょくじ（ShoQuji）のアイコン・ロゴ・OGP を作る。

名前は「しょくじ」。英字は ShoQuji（「しょ・く・じ」の「く」を Q にする。u はロゴでお茶の湯のみの絵にする）。
アイコンはおくるんと同じ角の丸い四角に、玉子焼きの黄色のグラデーション。
Q は上から見たお茶碗：白いふちが Q の輪、中にご飯（うっすら白）と梅干し（赤）、右下へ出た2本のお箸が Q のしっぽ。
（お皿とお箸・満腹の顔（舌がしっぽ）の案とくらべて、これに決めた）

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「ShoQuji」（S・h・o・j・i は Jua、Q はアイコンと同じお茶碗、u は 🍵 のような湯のみ（u の字の形を胴にして、緑のお茶と湯気））
  ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
from pathlib import Path

import re

import brandkit_path  # noqa: F401（となりのおくるん（q-oqrn）の tools/brandkit.py を読めるようにする）
from brandkit import Brand, centered, num, polar

ROOT = Path(__file__).resolve().parent.parent
BRAND = Brand(light=(255, 196, 72), dark=(236, 138, 22))  # 玉子焼きの黄色

C = (46, 46)  # お茶碗（輪）の中心
R, RING_W = 24, 10  # 輪の半径（線の真ん中）・太さ
UME = (230, 70, 72)
SHAPES = [
    # ご飯（うっすら白）と、ご飯つぶ
    {"t": "circle", "c": C, "r": R - RING_W / 2 + 0.5, "alpha": 0.42},
    {"t": "circle", "c": (C[0] - 8, C[1] - 6), "r": 1.7, "alpha": 0.9},
    {"t": "circle", "c": (C[0] + 7, C[1] - 8), "r": 1.5, "alpha": 0.9},
    {"t": "circle", "c": (C[0] - 9, C[1] + 6), "r": 1.5, "alpha": 0.9},
    {"t": "circle", "c": (C[0] + 2, C[1] + 9), "r": 1.6, "alpha": 0.9},
    # お茶碗のふち（Q の輪）
    {"t": "ring", "c": C, "r": R, "w": RING_W},
    # 梅干し（まん中）
    {"t": "circle", "c": C, "r": 6.2, "fill": UME},
    {"t": "circle", "c": (C[0] - 2, C[1] - 2.2), "r": 1.6, "fill": (255, 150, 150)},
    # お箸 2本（Q のしっぽ。右下へ。輪のふちから外へ）
    {"t": "line", "p": [polar(C, 40, R - 2), polar(C, 40, 44)], "w": 4.2},
    {"t": "line", "p": [polar(C, 52, R - 2), polar(C, 52, 43)], "w": 4.2},
]
# 外形（お箸を含む）の真ん中をアイコンの真ん中にそろえる（ロゴも同じ形を使う）
SHAPES, (_DX, _DY) = centered(SHAPES)
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


def decorate(d, s):
    """OGP の背景：うっすらご飯つぶ（たべもの）"""
    for x, y, r, a in ((1070, 100, 14, 90), (1140, 330, 9, 80), (960, 560, 11, 80), (70, 90, 10, 80), (430, 570, 7, 70)):
        d.ellipse(((x - r * 0.7) * s, (y - r) * s, (x + r * 0.7) * s, (y + r) * s), fill=(255, 255, 255, a))


TEA, TEA_DARK = (126, 178, 74), (92, 140, 52)


def path_bounds(d):
    """SVG のパス（字の形）の数字から、だいたいの外形（x0, y0, x1, y1）"""
    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]
    xs, ys = nums[0::2], nums[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def teacup_logo(svg):
    """ロゴの u を、湯のみ（🍵）の絵に置きかえる。u の字の外形に合わせて、胴・お茶・湯気を描く"""
    paths = re.findall(r'<path d="([^"]+)" fill="[^"]+" stroke="[^"]+"/>', svg)
    # 字の並びは S・h・o・u・j・i（Q は字のパスに入らない）。4つめが u
    u = paths[3]
    x0, y0, x1, y1 = path_bounds(u)
    w, h = x1 - x0, y1 - y0
    r = w * 0.32  # 胴の下の丸み
    body = (
        f"M{num(x0)} {num(y0)} L{num(x1)} {num(y0)} L{num(x1 - w * 0.06)} {num(y1 - r)} "
        f"Q{num(x1 - w * 0.08)} {num(y1)} {num(x1 - r)} {num(y1)} L{num(x0 + r)} {num(y1)} "
        f"Q{num(x0 + w * 0.08)} {num(y1)} {num(x0 + w * 0.06)} {num(y1 - r)} Z"
    )
    tea_h = h * 0.2
    lip = h * 0.07
    steam = []
    for k, dx in ((0, 0.3), (1, 0.66)):
        sx = x0 + w * dx
        top = y0 - h * (0.62 if k == 0 else 0.5)
        steam.append(
            f'<path d="M{num(sx)} {num(y0 - h * 0.08)} q{num(-w * 0.12)} {num(-h * 0.14)} 0 {num(-h * 0.28)} '
            f'q{num(w * 0.12)} {num(-h * 0.14)} 0 {num(top - (y0 - h * 0.36))}" fill="none" stroke="#ffffff" '
            f'stroke-width="{num(w * 0.09)}" stroke-linecap="round" opacity="0.85"/>'
        )
    cup = (
        f'<path d="{body}" fill="#ffffff" stroke="url(#g)" stroke-width="{num(w * 0.05)}" stroke-linejoin="round"/>'
        # お茶（ふちの少し下に緑の面）と、湯のみの模様の線
        + f'<rect x="{num(x0 + w * 0.08)}" y="{num(y0 + lip)}" width="{num(w * 0.84)}" height="{num(tea_h)}" rx="{num(tea_h / 2)}" fill="{"#%02x%02x%02x" % TEA}"/>'
        + f'<rect x="{num(x0 + w * 0.2)}" y="{num(y0 + h * 0.62)}" width="{num(w * 0.6)}" height="{num(h * 0.07)}" rx="{num(h * 0.035)}" fill="{"#%02x%02x%02x" % TEA_DARK}" opacity="0.55"/>'
        + "".join(steam)
    )
    svg = svg.replace(f'<path d="{u}"', '<path d="M0 0"', 1)  # 字の u は消して
    return svg.replace("</svg>", cup + "</svg>")


def main():
    BRAND.write_icons(ROOT, SHAPES)
    logo, ratio = BRAND.logo_svg("ShoQuji", SHAPES, C, RING_OUTER, "ShoQuji（しょくじ）")
    (ROOT / "logo.svg").write_text(teacup_logo(logo), encoding="utf-8")
    BRAND.write_ogp(
        ROOT / "ogp.png", SHAPES, "しょくじ", "ShoQuji",
        ["食べたものを、さっと記録", "LINE で開けばシートにも残る"], decorate,
        copy="食べたら、ぱっと残そう",
    )
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
