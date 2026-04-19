"""
Phase C backend tests for PhotoScout:
  1) Post moderation endpoints:
     - GET /api/admin/posts (with ?status= filter, hydrated author, open_reports)
     - DELETE /api/admin/posts/{id}?reason=...
     - POST /api/admin/posts/{id}/restore (admin+ only)
     - role gates: moderator-or-above for delete/list, admin-or-above for restore
  2) Analytics top_cities + top_contributors (+ unchanged fields)
"""
import os
import sys
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://photo-finder-60.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

ADMIN_EMAIL = "admin@photoscout.app"
ADMIN_PW = "admin123"
SOPHIE_EMAIL = "sophie@photoscout.app"
SOPHIE_PW = "demo123"
MARCO_EMAIL = "marco@photoscout.app"
MARCO_PW = "demo123"

results = []


def log(ok: bool, name: str, detail: str = ""):
    marker = "PASS" if ok else "FAIL"
    line = f"[{marker}] {name}" + (f" — {detail}" if detail else "")
    results.append((ok, name, detail))
    print(line)


def hdr(token: str):
    return {"Authorization": f"Bearer {token}"}


def login(email: str, pw: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def main() -> int:
    print(f"Using API: {API}")
    # --- Logins ---
    try:
        admin_tok = login(ADMIN_EMAIL, ADMIN_PW)
        sophie_tok = login(SOPHIE_EMAIL, SOPHIE_PW)
        marco_tok = login(MARCO_EMAIL, MARCO_PW)
        log(True, "Logins (admin, sophie, marco)")
    except Exception as e:
        log(False, "Logins", str(e))
        return 1

    # ---------------------------------------------------------------
    # 1) Post moderation
    # ---------------------------------------------------------------
    # (a) sophie creates a post
    r = requests.post(
        f"{API}/posts",
        json={"category": "tip", "title": "Phase C test post",
              "body": "This is a test post for moderation."},
        headers=hdr(sophie_tok), timeout=15,
    )
    if r.status_code != 200:
        log(False, "sophie POST /api/posts", f"status={r.status_code} body={r.text[:200]}")
        return 1
    post_id = r.json().get("post_id")
    log(bool(post_id), "sophie POST /api/posts", f"post_id={post_id}")

    # (b) admin GET /api/admin/posts (no filter)
    r = requests.get(f"{API}/admin/posts", headers=hdr(admin_tok), timeout=15)
    if r.status_code != 200:
        log(False, "admin GET /api/admin/posts", f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        has_shape = "items" in data and "count" in data
        log(has_shape, "admin GET /api/admin/posts shape", f"keys={list(data.keys())}")
        items = data.get("items", [])
        matched = next((p for p in items if p.get("post_id") == post_id), None)
        has_post = matched is not None
        log(has_post, "admin GET /api/admin/posts contains new post")
        if matched:
            log(
                matched.get("author") is not None,
                "admin post has author field",
                f"author={matched.get('author')}",
            )
            log(
                matched.get("open_reports") == 0,
                "admin post has open_reports:0",
                f"open_reports={matched.get('open_reports')}",
            )

    # (c) admin GET /api/admin/posts?status=active
    r = requests.get(f"{API}/admin/posts?status=active", headers=hdr(admin_tok), timeout=15)
    if r.status_code == 200:
        items = r.json().get("items", [])
        all_active = all((p.get("status") or "active") == "active" for p in items)
        log(all_active, "GET /api/admin/posts?status=active only returns active",
            f"n={len(items)}")
    else:
        log(False, "GET /api/admin/posts?status=active", f"status={r.status_code}")

    # (d) admin DELETE /api/admin/posts/{post_id}?reason=test%20removal
    r = requests.delete(
        f"{API}/admin/posts/{post_id}",
        params={"reason": "test removal"},
        headers=hdr(admin_tok), timeout=15,
    )
    if r.status_code == 200:
        body = r.json()
        ok = body.get("ok") is True and body.get("status") == "removed"
        log(ok, "admin DELETE /api/admin/posts/{id}?reason=test%20removal",
            f"body={body}")
    else:
        log(False, "admin DELETE /api/admin/posts/{id}",
            f"status={r.status_code} body={r.text[:200]}")

    # (e) admin GET /api/admin/posts?status=removed → test post present w/ status=removed
    r = requests.get(f"{API}/admin/posts?status=removed", headers=hdr(admin_tok), timeout=15)
    if r.status_code == 200:
        items = r.json().get("items", [])
        match = next((p for p in items if p.get("post_id") == post_id), None)
        log(match is not None and match.get("status") == "removed",
            "GET /api/admin/posts?status=removed contains our post with status=removed",
            f"found={match is not None} status={match.get('status') if match else None}")
    else:
        log(False, "GET /api/admin/posts?status=removed", f"status={r.status_code}")

    # (f) admin restore
    r = requests.post(
        f"{API}/admin/posts/{post_id}/restore", headers=hdr(admin_tok), timeout=15,
    )
    if r.status_code == 200:
        body = r.json()
        ok = body.get("ok") is True and body.get("status") == "active"
        log(ok, "admin POST /api/admin/posts/{id}/restore", f"body={body}")
    else:
        log(False, "admin POST /api/admin/posts/{id}/restore",
            f"status={r.status_code} body={r.text[:200]}")

    # (g) audit logs contain post.remove + post.restore for this post_id
    found_remove = False
    found_restore = False
    for action in ("post.remove", "post.restore"):
        r = requests.get(
            f"{API}/admin/audit-logs",
            params={"action": action, "target_id": post_id},
            headers=hdr(admin_tok), timeout=15,
        )
        if r.status_code == 200:
            items = r.json().get("items", [])
            for it in items:
                if it.get("target_id") == post_id and it.get("action") == action:
                    if action == "post.remove":
                        found_remove = True
                    else:
                        found_restore = True
    log(found_remove, "audit log contains post.remove entry for test post")
    log(found_restore, "audit log contains post.restore entry for test post")

    # (h) sophie (regular user) tries to restore → 403
    # Need to delete it again first so a restore attempt is semantically valid; but 403 comes
    # before any state check (require_role raises before handler runs). Use any active post.
    # First pick any active post id:
    r = requests.get(f"{API}/admin/posts?status=active", headers=hdr(admin_tok), timeout=15)
    any_active_post_id = None
    if r.status_code == 200:
        items = r.json().get("items", [])
        if items:
            any_active_post_id = items[0].get("post_id")
    target_post_id = any_active_post_id or post_id

    r = requests.post(
        f"{API}/admin/posts/{target_post_id}/restore",
        headers=hdr(sophie_tok), timeout=15,
    )
    log(r.status_code == 403,
        "sophie POST /api/admin/posts/{id}/restore → 403",
        f"status={r.status_code}")

    # (i) marco (regular user) DELETE → 403
    r = requests.delete(
        f"{API}/admin/posts/{target_post_id}",
        headers=hdr(marco_tok), timeout=15,
    )
    log(r.status_code == 403,
        "marco DELETE /api/admin/posts/{id} → 403",
        f"status={r.status_code}")

    # ---------------------------------------------------------------
    # 2) Analytics top_cities + top_contributors
    # ---------------------------------------------------------------
    r = requests.get(f"{API}/admin/analytics?days=30", headers=hdr(admin_tok), timeout=30)
    if r.status_code != 200:
        log(False, "GET /api/admin/analytics?days=30",
            f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        log(True, "GET /api/admin/analytics?days=30 → 200")
        # existing fields unchanged
        for field in ("series", "totals", "most_saved"):
            log(field in data, f"analytics has '{field}'", "")

        # top_cities shape + count
        tc = data.get("top_cities") or []
        log(isinstance(tc, list) and len(tc) >= 5,
            "top_cities has 5+ entries",
            f"len={len(tc)}")
        if tc:
            first = tc[0]
            keys_ok = all(k in first for k in ("city", "state", "country_code", "count"))
            log(keys_ok, "top_cities[0] has city/state/country_code/count keys",
                f"keys={list(first.keys())}")
            positive_ints = all(isinstance(x.get("count"), int) and x["count"] > 0 for x in tc)
            log(positive_ints, "top_cities counts are positive ints")
            sorted_desc = all(tc[i]["count"] >= tc[i+1]["count"] for i in range(len(tc)-1))
            log(sorted_desc, "top_cities sorted descending by count",
                f"counts={[x['count'] for x in tc]}")

        # top_contributors shape + count
        tcon = data.get("top_contributors") or []
        log(isinstance(tcon, list) and len(tcon) >= 5,
            "top_contributors has 5+ entries",
            f"len={len(tcon)}")
        if tcon:
            first = tcon[0]
            required = ("user_id", "name", "username", "spot_count")
            extras = ("avatar_url", "verification_status", "plan", "city", "state")
            req_ok = all(k in first for k in required)
            ext_ok = all(k in first for k in extras)
            log(req_ok, "top_contributors[0] has user_id/name/username/spot_count",
                f"keys={list(first.keys())}")
            log(ext_ok, "top_contributors[0] has avatar_url/verification_status/plan/city/state",
                f"keys={list(first.keys())}")
            no_pw = all("password_hash" not in x for x in tcon)
            log(no_pw, "top_contributors entries have NO password_hash")
            positive_ints = all(isinstance(x.get("spot_count"), int) and x["spot_count"] > 0 for x in tcon)
            log(positive_ints, "top_contributors spot_count positive ints")
            sorted_desc = all(tcon[i]["spot_count"] >= tcon[i+1]["spot_count"] for i in range(len(tcon)-1))
            log(sorted_desc, "top_contributors sorted descending",
                f"counts={[x['spot_count'] for x in tcon]}")

    # -------------------- summary ------------------------------------
    total = len(results)
    passed = sum(1 for ok, _, _ in results if ok)
    print("\n===============================")
    print(f"RESULTS: {passed}/{total} passed")
    for ok, name, detail in results:
        if not ok:
            print(f"  FAIL — {name}: {detail}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
