#!/usr/bin/env python3
"""Generate the installable PWA icons without external image libraries.

A 2x supersampled RGBA base is drawn in pure Python, then ImageMagick adds the
wordmark. Run from the repository root:

    python3 tools/make_icons.py
"""

import math
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)
BASE = Path("/tmp/monsoon_icon_base.png")

W = H = 512
S = 2
SW, SH = W * S, H * S


def hex_rgb(value):
    h = value.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def mix(a, b, t):
    t = clamp(t)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)


def write_png(path, width, height, pixels):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + png_chunk(b"IEND", b"")
    path.write_bytes(data)


def inside_rounded(x, y, radius=104):
    if x < radius and y < radius:
        return (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2
    if x > W - radius and y < radius:
        return (x - (W - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2
    if x < radius and y > H - radius:
        return (x - radius) ** 2 + (y - (H - radius)) ** 2 <= radius ** 2
    if x > W - radius and y > H - radius:
        return (x - (W - radius)) ** 2 + (y - (H - radius)) ** 2 <= radius ** 2
    return 0 <= x <= W and 0 <= y <= H


def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def point_line_distance(x, y, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    denom = math.hypot(dx, dy)
    if denom < 1e-6:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / denom


pixels = bytearray(SW * SH * 4)
sky_a = hex_rgb("#0a1028")
sky_b = hex_rgb("#5a2b62")
glow = hex_rgb("#ffb347")
road_a = hex_rgb("#1b2b4a")
road_b = hex_rgb("#07101f")
teal = hex_rgb("#20e3b2")
gold = hex_rgb("#ffd166")
dark = hex_rgb("#02040d")

for sy in range(SH):
    for sx in range(SW):
        x, y = sx / S, sy / S
        idx = (sy * SW + sx) * 4
        if not inside_rounded(x, y):
            pixels[idx:idx + 4] = bytes((0, 0, 0, 0))
            continue
        t = clamp((x / W * 0.45 + y / H * 0.55))
        color = mix(sky_a, sky_b, t)
        gd = math.hypot(x - 256, y - 190)
        if gd < 175:
            color = mix(color, glow, (1 - gd / 175) * 0.34)
        horizon = 330 + math.sin(x * 0.018) * 18 + math.sin(x * 0.007 + 1.2) * 12
        if y > horizon:
            road_t = clamp((y - horizon) / (H - horizon))
            color = mix(color, mix(road_a, road_b, road_t), 0.94)
        if y > 300:
            d1 = point_line_distance(x, y, 256, 300, 158, 512)
            d2 = point_line_distance(x, y, 256, 300, 354, 512)
            if min(d1, d2) < 2.6 * S / S:
                color = mix(color, teal, 0.55)
            if abs(x - 256) < 2.2 and y > 360 and int(y // 26) % 2 == 0:
                color = mix(color, gold, 0.55)
        vignette = clamp((math.hypot(x - 256, y - 256) - 205) / 340) * 0.42
        color = mix(color, dark, vignette)
        pixels[idx:idx + 3] = bytes(int(c) for c in color)
        pixels[idx + 3] = 255


def blend_pixel(sx, sy, rgb, alpha=1.0):
    if not (0 <= sx < SW and 0 <= sy < SH):
        return
    idx = (sy * SW + sx) * 4
    if pixels[idx + 3] == 0:
        pixels[idx:idx + 3] = bytes(int(c) for c in rgb)
        pixels[idx + 3] = int(255 * clamp(alpha))
        return
    old = pixels[idx:idx + 3]
    a = clamp(alpha)
    pixels[idx:idx + 3] = bytes(int(old[i] * (1 - a) + rgb[i] * a) for i in range(3))
    pixels[idx + 3] = 255


def fill_circle(cx, cy, r, rgb, alpha=1.0):
    for sy in range(max(0, int((cy - r) * S)), min(SH, int((cy + r) * S) + 1)):
        for sx in range(max(0, int((cx - r) * S)), min(SW, int((cx + r) * S) + 1)):
            if (sx / S - cx) ** 2 + (sy / S - cy) ** 2 <= r * r:
                blend_pixel(sx, sy, rgb, alpha)


def fill_rect(x, y, w, h, rgb, alpha=1.0):
    for sy in range(max(0, int(y * S)), min(SH, int((y + h) * S))):
        for sx in range(max(0, int(x * S)), min(SW, int((x + w) * S))):
            blend_pixel(sx, sy, rgb, alpha)


def fill_poly(poly, rgb, alpha=1.0):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    for sy in range(max(0, int(min(ys) * S)), min(SH, int(max(ys) * S) + 1)):
        for sx in range(max(0, int(min(xs) * S)), min(SW, int(max(xs) * S) + 1)):
            if point_in_poly(sx / S, sy / S, poly):
                blend_pixel(sx, sy, rgb, alpha)


# Moon and wet underglow.
fill_circle(256, 188, 58, hex_rgb("#ffd166"), 0.94)
fill_circle(256, 420, 96, hex_rgb("#20e3b2"), 0.10)

# Wheels behind the body.
for wx in (210, 302):
    fill_circle(wx, 414, 17, teal, 0.9)
    fill_circle(wx, 414, 12, hex_rgb("#0a0f1e"), 1.0)
    fill_circle(wx, 414, 5, hex_rgb("#1b2b4a"), 1.0)

# Car body with a warm left-to-right gradient approximated in two passes.
body = [
    (184, 400), (198, 364), (202, 350), (218, 348), (294, 348),
    (310, 350), (314, 364), (328, 400), (330, 412), (316, 414),
    (196, 414), (182, 412),
]
left_body = [p for p in body if p[0] < 256]
right_body = [p for p in body if p[0] >= 256]
# Use the full polygon twice with clipped alpha to keep the silhouette intact.
fill_poly(body, hex_rgb("#ff9f1c"))
for sy in range(int(348 * S), int(414 * S)):
    for sx in range(int(182 * S), int(330 * S)):
        x, y = sx / S, sy / S
        if point_in_poly(x, y, body):
            t = clamp((x - 182) / 148)
            blend_pixel(sx, sy, mix(hex_rgb("#ffd166"), hex_rgb("#ff6b35"), t), 0.55)

# Cabin, glass highlight and lamps.
fill_poly([(214, 352), (230, 324), (282, 324), (298, 352)], hex_rgb("#0b1830"))
fill_poly([(220, 350), (233, 329), (254, 329), (254, 350)], hex_rgb("#1a3a55"), 0.9)
fill_poly([(258, 350), (258, 329), (279, 329), (292, 350)], hex_rgb("#16324c"), 0.9)
fill_rect(198, 390, 22, 10, hex_rgb("#fff3d6"), 0.95)
fill_rect(292, 390, 22, 10, hex_rgb("#ff4d6d"), 0.95)
fill_rect(238, 344, 36, 4, hex_rgb("#ffd166"), 0.8)

# Downsample 2x to the final 512px base.
small = bytearray(W * H * 4)
for y in range(H):
    for x in range(W):
        r = g = b = a = 0
        for dy in range(S):
            for dx in range(S):
                idx = (((y * S + dy) * SW) + (x * S + dx)) * 4
                r += pixels[idx]
                g += pixels[idx + 1]
                b += pixels[idx + 2]
                a += pixels[idx + 3]
        n = S * S
        o = (y * W + x) * 4
        small[o:o + 4] = bytes((r // n, g // n, b // n, a // n))
write_png(BASE, W, H, small)

# Add the wordmark and export the manifest sizes.
subprocess.check_call([
    "convert", str(BASE),
    "-font", "DejaVu-Sans-Bold", "-pointsize", "56", "-fill", "#fff3d6",
    "-gravity", "north", "-kerning", "6", "-annotate", "+0+48", "MD",
    "-font", "DejaVu-Sans-Bold", "-pointsize", "20", "-fill", "#20e3b2",
    "-gravity", "south", "-kerning", "4", "-annotate", "+0+20", "MONSOON DRIFT",
    str(ICON_DIR / "icon-512.png"),
])
subprocess.check_call([
    "convert", str(ICON_DIR / "icon-512.png"), "-resize", "192x192",
    str(ICON_DIR / "icon-192.png"),
])
subprocess.check_call([
    "convert", str(BASE),
    "-font", "DejaVu-Sans-Bold", "-pointsize", "76", "-fill", "#fff3d6",
    "-gravity", "center", "-kerning", "8", "-annotate", "+0-30", "MD",
    str(ICON_DIR / "maskable-512.png"),
])
print("wrote", ", ".join(p.name for p in sorted(ICON_DIR.glob("*.png"))))
