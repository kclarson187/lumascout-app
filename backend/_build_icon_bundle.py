"""
Build a downloadable brand-icon bundle for LumaScout app-store submissions.

Outputs:
  /app/backend/_brand_export/lumascout-brand-icons.zip

Contents of the zip:
  icon-appstore-1024.png     — iOS / Mac App Store (1024x1024, RGB, NO alpha)
  icon-playstore-512.png     — Google Play Store icon (512x512, RGBA)
  icon-1024.png              — general use (1024x1024 RGBA)
  adaptive-foreground-1024.png — Android adaptive icon foreground (RGBA transparent)
  splash-1024.png            — splash screen artwork
  favicon-256.png            — web favicon
  README.txt                 — store-upload instructions

Run:
  cd /app/backend && python3 _build_icon_bundle.py
"""

import io
import os
import zipfile
from PIL import Image

SRC = "/app/frontend/assets/images"
OUT_DIR = "/app/backend/_brand_export"
OUT_ZIP = os.path.join(OUT_DIR, "lumascout-brand-icons.zip")

README = """LumaScout — Brand Icon Bundle
==============================

Files in this archive
---------------------
  icon-appstore-1024.png           iOS / Mac App Store upload (1024x1024, RGB, NO alpha)
  icon-playstore-512.png           Google Play Store app icon (512x512, RGBA, 32-bit PNG)
  icon-1024.png                    Full 1024x1024 RGBA PNG — general use
  adaptive-foreground-1024.png     Android 13+ adaptive-icon foreground layer (transparent bg)
  splash-1024.png                  Splash screen artwork (1024x1024 RGBA)
  favicon-256.png                  Web favicon (256x256 RGBA)

Store upload checklist
----------------------
Apple App Store Connect
  1. App Information → App Store Icon → upload icon-appstore-1024.png
  2. Must be exactly 1024x1024 PNG, sRGB, NO transparency. This file is pre-flattened.
  3. Apple applies rounded corners automatically — do not round yourself.

Google Play Console
  1. Store Listing → Graphics → App icon → upload icon-playstore-512.png
  2. 512x512 PNG, 32-bit (RGBA) allowed.
  3. For the in-app launcher icon, the app already ships an adaptive icon with
     `adaptive-foreground-1024.png` as the foreground — no extra upload needed.

Web
  1. `favicon-256.png` is already wired into expo's web shell.

Questions? Re-generate the source icons with:
  cd /app/backend && python3 _gen_icons.py
"""


def flatten_to_rgb(img: Image.Image, bg=(11, 13, 18)) -> Image.Image:
    """Remove alpha channel by compositing over a solid brand-dark background."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    canvas = Image.new("RGB", img.size, bg)
    canvas.paste(img, mask=img.split()[3])  # use alpha as mask
    return canvas


def build():
    os.makedirs(OUT_DIR, exist_ok=True)

    icon = Image.open(os.path.join(SRC, "icon.png")).convert("RGBA")
    adaptive = Image.open(os.path.join(SRC, "adaptive-icon.png")).convert("RGBA")
    splash = Image.open(os.path.join(SRC, "splash-icon.png")).convert("RGBA")

    # Normalise sizes
    if icon.size != (1024, 1024):
        icon = icon.resize((1024, 1024), Image.LANCZOS)
    if adaptive.size != (1024, 1024):
        adaptive = adaptive.resize((1024, 1024), Image.LANCZOS)
    if splash.size != (1024, 1024):
        splash = splash.resize((1024, 1024), Image.LANCZOS)

    # App Store variant (RGB, NO alpha, flattened over brand-dark)
    appstore = flatten_to_rgb(icon)

    # Play Store variant (512x512 RGBA)
    playstore = icon.resize((512, 512), Image.LANCZOS)

    # Favicon 256
    favicon = icon.resize((256, 256), Image.LANCZOS)

    def encode(img: Image.Image, fmt: str = "PNG") -> bytes:
        buf = io.BytesIO()
        img.save(buf, fmt, optimize=True)
        return buf.getvalue()

    entries = {
        "icon-appstore-1024.png": encode(appstore),
        "icon-playstore-512.png": encode(playstore),
        "icon-1024.png": encode(icon),
        "adaptive-foreground-1024.png": encode(adaptive),
        "splash-1024.png": encode(splash),
        "favicon-256.png": encode(favicon),
        "README.txt": README.encode("utf-8"),
    }

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)

    size_kb = os.path.getsize(OUT_ZIP) // 1024
    print(f"✓ wrote {OUT_ZIP} ({size_kb} KB)")
    for name, data in entries.items():
        kb = len(data) // 1024
        print(f"    {name}: {kb} KB")


if __name__ == "__main__":
    build()
