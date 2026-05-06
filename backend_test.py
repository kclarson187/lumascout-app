"""
Backend test for the May 2026 Profile Completion logic on LumaScout.

Tests GET /api/auth/me + PATCH /api/auth/me for:
  - profile_complete flag computation (5 required fields)
  - profile_completed_at sticky timestamp on first false→true transition
  - optional fields never gating the flag
  - URL validation positives + negatives
  - non-required fields untouched on completion
  - smoke-tests on /api/spots, /api/spots/markers, super-admin /me
"""

import sys
import time
import uuid
import requests
from datetime import datetime

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"

SUPER_ADMIN_EMAIL = "admin@lumascout.app"
SUPER_ADMIN_PW = "Grayson@1117!!"

results = []


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" :: {detail}" if detail else ""))
    results.append((name, ok, detail))


def auth_hdr(token):
    return {"Authorization": f"Bearer {token}"}


def register(email, password, name="Test User"):
    return requests.post(f"{API}/auth/register",
                         json={"email": email, "password": password, "name": name},
                         timeout=20)


def login(email, password):
    return requests.post(f"{API}/auth/login",
                         json={"email": email, "password": password}, timeout=20)


def get_me(token):
    return requests.get(f"{API}/auth/me", headers=auth_hdr(token), timeout=20)


def patch_me(token, body):
    return requests.patch(f"{API}/auth/me", headers=auth_hdr(token), json=body, timeout=20)


def is_iso_ts(s):
    if not isinstance(s, str):
        return False
    try:
        datetime.fromisoformat(s.replace("Z", "+00:00"))
        return True
    except Exception:
        return False


def make_email(prefix):
    return f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}@example.com"


PASSWORD = "TestPass123!"


def test_1_fresh_registration():
    email = make_email("pc_test")
    rr = register(email, PASSWORD, name="A")
    if rr.status_code != 200:
        record("1.0 register fresh user", False, f"HTTP {rr.status_code} body={rr.text[:300]}")
        return None, None
    record("1.0 register fresh user", True, f"email={email}")
    token = rr.json().get("token")
    if not token:
        record("1.0a token returned", False, str(rr.json()))
        return None, None

    me = get_me(token)
    if me.status_code != 200:
        record("1.1 GET /auth/me", False, f"HTTP {me.status_code} body={me.text[:300]}")
        return token, email
    body = me.json()
    record("1.1 GET /auth/me", True)

    pc = body.get("profile_complete")
    record("1.2 profile_complete === false", pc is False, f"got={pc!r}")
    pca = body.get("profile_completed_at")
    record("1.3 profile_completed_at is null/absent", pca in (None, ""), f"got={pca!r}")

    for k in ("user_id", "email", "name", "plan", "limits", "usage", "stats"):
        ok = k in body
        record(f"1.4.{k} present", ok, f"keys={list(body.keys())[:20]}" if not ok else "")

    return token, email


def test_2_single_patch_completion(token):
    full = {
        "name": "Test Photog",
        "website": "https://myportfolio.example/test",
        "city": "Austin",
        "state": "TX",
        "years_experience": 0,
    }
    p = patch_me(token, full)
    if p.status_code != 200:
        record("2.1 PATCH full required set", False, f"HTTP {p.status_code} body={p.text[:300]}")
        return None
    body = p.json()
    record("2.1 PATCH full required set", True)

    pc = body.get("profile_complete")
    record("2.2 response.profile_complete === true", pc is True, f"got={pc!r}")
    pca = body.get("profile_completed_at")
    pca_ok = is_iso_ts(pca)
    record("2.3 profile_completed_at is valid ISO timestamp", pca_ok, f"got={pca!r}")

    me = get_me(token)
    if me.status_code != 200:
        record("2.4 GET /auth/me persistence", False, f"HTTP {me.status_code}")
        return pca
    mbody = me.json()
    record("2.4 GET profile_complete still true", mbody.get("profile_complete") is True,
           f"got={mbody.get('profile_complete')!r}")
    pca2 = mbody.get("profile_completed_at")
    record("2.5 GET profile_completed_at persists", is_iso_ts(pca2), f"got={pca2!r}")
    return pca2


def test_3_years_zero(token):
    p = patch_me(token, {"years_experience": 0})
    if p.status_code != 200:
        record("3.1 PATCH years_experience=0", False, f"HTTP {p.status_code}")
        return
    pc = p.json().get("profile_complete")
    record("3.1 years_experience=0 keeps profile_complete=true", pc is True, f"got={pc!r}")


def test_4_optional_fields(token):
    p1 = patch_me(token, {"service_radius_miles": None, "booking_available": None})
    record("4.1 PATCH null optional fields", p1.status_code == 200, f"HTTP {p1.status_code}")
    if p1.status_code == 200:
        pc = p1.json().get("profile_complete")
        record("4.1a flag still true (nulls dropped)", pc is True, f"got={pc!r}")

    p2 = patch_me(token, {"specialties": []})
    record("4.2 PATCH specialties=[]", p2.status_code == 200, f"HTTP {p2.status_code}")
    if p2.status_code == 200:
        pc = p2.json().get("profile_complete")
        record("4.2a flag still true with empty specialties", pc is True, f"got={pc!r}")

    p3 = patch_me(token, {
        "instagram": "@me",
        "facebook_url": "https://fb.com/me",
        "tiktok_url": "https://tiktok.com/@me",
        "available_for_second_shooter": True,
        "mentorship_available": True,
        "service_radius_miles": 50,
        "booking_available": True,
    })
    record("4.3 PATCH full optional bundle", p3.status_code == 200, f"HTTP {p3.status_code}")
    if p3.status_code == 200:
        pc = p3.json().get("profile_complete")
        record("4.3a flag still true after optional bundle", pc is True, f"got={pc!r}")

    me = get_me(token)
    if me.status_code == 200:
        b = me.json()
        record("4.4 instagram persisted", b.get("instagram") == "@me", f"got={b.get('instagram')!r}")
        record("4.4 facebook_url persisted", b.get("facebook_url") == "https://fb.com/me",
               f"got={b.get('facebook_url')!r}")
        record("4.4 tiktok_url persisted", b.get("tiktok_url") == "https://tiktok.com/@me",
               f"got={b.get('tiktok_url')!r}")
        record("4.4 available_for_second_shooter persisted",
               b.get("available_for_second_shooter") is True,
               f"got={b.get('available_for_second_shooter')!r}")
        record("4.4 mentorship_available persisted", b.get("mentorship_available") is True,
               f"got={b.get('mentorship_available')!r}")
        record("4.4 service_radius_miles persisted", b.get("service_radius_miles") == 50,
               f"got={b.get('service_radius_miles')!r}")
        record("4.4 booking_available persisted", b.get("booking_available") is True,
               f"got={b.get('booking_available')!r}")


def test_5_invalid_fields(token):
    p = patch_me(token, {"name": "A"})
    record("5a PATCH name=A (1 char)", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5a profile_complete=false after 1-char name", pc is False, f"got={pc!r}")

    p = patch_me(token, {"name": "Test Photog", "website": "not-a-url"})
    record("5b PATCH website=not-a-url", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5b profile_complete=false after invalid url", pc is False, f"got={pc!r}")

    p = patch_me(token, {"website": "https://myportfolio.example/test", "city": ""})
    record("5c PATCH city=''", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5c profile_complete=false after empty city", pc is False, f"got={pc!r}")

    p = patch_me(token, {"city": "Austin", "state": ""})
    record("5d PATCH state=''", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5d profile_complete=false after empty state", pc is False, f"got={pc!r}")

    p = patch_me(token, {"state": "TX", "years_experience": -1})
    record("5e PATCH years_experience=-1", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5e profile_complete=false after negative years", pc is False, f"got={pc!r}")

    p = patch_me(token, {"years_experience": None})
    record("5e2 PATCH years_experience=null no-crash", p.status_code == 200,
           f"HTTP {p.status_code} body={p.text[:200] if p.status_code != 200 else ''}")

    p = patch_me(token, {
        "name": "Test Photog",
        "website": "https://myportfolio.example/test",
        "city": "Austin",
        "state": "TX",
        "years_experience": 0,
    })
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("5.restore profile_complete=true after re-completing", pc is True, f"got={pc!r}")
    else:
        record("5.restore PATCH full required", False, f"HTTP {p.status_code}")


def test_6_sticky_timestamp(token, original_ts):
    me = get_me(token)
    if me.status_code != 200:
        record("6.1 GET /auth/me", False, f"HTTP {me.status_code}")
        return
    pca_now = me.json().get("profile_completed_at")
    record("6.1 profile_completed_at unchanged across re-completions",
           pca_now == original_ts,
           f"original={original_ts!r} now={pca_now!r}")


def test_7_existing_user_safety():
    email = make_email("safety_test")
    rr = register(email, PASSWORD, name="X")
    if rr.status_code != 200:
        record("7.0 register safety user", False, f"HTTP {rr.status_code} body={rr.text[:300]}")
        return
    record("7.0 register safety user", True, f"email={email}")
    token = rr.json().get("token")

    p = patch_me(token, {
        "avatar_url": "https://example.com/a.jpg",
        "bio": "hi",
        "language_hint": "es",
        "timezone": "America/Chicago",
    })
    record("7.1 PATCH non-required pre-completion", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code == 200:
        pc = p.json().get("profile_complete")
        record("7.1a profile_complete still false", pc is False, f"got={pc!r}")

    p = patch_me(token, {
        "name": "Safety Tester",
        "website": "https://safety.example.com",
        "city": "San Antonio",
        "state": "TX",
        "years_experience": 5,
    })
    if p.status_code != 200:
        record("7.2 PATCH 5 required fields", False, f"HTTP {p.status_code}")
        return
    pc = p.json().get("profile_complete")
    record("7.2 profile_complete=true after completion", pc is True, f"got={pc!r}")

    me = get_me(token)
    if me.status_code != 200:
        record("7.3 GET /auth/me", False, f"HTTP {me.status_code}")
        return
    b = me.json()
    record("7.3 avatar_url preserved", b.get("avatar_url") == "https://example.com/a.jpg",
           f"got={b.get('avatar_url')!r}")
    record("7.3 bio preserved", b.get("bio") == "hi", f"got={b.get('bio')!r}")
    record("7.3 language_hint preserved", b.get("language_hint") == "es",
           f"got={b.get('language_hint')!r}")
    record("7.3 timezone preserved", b.get("timezone") == "America/Chicago",
           f"got={b.get('timezone')!r}")


def test_8_no_clobber():
    email = make_email("clobber_test")
    rr = register(email, PASSWORD, name="Z")
    if rr.status_code != 200:
        record("8.0 register clobber user", False, f"HTTP {rr.status_code}")
        return
    token = rr.json().get("token")

    initial = {
        "name": "Initial Name",
        "website": "https://portfolio.example.com",
        "city": "Dallas",
        "state": "TX",
        "years_experience": 3,
        "instagram": "@dallas_shooter",
        "facebook_url": "https://fb.com/x",
        "service_radius_miles": 25,
    }
    p = patch_me(token, initial)
    if p.status_code != 200:
        record("8.1 PATCH initial bundle", False, f"HTTP {p.status_code}")
        return
    record("8.1 PATCH initial bundle", True)

    p = patch_me(token, {"name": "New Name"})
    record("8.2 PATCH name only", p.status_code == 200, f"HTTP {p.status_code}")
    if p.status_code != 200:
        return

    me = get_me(token)
    b = me.json()
    record("8.3 name updated", b.get("name") == "New Name", f"got={b.get('name')!r}")
    record("8.3 website unchanged", b.get("website") == initial["website"],
           f"got={b.get('website')!r}")
    record("8.3 city unchanged", b.get("city") == initial["city"], f"got={b.get('city')!r}")
    record("8.3 state unchanged", b.get("state") == initial["state"], f"got={b.get('state')!r}")
    record("8.3 years_experience unchanged",
           b.get("years_experience") == initial["years_experience"],
           f"got={b.get('years_experience')!r}")
    record("8.3 instagram unchanged", b.get("instagram") == initial["instagram"],
           f"got={b.get('instagram')!r}")
    record("8.3 facebook_url unchanged", b.get("facebook_url") == initial["facebook_url"],
           f"got={b.get('facebook_url')!r}")
    record("8.3 service_radius_miles unchanged",
           b.get("service_radius_miles") == initial["service_radius_miles"],
           f"got={b.get('service_radius_miles')!r}")
    record("8.4 profile_complete still true after partial PATCH",
           b.get("profile_complete") is True, f"got={b.get('profile_complete')!r}")


def test_9_url_validation():
    email = make_email("url_test")
    rr = register(email, PASSWORD, name="U")
    if rr.status_code != 200:
        record("9.0 register url user", False, f"HTTP {rr.status_code}")
        return
    token = rr.json().get("token")

    base = {"name": "URL Tester", "city": "Houston", "state": "TX", "years_experience": 1}
    p = patch_me(token, base)
    if p.status_code != 200:
        record("9.0a PATCH base", False, f"HTTP {p.status_code}")
        return

    accepted = [
        "https://myportfolio.com",
        "https://www.instagram.com/username",
        "https://portfolio.adobe.com/example",
        "http://example.org",
    ]
    rejected = [
        "myportfolio.com",
        "https://",
        "",
    ]

    for url in accepted:
        p = patch_me(token, {"website": url})
        if p.status_code != 200:
            record(f"9.acc PATCH website={url!r}", False, f"HTTP {p.status_code}")
            continue
        pc = p.json().get("profile_complete")
        record(f"9.acc accepts {url!r}", pc is True, f"got={pc!r}")

    for url in rejected:
        p = patch_me(token, {"website": url})
        if p.status_code != 200:
            record(f"9.rej PATCH website={url!r}", False, f"HTTP {p.status_code}")
            continue
        pc = p.json().get("profile_complete")
        record(f"9.rej rejects {url!r}", pc is False, f"got={pc!r}")


def test_10_smoke():
    r = requests.get(f"{API}/spots", params={"limit": 5}, timeout=20)
    record("10.1 GET /api/spots?limit=5 -> 200", r.status_code == 200, f"HTTP {r.status_code}")

    r = requests.get(f"{API}/spots/markers",
                     params={"sw_lat": -90, "sw_lng": -180, "ne_lat": 90, "ne_lng": 180,
                             "limit": 50}, timeout=20)
    record("10.2 GET /api/spots/markers -> 200", r.status_code == 200, f"HTTP {r.status_code}")

    sl = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PW)
    record("10.3 super admin login -> 200", sl.status_code == 200,
           f"HTTP {sl.status_code} body={sl.text[:300] if sl.status_code != 200 else ''}")
    if sl.status_code != 200:
        return
    sbody = sl.json()
    token = sbody.get("token")
    me = get_me(token)
    record("10.4 super admin /auth/me -> 200", me.status_code == 200, f"HTTP {me.status_code}")
    if me.status_code == 200:
        b = me.json()
        record("10.4a super admin /auth/me has profile_complete key",
               "profile_complete" in b, f"value={b.get('profile_complete')!r}")
        record("10.4b super admin /auth/me has profile_completed_at key",
               "profile_completed_at" in b, f"value={b.get('profile_completed_at')!r}")


if __name__ == "__main__":
    print(f"Testing {API}")
    print("=" * 70)

    token, email = test_1_fresh_registration()
    original_ts = None
    if token:
        original_ts = test_2_single_patch_completion(token)
        test_3_years_zero(token)
        test_4_optional_fields(token)
        test_5_invalid_fields(token)
        if original_ts:
            test_6_sticky_timestamp(token, original_ts)
    test_7_existing_user_safety()
    test_8_no_clobber()
    test_9_url_validation()
    test_10_smoke()

    print("=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"PASSED: {passed}/{len(results)}   FAILED: {failed}")
    if failed:
        print("\nFAILURES:")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name} :: {detail}")
        sys.exit(1)
    sys.exit(0)
