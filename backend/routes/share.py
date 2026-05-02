"""
Smart-link share endpoints for LumaScout.

CR Items 7 & 8 (May 2026)
─────────────────────────
Replaces the previous broken `LumaScout.app` placeholder URLs that did not
resolve to any install destination. This module ships a single redirect
URL per shareable entity that:

  • Returns Open Graph + Twitter Card metadata for clean iMessage/SMS/
    Discord/Slack/Twitter link previews (so the recipient sees a poster
    image, title and description card BEFORE they tap the link)
  • Auto-redirects based on User-Agent:
      – iOS Safari / WebKit  → App Store deeplink
      – Android Chrome / WebView → Play Store deeplink
      – Desktop browsers → public web profile / spot / post page
  • Carries a deeplink param (`spot=…` / `user=…` / `post=…`) so when
    the recipient already has the LumaScout app installed, the App Store
    / Play Store flow opens directly to that entity instead of the home
    feed (Apple / Google universal-link handlers wire this once the
    matching `apple-app-site-association` and `assetlinks.json` files
    are deployed; this endpoint produces the URL that those handlers
    will recognise).

URL shape:
    GET /api/share/spot/{spot_id}
    GET /api/share/user/{user_id}
    GET /api/share/post/{post_id}

The shared text is built client-side (see /app/frontend/src/utils/share.ts)
because the wording is locale-aware and per-context. This endpoint just
returns the destination URL.
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
import os
import urllib.parse

router = APIRouter(prefix="/api/share", tags=["share"])

# Public install destinations. Configurable via env so prod/staging can
# point at different App Store records during phased rollout.
APP_STORE_URL = os.environ.get(
    "LUMASCOUT_APP_STORE_URL",
    "https://apps.apple.com/app/id6762586637",
)
PLAY_STORE_URL = os.environ.get(
    "LUMASCOUT_PLAY_STORE_URL",
    # Placeholder — Android isn't shipped yet. Falls through to web for now.
    "https://play.google.com/store/apps/details?id=app.emergent.photofinder60669d6fa1",
)
WEB_BASE = os.environ.get(
    "LUMASCOUT_WEB_BASE",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")


def _is_ios(ua: str) -> bool:
    ua = ua.lower()
    return any(k in ua for k in ("iphone", "ipad", "ipod"))


def _is_android(ua: str) -> bool:
    return "android" in ua.lower()


def _meta_html(*, title: str, description: str, image: Optional[str], canonical: str,
               app_store: str, play_store: str, deeplink: str) -> str:
    """Render the Open Graph HTML + UA-driven redirect."""
    safe_title = (title or "LumaScout").replace('"', "&quot;")
    safe_desc = (description or "Find premium photo locations").replace('"', "&quot;")
    safe_image = image or f"{WEB_BASE}/social-card.png"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{safe_title} · LumaScout</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="description" content="{safe_desc}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{safe_title}" />
<meta property="og:description" content="{safe_desc}" />
<meta property="og:image" content="{safe_image}" />
<meta property="og:url" content="{canonical}" />
<meta property="og:site_name" content="LumaScout" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{safe_title}" />
<meta name="twitter:description" content="{safe_desc}" />
<meta name="twitter:image" content="{safe_image}" />
<!-- iOS Smart App Banner: opens the App Store entry inline if the
     recipient is on iOS Safari and doesn't have the app installed. -->
<meta name="apple-itunes-app" content="app-id=6762586637, app-argument={deeplink}" />
<style>
body {{ margin:0; font-family: -apple-system, system-ui, "Helvetica Neue", Arial; background:#000; color:#fff;
        height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; padding:40px; text-align:center; }}
img {{ width:96px; height:96px; border-radius:24px; margin-bottom:24px; }}
h1 {{ font-family:Georgia, "Times New Roman", serif; font-size:28px; margin:0 0 12px; font-weight:600; }}
p {{ opacity:.7; max-width:320px; margin:0 0 32px; line-height:1.4; }}
a.btn {{ background:#F5A524; color:#0a0a0a; text-decoration:none; padding:14px 28px; border-radius:999px;
         font-weight:700; letter-spacing:.4px; display:inline-block; }}
a.alt {{ display:block; margin-top:18px; color:#888; font-size:13px; text-decoration:underline; }}
.spinner {{ width:24px;height:24px;border:2px solid #2a2a2a;border-top-color:#F5A524;border-radius:50%;
            animation:spin 1s linear infinite;margin:24px auto 0; }}
@keyframes spin {{ to {{ transform:rotate(360deg); }} }}
</style>
</head>
<body>
<img src="{WEB_BASE}/icon.png" onerror="this.style.display='none'" />
<h1>{safe_title}</h1>
<p>{safe_desc}</p>
<a class="btn" id="cta" href="{canonical}">Open in LumaScout</a>
<a class="alt" id="alt" href="{canonical}">Continue on the web →</a>
<div class="spinner" id="spinner" style="display:none"></div>
<script>
(function() {{
  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/i.test(ua);
  var android = /Android/i.test(ua);
  var deeplink = "{deeplink}";
  var appStore = "{app_store}";
  var playStore = "{play_store}";
  var web = "{canonical}";

  if (ios) {{
    document.getElementById('cta').href = appStore;
    document.getElementById('cta').innerText = 'Get LumaScout';
    document.getElementById('alt').href = web;
    document.getElementById('spinner').style.display = 'block';
    // 1s grace then try to open the app via universal link.
    setTimeout(function() {{ window.location = deeplink; }}, 250);
    setTimeout(function() {{ window.location = appStore; }}, 1800);
  }} else if (android) {{
    document.getElementById('cta').href = playStore;
    document.getElementById('cta').innerText = 'Get LumaScout';
    document.getElementById('alt').href = web;
    document.getElementById('spinner').style.display = 'block';
    setTimeout(function() {{ window.location = deeplink; }}, 250);
    setTimeout(function() {{ window.location = playStore; }}, 1800);
  }}
  // Desktop: stay on the page; user can click "Continue on the web".
}})();
</script>
</body>
</html>
"""


@router.get("/spot/{spot_id}", response_class=HTMLResponse)
async def share_spot(spot_id: str, request: Request):
    from server import db  # local import to avoid circular imports at module load
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "title": 1, "city": 1, "state": 1, "shoot_types": 1, "hero_cover_image_url": 1, "images": {"$slice": 1}})
    title = (spot or {}).get("title") or "Photo location"
    city_state = ", ".join([x for x in [(spot or {}).get("city"), (spot or {}).get("state")] if x])
    description = f"{city_state}" if city_state else "Premium photo location on LumaScout"
    shoot_type = ((spot or {}).get("shoot_types") or [None])[0]
    if shoot_type:
        description = f"{shoot_type.title()} spot — {description}" if description else f"{shoot_type.title()} spot"
    img = (spot or {}).get("hero_cover_image_url")
    if not img:
        first = ((spot or {}).get("images") or [{}])[0] if (spot or {}).get("images") else {}
        if isinstance(first, dict):
            img = first.get("card_url") or first.get("image_url") or first.get("thumb_url")
    canonical = f"{WEB_BASE}/spot/{urllib.parse.quote(spot_id)}"
    return HTMLResponse(_meta_html(
        title=title, description=description, image=img, canonical=canonical,
        app_store=APP_STORE_URL, play_store=PLAY_STORE_URL,
        deeplink=f"lumascout://spot/{spot_id}",
    ))


@router.get("/user/{user_id}", response_class=HTMLResponse)
async def share_user(user_id: str, request: Request):
    from server import db
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "display_name": 1, "username": 1, "specialty": 1, "bio": 1, "avatar_url": 1, "banner_url": 1})
    name = (user or {}).get("display_name") or (user or {}).get("username") or "Photographer"
    specialty = (user or {}).get("specialty") or "Photographer"
    bio = (user or {}).get("bio") or ""
    title = f"{name}"
    description = f"{specialty} on LumaScout" + (f" — {bio[:80]}" if bio else "")
    img = (user or {}).get("banner_url") or (user or {}).get("avatar_url")
    canonical = f"{WEB_BASE}/u/{urllib.parse.quote(user_id)}"
    return HTMLResponse(_meta_html(
        title=title, description=description, image=img, canonical=canonical,
        app_store=APP_STORE_URL, play_store=PLAY_STORE_URL,
        deeplink=f"lumascout://user/{user_id}",
    ))


@router.get("/post/{post_id}", response_class=HTMLResponse)
async def share_post(post_id: str, request: Request):
    from server import db
    post = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0, "title": 1, "body": 1, "image_urls": 1, "author_name": 1})
    title = (post or {}).get("title") or "LumaScout community post"
    body = (post or {}).get("body") or ""
    description = (body[:140] + ("…" if len(body) > 140 else "")) if body else "From the LumaScout photographer community"
    images = (post or {}).get("image_urls") or []
    img = images[0] if images else None
    canonical = f"{WEB_BASE}/post/{urllib.parse.quote(post_id)}"
    return HTMLResponse(_meta_html(
        title=title, description=description, image=img, canonical=canonical,
        app_store=APP_STORE_URL, play_store=PLAY_STORE_URL,
        deeplink=f"lumascout://post/{post_id}",
    ))


# Generic install link (used when the user shares the app itself, no entity).
@router.get("/get", response_class=HTMLResponse)
async def share_app(request: Request):
    return HTMLResponse(_meta_html(
        title="LumaScout",
        description="Find premium photo locations near you",
        image=None,
        canonical=WEB_BASE,
        app_store=APP_STORE_URL, play_store=PLAY_STORE_URL,
        deeplink="lumascout://",
    ))
