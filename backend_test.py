"""
Track A — Upload reliability stress test.
"""
import io
import os
import json
import time
import concurrent.futures
from typing import List, Tuple

import requests
from PIL import Image

BASE = os.environ.get("BACKEND_URL", "https://photo-finder-60.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

EMAIL = "admin@lumascout.app"
PASSWORD = "Grayson@1117!!"
ALT_EMAIL = "kclarson187@gmail.com"
ALT_PASSWORD = "Pass123!"


def login(email: str, password: str) -> Tuple[str, dict]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        return "", {}
    j = r.json()
    tok = j.get("token") or j.get("access_token") or ""
    return tok, j


def make_jpeg(w: int, h: int, quality: int = 85, color=(200, 80, 60)) -> bytes:
    im = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def make_png_rgba(w: int, h: int) -> bytes:
    im = Image.new("RGBA", (w, h), (255, 100, 50, 128))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def make_heic(w: int, h: int) -> bytes:
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except Exception:
        return b""
    im = Image.new("RGB", (w, h), (100, 180, 80))
    buf = io.BytesIO()
    try:
        im.save(buf, format="HEIF")
    except Exception as e:
        print(f"  (HEIC save failed: {e})")
        return b""
    return buf.getvalue()


def make_exif_rotated_jpeg(w: int, h: int, orientation: int = 6) -> bytes:
    try:
        import piexif
    except ImportError:
        return b""
    im = Image.new("RGB", (w, h), (50, 100, 200))
    exif_dict = {"0th": {piexif.ImageIFD.Orientation: orientation}, "Exif": {}, "1st": {}, "thumbnail": None, "GPS": {}}
    exif_bytes = piexif.dump(exif_dict)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", exif=exif_bytes, quality=85)
    return buf.getvalue()


def upload_image(token: str, data: bytes, filename: str = "test.jpg", content_type: str = "image/jpeg", timeout: int = 60):
    files = {"file": (filename, data, content_type)}
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    t0 = time.monotonic()
    r = requests.post(f"{API}/uploads/image", headers=headers, files=files, timeout=timeout)
    return r, int((time.monotonic() - t0) * 1000)


def post_spot_upload(token: str, spot_id: str, images: List[dict], caption: str = "", tags: List[str] = None, visibility: str = "public", timeout: int = 30):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"images": images, "caption": caption, "condition_tags": tags or [], "visibility": visibility}
    t0 = time.monotonic()
    r = requests.post(f"{API}/spots/{spot_id}/uploads", headers=headers, data=json.dumps(body), timeout=timeout)
    return r, int((time.monotonic() - t0) * 1000)


RESULTS = []

def record(name, passed, code, elapsed_ms, note=""):
    tag = "PASS" if passed else "FAIL"
    line = f"[{tag}] {name:<62} HTTP={code} {elapsed_ms}ms {note[:180]}"
    print(line)
    RESULTS.append((name, passed, code, elapsed_ms, note))


def main():
    print(f"Backend: {API}")

    print("\n=== Login ===")
    tok, meta = login(EMAIL, PASSWORD)
    if not tok:
        print(f"PRIMARY LOGIN FAILED for {EMAIL}")
        return
    me = meta.get("user") or {}
    print(f"Logged in: {me.get('email')} user_id={me.get('user_id')} role={me.get('role')}")

    tok_alt, _ = login(ALT_EMAIL, ALT_PASSWORD)
    print(f"Alt ({ALT_EMAIL}): {'OK' if tok_alt else 'FAILED'}")

    # ======== Group 1 ========
    print("\n=== Group 1: /api/uploads/image basic sanity ===")

    r = requests.post(f"{API}/uploads/image", files={"file": ("a.jpg", make_jpeg(100, 100), "image/jpeg")}, timeout=15)
    record("1. missing bearer -> 401/403", r.status_code in (401, 403), r.status_code, 0)

    r = requests.post(f"{API}/uploads/image",
                      headers={"Authorization": "Bearer not-a-real-token"},
                      files={"file": ("a.jpg", make_jpeg(100, 100), "image/jpeg")},
                      timeout=15)
    record("2. invalid bearer -> 401", r.status_code == 401, r.status_code, 0)

    r, ms = upload_image(tok, make_jpeg(500, 500), filename="happy500.jpg")
    ok = r.status_code == 200
    j = r.json() if ok else {}
    record("3. happy 500x500 JPEG", ok and j.get("width") == 500 and j.get("height") == 500 and j.get("image_url"),
           r.status_code, ms, f"url={j.get('image_url')} bytes={j.get('bytes')}")
    happy_url = j.get("image_url") if ok else None

    r, ms = upload_image(tok, make_jpeg(3000, 2000), filename="big3000.jpg")
    j = r.json() if r.status_code == 200 else {}
    w, h = j.get("width"), j.get("height")
    record("4. 3000x2000 resize <=2048", r.status_code == 200 and (w or 9999) <= 2048 and (h or 9999) <= 2048,
           r.status_code, ms, f"w={w} h={h}")

    r, ms = upload_image(tok, b"", filename="empty.jpg")
    record("5. empty file -> 400", r.status_code == 400, r.status_code, ms, r.text[:120])

    # too large: build 11MB buffer. Server checks len(blob) > 10MB.
    payload_11mb = b"\xff\xd8" + os.urandom(11 * 1024 * 1024)  # fake JPEG SOI + noise
    r, ms = upload_image(tok, payload_11mb, filename="huge.jpg")
    record("6. 11MB -> 413", r.status_code == 413, r.status_code, ms)

    corrupt = b"This is not a jpeg at all." * 20
    r, ms = upload_image(tok, corrupt, filename="fake.jpg")
    record("7. corrupted -> 415", r.status_code == 415, r.status_code, ms)

    heic = make_heic(1000, 1000)
    if heic:
        r, ms = upload_image(tok, heic, filename="test.heic", content_type="image/heic")
        record("8. HEIC 1000x1000 -> 200", r.status_code == 200, r.status_code, ms,
               r.text[:120] if r.status_code != 200 else "")
    else:
        record("8. HEIC (skipped — pillow_heif locally unavailable)", True, 0, 0, "skipped")

    r, ms = upload_image(tok, make_png_rgba(500, 500), filename="trans.png", content_type="image/png")
    j = r.json() if r.status_code == 200 else {}
    record("9. PNG RGBA -> JPEG flatten", r.status_code == 200 and j.get("mime") == "image/jpeg",
           r.status_code, ms, f"mime={j.get('mime')}")

    raw = make_exif_rotated_jpeg(800, 400, orientation=6)
    if raw:
        r, ms = upload_image(tok, raw, filename="rot.jpg")
        j = r.json() if r.status_code == 200 else {}
        w, h = j.get("width"), j.get("height")
        record("10. EXIF rot=6 swaps w/h (800x400->400x800)",
               r.status_code == 200 and w == 400 and h == 800,
               r.status_code, ms, f"got {w}x{h}")
    else:
        record("10. EXIF rotation (skipped — piexif not installed)", True, 0, 0, "skipped")

    # ======== Group 2 ========
    print("\n=== Group 2: /api/uploads/image stress ===")

    def one_par(i):
        return upload_image(tok, make_jpeg(500, 500, color=(i*20, 100, 200)), filename=f"p{i}.jpg")

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        results = [f.result() for f in [ex.submit(one_par, i) for i in range(10)]]
    codes = [r.status_code for r, _ in results]
    max_ms = max(ms for _, ms in results)
    no_5xx = all(c < 500 for c in codes)
    record("11. 10 parallel uploads — NO 5xx", no_5xx, max(codes), max_ms, f"codes={codes}")

    failures_12 = []
    codes_12 = []
    big_2mb = make_jpeg(3000, 2400, quality=92)
    t0 = time.monotonic()
    for i in range(20):
        r, ms = upload_image(tok, big_2mb, filename=f"seq{i}.jpg")
        codes_12.append(r.status_code)
        if r.status_code >= 500:
            failures_12.append((i, r.status_code, r.text[:150]))
    total_ms = int((time.monotonic() - t0) * 1000)
    record("12. 20 sequential ~2MB — NO 5xx", not failures_12, max(codes_12), total_ms,
           f"fails={failures_12}" if failures_12 else f"codes={set(codes_12)}")

    r, ms = upload_image(tok, make_jpeg(500, 500), filename="café_photo😀.jpg")
    record("13. unicode filename -> 200", r.status_code == 200, r.status_code, ms,
           r.text[:120] if r.status_code != 200 else "")

    # ======== Group 3 ========
    print("\n=== Group 3: /api/spots/{id}/uploads ===")

    # find an approved spot via markers
    r = requests.get(f"{API}/spots/markers", timeout=15)
    spot_id = None
    if r.status_code == 200:
        data = r.json() or {}
        markers = data.get("items") if isinstance(data, dict) else data
        markers = markers or []
        for m in markers:
            if isinstance(m, dict) and m.get("spot_id"):
                spot_id = m["spot_id"]
                break
    spot_id = spot_id or "spot_6829d0a67f60"
    deleted_spot_id = "spot_f0857f702db9"
    print(f"Using spot_id: {spot_id}")

    # fresh uploaded URL
    r, _ = upload_image(tok, make_jpeg(800, 600), filename="reuse.jpg")
    reuse_url = r.json().get("image_url") if r.status_code == 200 else happy_url

    r, ms = post_spot_upload(tok, spot_id, [{"image_url": reuse_url, "caption": "one"}], caption="track-a-1")
    j = r.json() if r.status_code == 200 else {}
    record("15. 1 image auto_approved",
           r.status_code == 200 and j.get("auto_approved") is True and j.get("count") == 1,
           r.status_code, ms, f"{j}")

    imgs_5 = [{"image_url": reuse_url, "caption": f"c{i}"} for i in range(5)]
    r, ms = post_spot_upload(tok, spot_id, imgs_5, caption="track-a-5")
    j = r.json() if r.status_code == 200 else {}
    record("16. 5 images", r.status_code == 200 and j.get("count") == 5, r.status_code, ms, f"count={j.get('count')}")

    imgs_12 = [{"image_url": reuse_url, "caption": f"m{i}"} for i in range(12)]
    r, ms = post_spot_upload(tok, spot_id, imgs_12, caption="track-a-12")
    j = r.json() if r.status_code == 200 else {}
    record("17. 12 images (max)", r.status_code == 200 and j.get("count") == 12, r.status_code, ms, f"count={j.get('count')}")

    imgs_13 = [{"image_url": reuse_url} for _ in range(13)]
    r, ms = post_spot_upload(tok, spot_id, imgs_13)
    record("18. 13 images -> 400/422", r.status_code in (400, 422), r.status_code, ms, r.text[:120])

    r, ms = post_spot_upload(tok, spot_id, [])
    record("19. 0 images -> 400/422", r.status_code in (400, 422), r.status_code, ms, r.text[:120])

    r, ms = post_spot_upload(tok, "spot_nonexistent_xxx", [{"image_url": reuse_url}])
    record("20. nonexistent spot -> 404", r.status_code == 404, r.status_code, ms)

    r, ms = post_spot_upload(tok, deleted_spot_id, [{"image_url": reuse_url}])
    record("21. deleted spot -> 410", r.status_code == 410, r.status_code, ms, r.text[:120])

    r, ms = post_spot_upload(tok, spot_id, [{"image_url": "https://example.com/not-ours.jpg"}])
    record("22. external URL accepted (no validation)", r.status_code == 200, r.status_code, ms)

    def one_sub(i):
        return post_spot_upload(tok, spot_id, [{"image_url": reuse_url, "caption": f"conc{i}"}])
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        cres = [f.result() for f in [ex.submit(one_sub, i) for i in range(10)]]
    ccodes = [r.status_code for r, _ in cres]
    cmax = max(ms for _, ms in cres)
    record("23. 10 concurrent submits — NO 5xx",
           all(c < 500 for c in ccodes) and all(c == 200 for c in ccodes),
           max(ccodes), cmax, f"codes={ccodes}")

    # ======== Group 4 ========
    print("\n=== Group 4: post-upload state ===")

    r = requests.get(f"{API}/spots/{spot_id}/uploads?limit=24",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    j = r.json() if r.status_code == 200 else {}
    items = j.get("items") if isinstance(j, dict) else j
    if items is None and isinstance(j, list):
        items = j
    count = len(items) if isinstance(items, list) else -1
    record("24. GET /uploads has items", r.status_code == 200 and count > 0, r.status_code, 0, f"count={count}")

    r = requests.get(f"{API}/spots/{spot_id}",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    j = r.json() if r.status_code == 200 else {}
    lpa = j.get("latest_photo_at")
    record("25. latest_photo_at populated", r.status_code == 200 and lpa is not None, r.status_code, 0, f"lpa={lpa}")

    # ======== Group 5 ========
    print("\n=== Group 5: edge cases ===")

    r, ms = post_spot_upload(tok, spot_id, [{"image_url": reuse_url, "caption": "with-tags"}],
                              tags=["blooming", "verified_today"])
    record("26a. blooming+verified_today tags", r.status_code == 200, r.status_code, ms,
           r.text[:150] if r.status_code != 200 else "")

    r, ms = post_spot_upload(tok, spot_id, [{"image_url": reuse_url}], tags=[])
    record("26b. no tags baseline", r.status_code == 200, r.status_code, ms)

    codes27 = []
    fails27 = []
    t0 = time.monotonic()
    for i in range(20):
        r, ms = post_spot_upload(tok, spot_id, [{"image_url": reuse_url, "caption": f"rapid{i}"}])
        codes27.append(r.status_code)
        if r.status_code >= 500:
            fails27.append((i, r.status_code, r.text[:150]))
    total27 = int((time.monotonic() - t0) * 1000)
    record("27. rapid 20 sequential submits — NO 5xx",
           not fails27, max(codes27), total27,
           f"fails={fails27}" if fails27 else f"codes={set(codes27)}")

    # ======== Summary ========
    print("\n" + "=" * 78)
    total = len(RESULTS)
    passed = sum(1 for _, p, *_ in RESULTS if p)
    print(f"TOTAL: {total}  PASSED: {passed}  FAILED: {total - passed}")

    failed = [row for row in RESULTS if not row[1]]
    if failed:
        print("\n--- FAILURES ---")
        for name, _, code, ms, note in failed:
            print(f"  [{code}] {name} — {note[:200]}")

    any_5xx = [row for row in RESULTS if row[2] >= 500]
    print("\n--- 5XX SCAN ---")
    if any_5xx:
        for name, _, code, ms, note in any_5xx:
            print(f"  5XX {code}: {name} — {note[:200]}")
    else:
        print("  No 5xx responses observed across any test.")


if __name__ == "__main__":
    main()
