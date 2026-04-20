"""
One-time script — generates LumaScout app icons using Gemini Nano Banana.

Outputs:
  /app/frontend/assets/images/icon.png           (1024x1024 app icon)
  /app/frontend/assets/images/adaptive-icon.png  (Android adaptive foreground)
  /app/frontend/assets/images/splash-icon.png    (splash screen variant)

Usage:
  cd /app/backend && python3 _gen_icons.py
"""

import asyncio
import base64
import os
import sys
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv()

MODEL = "gemini-3.1-flash-image-preview"
OUT = "/app/frontend/assets/images"

PROMPTS = {
    "icon.png": (
        "Premium mobile app icon for 'LumaScout' — a photography location scouting app. "
        "Design language: cinematic, premium, ultra-modern, trustworthy, photography-first. "
        "Square canvas 1024x1024. Dark deep navy/charcoal background with a subtle radial "
        "gradient and a faint warm golden highlight coming from the top-left — like golden-hour "
        "light grazing the edge of a lens. "
        "Centerpiece: the wordmark 'LumaScout' in a tight, refined serif-display typeface "
        "(Playfair Display or similar), kerned confidently, centered, with a thin warm-gold "
        "(#D4A85B) underline or light-ray accent. Above the wordmark, a small minimalist "
        "compass-needle icon fused with a camera aperture — rendered in polished gold. "
        "No mascot, no emoji, no cartoon. Flat-to-semi-flat vector style, crisp edges, "
        "high-contrast, feels like a luxury camera brand, not a generic mobile app. "
        "Leave about 8% padding on all sides so iOS rounding looks balanced. No text outside "
        "the 'LumaScout' wordmark. No watermarks. Clean export, no background blur."
    ),
    "adaptive-icon.png": (
        "Android adaptive icon FOREGROUND layer for 'LumaScout' photography app. "
        "Square canvas 1024x1024. Transparent background. "
        "Centered glyph: a minimalist polished gold (#D4A85B) monogram combining a compass "
        "needle and a camera aperture, about 50% of the canvas size, positioned dead-center "
        "so the Android circular/squircle mask crops cleanly. Slight inner glow to lift the "
        "glyph against dark launchers. No wordmark, no secondary text — just the glyph. "
        "Crisp vector style, subtle depth, premium feel."
    ),
    "splash-icon.png": (
        "Splash screen icon for 'LumaScout' photography location scouting app. "
        "Square canvas 1024x1024 with a mostly dark deep-navy/charcoal background and a "
        "subtle warm radial vignette from top. Centerpiece: the 'LumaScout' wordmark in a "
        "refined serif-display typeface, large and confident, centered, with a thin warm-gold "
        "(#D4A85B) horizontal light ray just above the wordmark and a tiny compass-aperture "
        "glyph floating above the ray. Tagline 'Discover better light' rendered small in "
        "light grey immediately under the wordmark, generous letter-spacing. Cinematic, "
        "premium, polished — feels like the opening frame of a luxury camera brand film. "
        "No other text, no watermarks, no borders."
    ),
}


async def generate_one(filename: str, prompt: str) -> bool:
    path = os.path.join(OUT, filename)
    print(f"\n→ Generating {filename} …")
    chat = LlmChat(
        api_key=os.getenv("EMERGENT_LLM_KEY"),
        session_id=f"lumascout-icon-{filename}",
        system_message="You are an elite brand designer producing polished app-icon artwork.",
    )
    chat.with_model("gemini", MODEL).with_params(modalities=["image", "text"])
    msg = UserMessage(text=prompt)
    text, images = await chat.send_message_multimodal_response(msg)
    if not images:
        print(f"  ✗ No image returned. Text: {text[:120]}")
        return False
    img = images[0]
    raw = base64.b64decode(img["data"])
    with open(path, "wb") as f:
        f.write(raw)
    size_kb = len(raw) // 1024
    print(f"  ✓ wrote {path} ({size_kb} KB, mime={img.get('mime_type')})")
    return True


async def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    results = {}
    for fname, prompt in PROMPTS.items():
        if only and only != fname:
            continue
        try:
            results[fname] = await generate_one(fname, prompt)
        except Exception as exc:
            print(f"  ✗ {fname} failed: {exc}")
            results[fname] = False
    print("\n== Done ==")
    for f, ok in results.items():
        print(f"  {'OK' if ok else 'FAIL'}  {f}")


if __name__ == "__main__":
    asyncio.run(main())
