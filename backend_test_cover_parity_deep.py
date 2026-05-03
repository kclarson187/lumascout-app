"""Deep dive on community-upload fallback path."""
import requests, json
from urllib.parse import unquote, urlparse, parse_qs

BASE = "http://localhost:8001"

def unwrap(url):
    if not url:
        return url
    if "/api/img" in url and "u=" in url:
        try:
            qpart = url.split("?", 1)[1]
            for kv in qpart.split("&"):
                k, _, v = kv.partition("=")
                if k == "u":
                    return unquote(v)
        except Exception:
            pass
    return url

# Get ALL markers
r = requests.get(f"{BASE}/api/spots/markers", params={"limit": 500}, timeout=30)
items = r.json().get("items") or []
print(f"Total markers: {len(items)}")

# For every spot, classify into:
# A: has primary cover (legacy field or images[])
# B: no primary cover but has community uploads → MUST have thumb_url (fallback active)
# C: no primary cover, no community uploads → thumb_url = None (correct)

cat_a = cat_b = cat_b_failures = cat_c = unknown = 0
for m in items:
    spot_id = m.get("spot_id")
    marker_thumb = m.get("thumb_url")
    marker_unwrapped = unwrap(marker_thumb)

    d = requests.get(f"{BASE}/api/spots/{spot_id}", timeout=20)
    if d.status_code != 200:
        unknown += 1
        continue
    detail = d.json()
    legacy_cover = (
        detail.get("hero_cover_image_url")
        or detail.get("card_url")
        or detail.get("image_url")
    )
    imgs = detail.get("images") or []
    has_primary_image = any(
        isinstance(im, dict) and (im.get("image_url") or im.get("card_url") or im.get("thumb_url"))
        for im in imgs if im
    )

    cu = requests.get(f"{BASE}/api/spots/{spot_id}/uploads", timeout=15).json()
    cu_items = cu.get("items") or cu.get("uploads") or []
    approved_cu = [u for u in cu_items if (u.get("moderation_status") == "approved" or u.get("status") == "approved") and u.get("image_url")]

    if legacy_cover or has_primary_image:
        cat_a += 1
    elif approved_cu:
        if marker_thumb:
            cat_b += 1
            # Verify fallback URL matches the OLDEST approved community upload
            oldest = sorted(approved_cu, key=lambda u: u.get("created_at") or "")[0]
            print(f"  CAT_B spot={spot_id} title={detail.get('title')!r}")
            print(f"        marker_unwrapped={marker_unwrapped[:120]}")
            print(f"        oldest_cu_image={(oldest.get('image_url') or '')[:120]}")
        else:
            cat_b_failures += 1
            print(f"  ✗ CAT_B FAIL spot={spot_id} no marker thumb but has {len(approved_cu)} approved CUs")
    else:
        cat_c += 1
        print(f"  CAT_C spot={spot_id} title={detail.get('title')!r} (no cover, no CUs — thumb null is CORRECT)")

print(f"\nA (primary cover): {cat_a}")
print(f"B (community fallback active, thumb populated): {cat_b}")
print(f"B failures (had CU but no thumb!): {cat_b_failures}")
print(f"C (no cover + no CU, thumb null is correct): {cat_c}")
print(f"unknown: {unknown}")
