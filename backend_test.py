"""
backend_test.py — Feature 4 (Public Client-Share + Owner Visibility + Owner/Admin
Spot Edits) endpoint validation in /app/backend/routes/spot_shares.py.

Targets the public preview backend exclusively via EXPO_PUBLIC_BACKEND_URL
(read from /app/frontend/.env), per testing protocol.
"""
from __future__ import annotations

import json
import re
import secrets
import string
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

# ─── Configuration ────────────────────────────────────────────────────────────
FRONTEND_ENV = "/app/frontend/.env"


def _read_env_var(path: str, key: str) -> Optional[str]:
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


BACKEND_URL = (
    _read_env_var(FRONTEND_ENV, "EXPO_PUBLIC_BACKEND_URL")
    or _read_env_var(FRONTEND_ENV, "REACT_APP_BACKEND_URL")
    or "https://photo-finder-60.preview.emergentagent.com"
).rstrip("/")
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL_PRIMARY = "kclarson187@gmail.com"
ADMIN_PASSWORD_PRIMARY = "Pass123!"
ADMIN_EMAIL_FALLBACK = "admin@lumascout.app"
ADMIN_PASSWORD_FALLBACK = "Grayson@1117!!"

SPOT_LAT = 30.5
SPOT_LNG = -98.5


class Results:
    def __init__(self):
        self.tests: List[Tuple[str, bool, str]] = []

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.tests.append((name, ok, detail))
        marker = "PASS" if ok else "FAIL"
        print(f"[{marker}] {name}" + (f" — {detail}" if detail else ""))

    def summarize(self) -> int:
        passed = sum(1 for _, ok, _ in self.tests if ok)
        failed = len(self.tests) - passed
        print("\n" + "=" * 72)
        print(f"SUMMARY: {passed} passed / {failed} failed / {len(self.tests)} total")
        for n, ok, d in self.tests:
            if not ok:
                print(f"  - FAIL: {n} — {d}")
        return failed


R = Results()


def _api(path: str) -> str:
    return f"{API}{path}"


def _hdrs(token: Optional[str] = None, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if extra:
        h.update(extra)
    return h


def _safe_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"_raw_text": resp.text[:500]}


def login(email: str, password: str) -> Optional[str]:
    r = requests.post(_api("/auth/login"), json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    body = r.json()
    return body.get("token") or body.get("access_token")


def register(email: str, password: str, name: str) -> Optional[str]:
    r = requests.post(
        _api("/auth/register"),
        json={"email": email, "password": password, "name": name},
        timeout=30,
    )
    if r.status_code != 200:
        return login(email, password)
    body = r.json()
    return body.get("token") or body.get("access_token")


def me(token: str) -> Dict[str, Any]:
    r = requests.get(_api("/auth/me"), headers=_hdrs(token), timeout=30)
    r.raise_for_status()
    return r.json()


def random_email() -> str:
    rnd = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(10))
    return f"flake_{rnd}@example.com"


def create_spot(token: str, **overrides) -> Dict[str, Any]:
    tiny_png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    )
    image_url = f"data:image/png;base64,{tiny_png_b64}"
    payload: Dict[str, Any] = {
        "title": "LumaScout E2E Spot",
        "description": "Backend test fixture — Feature 4 share verification.",
        "latitude": SPOT_LAT,
        "longitude": SPOT_LNG,
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "location_display_mode": "exact",
        "shoot_types": ["landscape"],
        "style_tags": ["golden_hour"],
        "best_time_of_day": "sunrise",
        "images": [{"image_url": image_url, "caption": "test", "is_cover": True}],
    }
    payload.update(overrides)
    r = requests.post(_api("/spots"), json=payload, headers=_hdrs(token), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"create_spot failed: {r.status_code} — {r.text[:400]}")
    return r.json()


def main():
    print(f"Backend base URL: {BACKEND_URL}")
    print(f"API root:         {API}\n")

    # Setup phase
    print("--- Setup ---")
    admin_token = login(ADMIN_EMAIL_PRIMARY, ADMIN_PASSWORD_PRIMARY)
    if not admin_token:
        print(f"Primary super-admin login failed; falling back to seed admin {ADMIN_EMAIL_FALLBACK}")
        admin_token = login(ADMIN_EMAIL_FALLBACK, ADMIN_PASSWORD_FALLBACK)
    if not admin_token:
        R.add("setup.admin_login", False, "Both admin credentials failed")
        return R.summarize()
    R.add("setup.admin_login", True, "admin authenticated")

    owner_email = random_email()
    owner_pass = "OwnerPass123!"
    owner_token = register(owner_email, owner_pass, "Photog Owner")
    if not owner_token:
        R.add("setup.owner_register", False, f"could not register {owner_email}")
        return R.summarize()
    owner = me(owner_token)
    owner_id = owner.get("user_id")
    R.add("setup.owner_register", bool(owner_id), f"owner user_id={owner_id}")

    stranger_email = random_email()
    stranger_pass = "StrangerPass123!"
    stranger_token = register(stranger_email, stranger_pass, "Stranger Stalker")
    if not stranger_token:
        R.add("setup.stranger_register", False, f"could not register {stranger_email}")
        return R.summarize()
    R.add("setup.stranger_register", True, f"stranger {stranger_email}")

    try:
        spot_a = create_spot(
            owner_token,
            title="LumaScout E2E Public Spot",
            privacy_mode="public",
            location_display_mode="exact",
        )
        spot_a_id = spot_a.get("spot_id")
        R.add("setup.create_spot_a_public", bool(spot_a_id), f"spot_id={spot_a_id}")
    except Exception as e:
        R.add("setup.create_spot_a_public", False, str(e))
        return R.summarize()

    try:
        spot_b = create_spot(
            owner_token,
            title="LumaScout E2E Private Spot",
            privacy_mode="private",
            location_display_mode="approximate",
        )
        spot_b_id = spot_b.get("spot_id")
        R.add("setup.create_spot_b_private", bool(spot_b_id), f"spot_id={spot_b_id}")
    except Exception as e:
        R.add("setup.create_spot_b_private", False, str(e))
        return R.summarize()

    for spid in (spot_a_id, spot_b_id):
        ra = requests.post(_api(f"/admin/spots/{spid}/approve"), headers=_hdrs(admin_token), timeout=30)
        if ra.status_code != 200:
            R.add(f"setup.approve_{spid}", False, f"{ra.status_code} {ra.text[:200]}")
        else:
            R.add(f"setup.approve_{spid}", True, "approved")

    # ─── TEST 1
    print("\n--- Test 1: Share token generation (CSPRNG) ---")
    r1a = requests.post(
        _api(f"/spots/{spot_a_id}/share"),
        json={"label": "client A"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if r1a.status_code != 200:
        R.add("t1.share_first", False, f"{r1a.status_code} {r1a.text[:300]}")
        return R.summarize()
    b1a = r1a.json()
    token1 = b1a.get("token")
    label_ok = b1a.get("label") == "client A"
    revoked_ok = b1a.get("revoked") is False
    has_share_id = bool(b1a.get("share_id"))
    has_share_url = bool(b1a.get("share_url"))
    ok = bool(token1) and label_ok and revoked_ok and has_share_id and has_share_url
    R.add("t1.share_first.fields", ok, f"keys={sorted(b1a.keys())}")

    token_re = re.compile(r"^[A-Za-z0-9_-]{32}$")
    R.add("t1.token_format_32_urlsafe", bool(token1 and token_re.match(token1)), f"token={token1}")

    url_ok = bool(b1a.get("share_url") and "/api/public/location/" in b1a["share_url"] and token1 in b1a["share_url"])
    R.add("t1.share_url_contains_token", url_ok, b1a.get("share_url", ""))

    r1b = requests.post(
        _api(f"/spots/{spot_a_id}/share"),
        json={"label": "client B"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if r1b.status_code != 200:
        R.add("t1.share_second", False, f"{r1b.status_code} {r1b.text[:300]}")
        return R.summarize()
    token2 = r1b.json().get("token")
    R.add(
        "t1.csprng_tokens_differ",
        bool(token2) and token2 != token1 and bool(token_re.match(token2 or "")),
        f"token1={token1} token2={token2}",
    )

    # ─── TEST 2
    print("\n--- Test 2: Permission boundaries ---")
    rs1 = requests.post(_api(f"/spots/{spot_a_id}/share"), json={}, headers=_hdrs(stranger_token), timeout=30)
    R.add("t2.stranger.create_share_403", rs1.status_code == 403, f"{rs1.status_code} {rs1.text[:150]}")

    rs2 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "private"},
        headers=_hdrs(stranger_token),
        timeout=30,
    )
    R.add("t2.stranger.patch_visibility_403", rs2.status_code == 403, f"{rs2.status_code}")

    rs3 = requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"title": "Hijacked"},
        headers=_hdrs(stranger_token),
        timeout=30,
    )
    R.add("t2.stranger.patch_info_403", rs3.status_code == 403, f"{rs3.status_code}")

    rs4 = requests.delete(
        _api(f"/spots/{spot_a_id}/share/{token1}"),
        headers=_hdrs(stranger_token),
        timeout=30,
    )
    R.add("t2.stranger.delete_share_403", rs4.status_code == 403, f"{rs4.status_code}")

    ra2 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "public"},
        headers=_hdrs(admin_token),
        timeout=30,
    )
    R.add("t2.admin.patch_visibility_ok", ra2.status_code == 200, f"{ra2.status_code} {ra2.text[:200]}")

    ra3 = requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"notes": "admin annotation"},
        headers=_hdrs(admin_token),
        timeout=30,
    )
    R.add("t2.admin.patch_info_ok", ra3.status_code == 200, f"{ra3.status_code}")

    # ─── TEST 3
    print("\n--- Test 3: GET /spots/{id}/shares ---")
    rg = requests.get(_api(f"/spots/{spot_a_id}/shares"), headers=_hdrs(owner_token), timeout=30)
    if rg.status_code != 200:
        R.add("t3.owner_list", False, f"{rg.status_code} {rg.text[:300]}")
    else:
        body = rg.json()
        items = body.get("items") or []
        tokens_in_list = {it.get("token") for it in items}
        ok_t = token1 in tokens_in_list and token2 in tokens_in_list
        first_item = items[0] if items else {}
        required_keys = {"token", "share_url", "label", "revoked", "created_at"}
        keys_ok = required_keys.issubset(set(first_item.keys())) if first_item else False
        R.add(
            "t3.owner_list_contains_both_tokens",
            ok_t and keys_ok,
            f"items={len(items)} tokens_present={ok_t} keys_ok={keys_ok}",
        )

    rg_str = requests.get(_api(f"/spots/{spot_a_id}/shares"), headers=_hdrs(stranger_token), timeout=30)
    R.add("t3.stranger_list_403", rg_str.status_code == 403, f"{rg_str.status_code}")

    # ─── TEST 4
    print("\n--- Test 4: PATCH /visibility ---")
    rv1 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "private"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if rv1.status_code != 200:
        R.add("t4.private_default_approx", False, f"{rv1.status_code} {rv1.text[:200]}")
    else:
        b = rv1.json()
        ok_v = (
            b.get("visibility") == "private"
            and b.get("show_exact_location") is False
            and b.get("location_display_mode") == "approximate"
        )
        R.add(
            "t4.private_default_approx",
            ok_v,
            json.dumps({k: b.get(k) for k in ("visibility", "show_exact_location", "location_display_mode")}),
        )

    rv2 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "private", "show_exact_location": True},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if rv2.status_code != 200:
        R.add("t4.private_exact", False, f"{rv2.status_code} {rv2.text[:200]}")
    else:
        b = rv2.json()
        ok_v = b.get("location_display_mode") == "exact" and b.get("show_exact_location") is True
        R.add(
            "t4.private_exact",
            ok_v,
            json.dumps({k: b.get(k) for k in ("show_exact_location", "location_display_mode")}),
        )

    rv3 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "public"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if rv3.status_code != 200:
        R.add("t4.public_resets", False, f"{rv3.status_code} {rv3.text[:200]}")
    else:
        b = rv3.json()
        ok_v = (
            b.get("visibility") == "public"
            and b.get("privacy_mode") == "public"
            and b.get("location_display_mode") == "exact"
        )
        R.add(
            "t4.public_resets",
            ok_v,
            json.dumps({k: b.get(k) for k in ("visibility", "privacy_mode", "location_display_mode")}),
        )

    rv4 = requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "invalid"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    R.add("t4.invalid_visibility_422", rv4.status_code == 422, f"{rv4.status_code}")

    # ─── TEST 5
    print("\n--- Test 5: PATCH /info whitelist ---")
    ri1 = requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"title": "Renamed by owner", "notes": "Owner edit test"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if ri1.status_code != 200:
        R.add("t5.owner_patch_allowed_fields", False, f"{ri1.status_code} {ri1.text[:200]}")
    else:
        b = ri1.json()
        uf = set(b.get("updated_fields") or [])
        ok_v = "title" in uf and "notes" in uf
        R.add("t5.owner_patch_allowed_fields", ok_v, f"updated_fields={sorted(uf)}")

    rget = requests.get(_api(f"/spots/{spot_a_id}"), headers=_hdrs(owner_token), timeout=30)
    if rget.status_code == 200:
        b = rget.json()
        ok_v = b.get("title") == "Renamed by owner" and b.get("notes") == "Owner edit test"
        R.add("t5.spot_reflects_changes", ok_v, f"title={b.get('title')!r} notes={b.get('notes')!r}")
    else:
        R.add("t5.spot_reflects_changes", False, f"{rget.status_code} {rget.text[:200]}")

    ri2 = requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"owner_user_id": "hijack", "visibility_status": "approved", "title": "x"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    if ri2.status_code != 400:
        R.add("t5.banned_keys_400", False, f"{ri2.status_code} {ri2.text[:200]}")
    else:
        det = (ri2.json() or {}).get("detail", "")
        has_msg = "Fields not editable here" in det
        has_owner = "owner_user_id" in det
        has_vstat = "visibility_status" in det
        R.add(
            "t5.banned_keys_400_message",
            has_msg and has_owner and has_vstat,
            det,
        )

    ri3 = requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"owner_user_id": "hijack2", "visibility_status": "approved", "title": "x"},
        headers=_hdrs(admin_token),
        timeout=30,
    )
    R.add("t5.admin_banned_keys_400", ri3.status_code == 400, f"{ri3.status_code} {ri3.text[:150]}")

    requests.patch(
        _api(f"/spots/{spot_a_id}/info"),
        json={"title": "LumaScout E2E Public Spot"},
        headers=_hdrs(owner_token),
        timeout=30,
    )

    # ─── TEST 6
    print("\n--- Test 6: Public sanitized view (PUBLIC spot) ---")
    requests.patch(
        _api(f"/spots/{spot_a_id}/visibility"),
        json={"visibility": "public"},
        headers=_hdrs(owner_token),
        timeout=30,
    )

    r_share = requests.post(_api(f"/spots/{spot_a_id}/share"), json={}, headers=_hdrs(owner_token), timeout=30)
    if r_share.status_code != 200:
        R.add("t6.mint_token", False, f"{r_share.status_code} {r_share.text[:200]}")
        return R.summarize()
    public_token_a = r_share.json().get("token")
    R.add("t6.mint_token", bool(public_token_a), public_token_a or "")

    rp = requests.get(_api(f"/spots/shared/{public_token_a}"), timeout=30)
    if rp.status_code != 200:
        R.add("t6.public_get", False, f"{rp.status_code} {rp.text[:200]}")
    else:
        b = rp.json()
        spot_block = b.get("spot") or {}
        og = b.get("og") or {}
        shared_by = b.get("shared_by") or {}

        checks = {
            "status_ok": b.get("status") == "ok",
            "visibility_public": b.get("visibility") == "public",
            "show_exact_true": b.get("show_exact_location") is True,
            "precision_exact": b.get("coord_precision") == "exact",
            "robots_index": b.get("robots") == "index,follow",
            "lat_exact": spot_block.get("latitude") == SPOT_LAT,
            "lng_exact": spot_block.get("longitude") == SPOT_LNG,
            "title_present": bool(spot_block.get("title")),
            "images_present": bool(spot_block.get("images")),
            "hero_present": bool(spot_block.get("hero_image_url")),
            "shared_by_display_name": shared_by.get("display_name") == "A LumaScout photographer",
            "og_title_is_spot_title": og.get("title") == spot_block.get("title"),
            "og_image_is_hero": og.get("image") == spot_block.get("hero_image_url"),
        }
        failures = [k for k, v in checks.items() if not v]
        R.add("t6.public_sanitized_fields", not failures, f"failed={failures} body_keys={sorted(b.keys())}")

        forbidden = ("owner_user_id", "email", "password_hash", "phone", "visibility_status")

        def walk_assert_clean(obj, path="$") -> List[str]:
            bad = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k in forbidden:
                        bad.append(f"{path}.{k}")
                    bad.extend(walk_assert_clean(v, f"{path}.{k}"))
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    bad.extend(walk_assert_clean(v, f"{path}[{i}]"))
            return bad

        leaks = walk_assert_clean(b)
        R.add("t6.no_internal_field_leak", not leaks, f"leaks={leaks}")

    # ─── TEST 7
    print("\n--- Test 7: PRIVATE spot default approximate ---")
    rv = requests.patch(
        _api(f"/spots/{spot_b_id}/visibility"),
        json={"visibility": "private"},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    R.add("t7.set_private_default", rv.status_code == 200, f"{rv.status_code}")

    r_share_b = requests.post(_api(f"/spots/{spot_b_id}/share"), json={}, headers=_hdrs(owner_token), timeout=30)
    token_b = r_share_b.json().get("token") if r_share_b.status_code == 200 else None
    R.add("t7.mint_token_b", bool(token_b), token_b or "")

    rp7 = requests.get(_api(f"/spots/shared/{token_b}"), timeout=30) if token_b else None
    if not rp7 or rp7.status_code != 200:
        R.add("t7.public_get_private", False, f"{rp7.status_code if rp7 else 'no token'}")
    else:
        b = rp7.json()
        spot_block = b.get("spot") or {}
        og = b.get("og") or {}
        lat = spot_block.get("latitude")
        lng = spot_block.get("longitude")

        rounded_lat_ok = (isinstance(lat, (int, float)) and lat == round(SPOT_LAT, 2))
        rounded_lng_ok = (isinstance(lng, (int, float)) and lng == round(SPOT_LNG, 2))

        checks = {
            "visibility_private": b.get("visibility") == "private",
            "show_exact_false": b.get("show_exact_location") is False,
            "precision_approx": b.get("coord_precision") == "approximate",
            "robots_noindex": b.get("robots") == "noindex",
            "lat_rounded": rounded_lat_ok,
            "lng_rounded": rounded_lng_ok,
            "og_title_generic": og.get("title") == "Photo location · LumaScout",
            "og_image_generic": "social-card.png" in (og.get("image") or ""),
            "title_still_in_body": bool(spot_block.get("title")),
        }
        failures = [k for k, v in checks.items() if not v]
        R.add("t7.private_default_sanitized", not failures, f"failed={failures} og={og}")

    # ─── TEST 8
    print("\n--- Test 8: PRIVATE + show_exact_location=true ---")
    rv8 = requests.patch(
        _api(f"/spots/{spot_b_id}/visibility"),
        json={"visibility": "private", "show_exact_location": True},
        headers=_hdrs(owner_token),
        timeout=30,
    )
    R.add("t8.set_private_exact", rv8.status_code == 200, f"{rv8.status_code}")

    if token_b:
        rp8 = requests.get(_api(f"/spots/shared/{token_b}"), timeout=30)
        if rp8.status_code != 200:
            R.add("t8.public_get_private_exact", False, f"{rp8.status_code}")
        else:
            b = rp8.json()
            sb = b.get("spot") or {}
            og = b.get("og") or {}
            checks = {
                "coord_precision_exact": b.get("coord_precision") == "exact",
                "lat_exact": sb.get("latitude") == SPOT_LAT,
                "lng_exact": sb.get("longitude") == SPOT_LNG,
                "robots_noindex": b.get("robots") == "noindex",
                "og_title_generic": og.get("title") == "Photo location · LumaScout",
                "og_image_generic": "social-card.png" in (og.get("image") or ""),
            }
            fails = [k for k, v in checks.items() if not v]
            R.add("t8.private_exact_sanitized", not fails, f"failed={fails} og={og}")

    # ─── TEST 9
    print("\n--- Test 9: Unavailable parity (CRITICAL) ---")
    expected_body = {
        "status": "unavailable",
        "reason": "unavailable",
        "message": "This share link is no longer available. Ask the photographer for a new one.",
    }

    bodies: Dict[str, Tuple[Optional[int], Any, str]] = {}

    def mint_for(spot_id: str, owner_tok: str) -> Optional[str]:
        rr = requests.post(_api(f"/spots/{spot_id}/share"), json={}, headers=_hdrs(owner_tok), timeout=30)
        if rr.status_code == 200:
            return rr.json().get("token")
        return None

    spot_c_id = create_spot(owner_token, title="LumaScout E2E Spot C").get("spot_id")
    spot_d_id = create_spot(owner_token, title="LumaScout E2E Spot D").get("spot_id")
    spot_e_id = create_spot(owner_token, title="LumaScout E2E Spot E").get("spot_id")
    for sid in (spot_c_id, spot_d_id, spot_e_id):
        requests.post(_api(f"/admin/spots/{sid}/approve"), headers=_hdrs(admin_token), timeout=30)

    ra = requests.get(
        _api("/spots/shared/totally_made_up_garbage_xyz"),
        headers={"Accept": "application/json"},
        timeout=30,
    )
    bodies["a_never_existed"] = (ra.status_code, _safe_json(ra), ra.headers.get("content-type", ""))

    tok_b_case = mint_for(spot_a_id, owner_token)
    if tok_b_case:
        requests.delete(_api(f"/spots/{spot_a_id}/share/{tok_b_case}"), headers=_hdrs(owner_token), timeout=30)
        rb = requests.get(_api(f"/spots/shared/{tok_b_case}"), headers={"Accept": "application/json"}, timeout=30)
        bodies["b_revoked"] = (rb.status_code, _safe_json(rb), rb.headers.get("content-type", ""))
    else:
        bodies["b_revoked"] = (None, {"error": "could not mint token"}, "")

    tok_c = mint_for(spot_c_id, owner_token)
    if tok_c:
        requests.delete(_api(f"/spots/{spot_c_id}"), headers=_hdrs(owner_token), timeout=30)
        rc = requests.get(_api(f"/spots/shared/{tok_c}"), headers={"Accept": "application/json"}, timeout=30)
        bodies["c_deleted_spot"] = (rc.status_code, _safe_json(rc), rc.headers.get("content-type", ""))
    else:
        bodies["c_deleted_spot"] = (None, {"error": "could not mint token"}, "")

    tok_d = mint_for(spot_d_id, owner_token)
    if tok_d:
        rrej = requests.post(_api(f"/admin/spots/{spot_d_id}/reject"), headers=_hdrs(admin_token), timeout=30)
        if rrej.status_code != 200:
            R.add("t9.admin_reject_spot", False, f"{rrej.status_code} {rrej.text[:200]}")
        rd = requests.get(_api(f"/spots/shared/{tok_d}"), headers={"Accept": "application/json"}, timeout=30)
        bodies["d_rejected_spot"] = (rd.status_code, _safe_json(rd), rd.headers.get("content-type", ""))
    else:
        bodies["d_rejected_spot"] = (None, {"error": "could not mint token"}, "")

    tok_e = mint_for(spot_e_id, owner_token)
    if tok_e:
        rsus = requests.post(
            _api(f"/admin/users/{owner_id}/sanction"),
            json={"type": "suspend", "reason": "Backend test — verify suspended-owner share unavailability", "duration_days": 1},
            headers=_hdrs(admin_token),
            timeout=30,
        )
        if rsus.status_code != 200:
            R.add("t9.suspend_owner_admin", False, f"{rsus.status_code} {rsus.text[:200]}")
        else:
            R.add("t9.suspend_owner_admin", True, "owner suspended")
        re_get = requests.get(_api(f"/spots/shared/{tok_e}"), headers={"Accept": "application/json"}, timeout=30)
        bodies["e_suspended_owner"] = (re_get.status_code, _safe_json(re_get), re_get.headers.get("content-type", ""))
    else:
        bodies["e_suspended_owner"] = (None, {"error": "could not mint token"}, "")

    parity_failures = []
    for k, (code, body, ctype) in bodies.items():
        if code != 404:
            parity_failures.append(f"{k}: status {code} (expected 404)")
        if "application/json" not in (ctype or "").lower():
            parity_failures.append(f"{k}: content-type={ctype!r}")
        if body != expected_body:
            parity_failures.append(f"{k}: body diff: {body}")

    R.add(
        "t9.unavailable_parity_all5_identical",
        not parity_failures,
        ("\n" + "\n".join(parity_failures)) if parity_failures else "all 5 returned identical 404+JSON body",
    )
    print("\nAll 5 unavailable case bodies:")
    for k, (code, body, ctype) in bodies.items():
        print(f"  {k}: status={code} ctype={ctype!r} body={body}")

    # Restore owner
    try:
        requests.post(
            _api(f"/admin/users/{owner_id}/unsanction"),
            headers=_hdrs(admin_token),
            timeout=30,
        )
    except Exception:
        pass

    # ─── TEST 10
    print("\n--- Test 10: GET /public/location/{token} HTML + JSON parity ---")
    rJ = requests.get(
        _api(f"/public/location/{public_token_a}"),
        headers={"Accept": "application/json"},
        timeout=30,
    )
    json_ok = rJ.status_code == 200 and "application/json" in rJ.headers.get("content-type", "").lower()
    if json_ok:
        b = rJ.json()
        json_keys = {"status", "visibility", "show_exact_location", "coord_precision", "robots", "spot", "og"}
        json_ok = json_keys.issubset(set(b.keys()))
    R.add("t10.html_endpoint_returns_json_on_accept", json_ok, f"status={rJ.status_code} ct={rJ.headers.get('content-type')}")

    rH = requests.get(_api(f"/public/location/{public_token_a}"), headers={"Accept": "text/html"}, timeout=30)
    ct = rH.headers.get("content-type", "").lower()
    html_text = rH.text
    html_ok = (
        rH.status_code == 200
        and "text/html" in ct
        and '<meta name="robots" content="index,follow"' in html_text
    )
    R.add("t10.html_response_has_robots_index", html_ok, f"status={rH.status_code} ct={ct}")

    if token_b:
        rHp = requests.get(_api(f"/public/location/{token_b}"), headers={"Accept": "text/html"}, timeout=30)
        ok_v = (
            rHp.status_code == 200
            and "text/html" in rHp.headers.get("content-type", "").lower()
            and '<meta name="robots" content="noindex"' in rHp.text
        )
        R.add("t10.html_private_robots_noindex", ok_v, f"status={rHp.status_code}")

    rHU = requests.get(_api("/public/location/photo-finder-60"), headers={"Accept": "text/html"}, timeout=30)
    ok_v = (
        rHU.status_code == 404
        and "text/html" in rHU.headers.get("content-type", "").lower()
        and ("Link unavailable" in rHU.text or "no longer available" in rHU.text)
    )
    R.add("t10.html_unavailable_404_with_message", ok_v, f"status={rHU.status_code} ct={rHU.headers.get('content-type')}")

    # ─── TEST 11
    print("\n--- Test 11: Idempotent revoke ---")
    t11_tok = mint_for(spot_a_id, owner_token)
    if not t11_tok:
        R.add("t11.mint", False, "could not mint")
    else:
        d1 = requests.delete(_api(f"/spots/{spot_a_id}/share/{t11_tok}"), headers=_hdrs(owner_token), timeout=30)
        d2 = requests.delete(_api(f"/spots/{spot_a_id}/share/{t11_tok}"), headers=_hdrs(owner_token), timeout=30)
        ok1 = d1.status_code == 200 and (d1.json() or {}).get("ok") is True and (d1.json() or {}).get("revoked") is True
        ok2 = d2.status_code == 200 and (d2.json() or {}).get("ok") is True and (d2.json() or {}).get("revoked") is True
        R.add(
            "t11.delete_idempotent_200_both_times",
            ok1 and ok2,
            f"first={d1.status_code}/{d1.text[:80]} second={d2.status_code}/{d2.text[:80]}",
        )

    # ─── TEST 12
    print("\n--- Test 12: Access counter ---")
    t12_tok = mint_for(spot_a_id, owner_token)
    if not t12_tok:
        R.add("t12.mint", False, "could not mint")
    else:
        for _ in range(3):
            requests.get(_api(f"/spots/shared/{t12_tok}"), timeout=30)
        time.sleep(0.3)
        rlist = requests.get(_api(f"/spots/{spot_a_id}/shares"), headers=_hdrs(owner_token), timeout=30)
        if rlist.status_code != 200:
            R.add("t12.shares_list", False, f"{rlist.status_code}")
        else:
            items = rlist.json().get("items") or []
            hit = next((it for it in items if it.get("token") == t12_tok), None)
            ac = (hit or {}).get("access_count")
            la = (hit or {}).get("last_accessed_at")
            ok_v = bool(hit) and isinstance(ac, int) and ac >= 1 and la is not None
            R.add("t12.access_count_nonzero", ok_v, f"access_count={ac} last_accessed_at={la}")

    # Cleanup
    print("\n--- Cleanup ---")
    for sid in [spot_a_id, spot_b_id, spot_c_id, spot_d_id, spot_e_id]:
        if sid:
            try:
                requests.delete(_api(f"/spots/{sid}"), headers=_hdrs(admin_token), timeout=15)
            except Exception:
                pass

    return R.summarize()


if __name__ == "__main__":
    fails = main()
    sys.exit(0 if fails == 0 else 1)
