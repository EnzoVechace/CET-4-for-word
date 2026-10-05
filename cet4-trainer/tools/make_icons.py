"""生成「词计划」的应用图标：PWA 用的 PNG + Windows 程序用的 .ico。

用法：python tools/make_icons.py
产物：
  public/icons/icon-192.png        普通图标
  public/icons/icon-512.png
  public/icons/maskable-512.png    Android 自适应图标（留出安全边距）
  public/icons/apple-touch-icon.png
  build/app.ico                    Windows 可执行文件图标（多尺寸）
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, "public", "icons")
BUILD = os.path.join(ROOT, "build")
os.makedirs(ICONS, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)

C1 = (79, 70, 229)    # #4f46e5 indigo
C2 = (124, 58, 237)   # #7c3aed violet

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\consolab.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\seguisb.ttf",
]


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def gradient(size):
    """对角渐变底图"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1)) if size > 1 else 0.0
            px[x, y] = (
                round(C1[0] + (C2[0] - C1[0]) * t),
                round(C1[1] + (C2[1] - C1[1]) * t),
                round(C1[2] + (C2[2] - C1[2]) * t),
            )
    return img


def rounded_mask(size, radius_ratio):
    m = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(m)
    r = int(size * 4 * radius_ratio)
    d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=r, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def draw_mark(img, size, scale):
    """在正中画一个白色 W"""
    d = ImageDraw.Draw(img)
    f = font(int(size * scale))
    text = "W"
    box = d.textbbox((0, 0), text, font=f)
    w = box[2] - box[0]
    h = box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=f, fill=(255, 255, 255))
    return img


def icon(size, radius_ratio=0.22, glyph_scale=0.60, maskable=False):
    base = gradient(size)
    img = base.convert("RGBA")
    if maskable:
        # 自适应图标：整块铺满，不做圆角，由系统裁切；W 缩小到安全区
        img.putalpha(255)
    else:
        img.putalpha(rounded_mask(size, radius_ratio))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(layer, size, glyph_scale)
    img.alpha_composite(layer)
    return img


def main():
    out = []
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
        p = os.path.join(ICONS, name)
        icon(size).save(p)
        out.append(p)
    p = os.path.join(ICONS, "maskable-512.png")
    icon(512, glyph_scale=0.46, maskable=True).save(p)
    out.append(p)
    p = os.path.join(ICONS, "apple-touch-icon.png")
    icon(180, radius_ratio=0.0, glyph_scale=0.60).save(p)
    out.append(p)

    ico = os.path.join(BUILD, "app.ico")
    icon(256).save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    out.append(ico)

    # Android 启动图标：mipmap-<密度>/ic_launcher.png
    # 不用自适应图标（那要 API 26+ 的 XML），直接铺满画布的方形圆角图，兼容从 5.0 起的所有机器
    dpi = [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]
    for name, size in dpi:
        d = os.path.join(ROOT, "android", "res", "mipmap-" + name)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "ic_launcher.png")
        icon(size, radius_ratio=0.0, glyph_scale=0.60).save(p)
        out.append(p)

    for p in out:
        print("%9d  %s" % (os.path.getsize(p), os.path.relpath(p, ROOT)))


if __name__ == "__main__":
    main()
