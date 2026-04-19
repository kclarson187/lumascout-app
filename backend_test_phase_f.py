"""Phase F — validate 4 new backend endpoints.

1) POST /api/posts with category="poll" + poll_options -> creates poll post
2) POST/DELETE /api/posts/{id}/vote -> cast/change/remove a poll vote
3) GET /api/mentors -> users with mentorship_available=true
4) GET /api/mentees -> users with looking_for_mentor=true
5) GET /api/me/reviews-received -> reviews left on viewer's spots
"""
import os
import sys
import json
import requests

BASE = os.environ.get("BACKEND_URL", "https://photo-finder-60.preview.emergentagent.com").rstrip("/") + "/api"

SOPHIE = ("sophie@photoscout.app", "demo123")
MARCO = ("marco@photoscout.app", "demo123")
PRIYA = ("priya@photoscout.app", "demo123")

PASS: list = []
FAIL: list = []


def _log(ok: bool, name: str, detail: str = ""):
    (PASS if ok else FAIL).append((name, detail))
    marker = "PASS" if ok else "FAIL"
    print(f"[{marker}] {name}  {detail}")


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data.get("token") or data.get("access_token")


def h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def ensure_profile(tok: str, patch: dict):
    r = requests.patch(f"{BASE}/auth/me", headers=h(tok), json=patch, timeout=30)
    return r.status_code == 200


def test_poll_create_and_validation(sophie_tok: str) -> str:
    # Valid poll create
    r = requests.post(
        f"{BASE}/posts",
        headers=h(sophie_tok),
        json={
            "category": "poll",
            "title": "Fav portrait lens?",
            "body": "Pick your go-to.",
            "poll_options": ["35mm f/1.4", "50mm f/1.2", "85mm f/1.4"],
            "city": "Austin",
            "state": "TX",
        },
        timeout=30,
    )
    ok = r.status_code == 200
    post_id = None
    if ok:
        pj = r.json()
        post_id = pj.get("post_id")
        poll = pj.get("poll") or {}
        opts = poll.get("options") or []
        ok = (
            bool(post_id)
            and len(opts) == 3
            and all(o.get("votes") == 0 for o in opts)
            and all("index" in o and "text" in o for o in opts)
            and poll.get("total_votes") == 0
        )
        _log(ok, "POST /posts poll (3 options) -> 200 w/ poll shape",
             f"post_id={post_id} opts={len(opts)} total={poll.get('total_votes')}")
    else:
        _log(False, "POST /posts poll (3 options)", f"HTTP {r.status_code}: {r.text[:200]}")
        sys.exit(1)

    # Invalid: only 1 option
    r = requests.post(
        f"{BASE}/posts", headers=h(sophie_tok),
        json={"category": "poll", "title": "Too few", "poll_options": ["only one"]},
        timeout=30,
    )
    _log(r.status_code == 400, "POST /posts poll w/ 1 option -> 400",
         f"HTTP {r.status_code}: {r.text[:120]}")

    # Invalid: 7 options
    r = requests.post(
        f"{BASE}/posts", headers=h(sophie_tok),
        json={"category": "poll", "title": "Too many",
              "poll_options": [f"opt{i}" for i in range(7)]},
        timeout=30,
    )
    _log(r.status_code == 400, "POST /posts poll w/ 7 options -> 400",
         f"HTTP {r.status_code}: {r.text[:120]}")

    return post_id


def test_vote_flow(post_id: str, sophie_tok: str, marco_tok: str) -> None:
    # 1. Sophie votes option 1
    r = requests.post(f"{BASE}/posts/{post_id}/vote", headers=h(sophie_tok),
                      json={"option_index": 1}, timeout=30)
    ok = r.status_code == 200
    if ok:
        poll = (r.json() or {}).get("poll") or {}
        opts = poll.get("options") or []
        ok = (
            poll.get("total_votes") == 1
            and opts[1]["votes"] == 1
            and opts[0]["votes"] == 0 and opts[2]["votes"] == 0
            and poll.get("my_vote_index") == 1
        )
    _log(ok, "sophie vote opt=1 -> total=1 opts[1].votes=1 my_vote_index=1",
         f"HTTP {r.status_code}")

    # 2. Sophie re-votes option 2 (reassign)
    r = requests.post(f"{BASE}/posts/{post_id}/vote", headers=h(sophie_tok),
                      json={"option_index": 2}, timeout=30)
    ok = r.status_code == 200
    if ok:
        poll = (r.json() or {}).get("poll") or {}
        opts = poll.get("options") or []
        ok = (
            poll.get("total_votes") == 1
            and opts[1]["votes"] == 0
            and opts[2]["votes"] == 1
            and poll.get("my_vote_index") == 2
        )
    _log(ok, "sophie re-vote opt=2 reassigns (total stays 1, opts[1]=0, opts[2]=1)",
         f"HTTP {r.status_code}")

    # 3. Marco votes option 2 -> total=2
    r = requests.post(f"{BASE}/posts/{post_id}/vote", headers=h(marco_tok),
                      json={"option_index": 2}, timeout=30)
    ok = r.status_code == 200
    if ok:
        poll = (r.json() or {}).get("poll") or {}
        opts = poll.get("options") or []
        ok = (
            poll.get("total_votes") == 2
            and opts[2]["votes"] == 2
            and poll.get("my_vote_index") == 2
        )
    _log(ok, "marco vote opt=2 -> total=2 opts[2]=2",
         f"HTTP {r.status_code}")

    # 4. Marco DELETE vote -> total=1
    r = requests.delete(f"{BASE}/posts/{post_id}/vote", headers=h(marco_tok), timeout=30)
    ok = r.status_code == 200 and (r.json() or {}).get("ok") is True
    # Verify state via hydration GET (listing)
    g = requests.get(f"{BASE}/posts/{post_id}", headers=h(marco_tok), timeout=30)
    if ok and g.status_code == 200:
        poll = (g.json() or {}).get("poll") or {}
        opts = poll.get("options") or []
        ok = (
            poll.get("total_votes") == 1
            and opts[2]["votes"] == 1
            and poll.get("my_vote_index") is None
        )
    _log(ok, "marco DELETE vote -> {ok:true}, total back to 1, my_vote_index None",
         f"HTTP {r.status_code} state={(g.json() or {}).get('poll', {}) if g.status_code==200 else 'N/A'}")

    # 5. Invalid option_index
    r = requests.post(f"{BASE}/posts/{post_id}/vote", headers=h(marco_tok),
                      json={"option_index": 99}, timeout=30)
    _log(r.status_code == 400, "vote with option_index=99 -> 400",
         f"HTTP {r.status_code}: {r.text[:120]}")

    # 6. Bogus post
    r = requests.post(f"{BASE}/posts/pst_bogus12345/vote", headers=h(sophie_tok),
                      json={"option_index": 0}, timeout=30)
    _log(r.status_code == 404, "vote on bogus post_id -> 404",
         f"HTTP {r.status_code}: {r.text[:120]}")

    # 7. Non-poll post
    r = requests.post(f"{BASE}/posts", headers=h(sophie_tok),
                      json={"category": "tip", "title": "Phase F non-poll"}, timeout=30)
    non_poll_id = r.json().get("post_id") if r.status_code == 200 else None
    if non_poll_id:
        r2 = requests.post(f"{BASE}/posts/{non_poll_id}/vote", headers=h(sophie_tok),
                           json={"option_index": 0}, timeout=30)
        _log(r2.status_code == 400, "vote on non-poll post -> 400",
             f"HTTP {r2.status_code}: {r2.text[:120]}")
    else:
        _log(False, "create non-poll post for test", r.text[:120])

    # 8. No auth
    r = requests.post(f"{BASE}/posts/{post_id}/vote", json={"option_index": 0}, timeout=30)
    _log(r.status_code in (401, 403), "vote without auth -> 401",
         f"HTTP {r.status_code}")


def test_mentors_mentees(sophie_tok: str, marco_tok: str, sophie_uid: str, marco_uid: str):
    # As marco, GET /mentors
    r = requests.get(f"{BASE}/mentors", headers=h(marco_tok), timeout=30)
    ok = r.status_code == 200
    if ok:
        data = r.json()
        items = data.get("items") or []
        ok_flags = all(i.get("mentorship_available") is True for i in items)
        no_marco = all(i.get("user_id") != marco_uid for i in items)
        no_pw = all("password_hash" not in i for i in items)
        ok = ok_flags and no_marco and no_pw and len(items) >= 1
        _log(ok, f"GET /mentors as marco -> count={len(items)}, all mentorship_available, excludes self, no password_hash",
             f"first_user={items[0].get('username') if items else '-'}")
    else:
        _log(False, "GET /mentors as marco", f"HTTP {r.status_code}: {r.text[:120]}")

    # Specialty filter
    r = requests.get(f"{BASE}/mentors?specialty=Family", headers=h(marco_tok), timeout=30)
    if r.status_code == 200:
        items = r.json().get("items") or []
        ok = all("Family" in (i.get("specialties") or []) for i in items)
        _log(ok, f"GET /mentors?specialty=Family filters correctly (count={len(items)})")
    else:
        _log(False, "GET /mentors?specialty=Family", f"HTTP {r.status_code}")

    # City filter
    r = requests.get(f"{BASE}/mentors?city=Austin", headers=h(marco_tok), timeout=30)
    if r.status_code == 200:
        items = r.json().get("items") or []
        ok = all((i.get("city") or "") == "Austin" for i in items)
        _log(ok, f"GET /mentors?city=Austin filters correctly (count={len(items)})")
    else:
        _log(False, "GET /mentors?city=Austin", f"HTTP {r.status_code}")

    # No auth
    r = requests.get(f"{BASE}/mentors", timeout=30)
    _log(r.status_code in (401, 403), "GET /mentors no auth -> 401", f"HTTP {r.status_code}")

    # /mentees as sophie — should include marco
    r = requests.get(f"{BASE}/mentees", headers=h(sophie_tok), timeout=30)
    ok = r.status_code == 200
    if ok:
        items = r.json().get("items") or []
        includes_marco = any(i.get("user_id") == marco_uid for i in items)
        no_sophie = all(i.get("user_id") != sophie_uid for i in items)
        all_looking = all(i.get("looking_for_mentor") is True for i in items)
        no_pw = all("password_hash" not in i for i in items)
        ok = includes_marco and no_sophie and all_looking and no_pw
        _log(ok, f"GET /mentees as sophie includes marco, excludes sophie, all looking_for_mentor=true (count={len(items)})",
             f"includes_marco={includes_marco}")
    else:
        _log(False, "GET /mentees as sophie", f"HTTP {r.status_code}: {r.text[:120]}")

    # No auth
    r = requests.get(f"{BASE}/mentees", timeout=30)
    _log(r.status_code in (401, 403), "GET /mentees no auth -> 401", f"HTTP {r.status_code}")


def test_reviews_received(sophie_tok: str, sophie_uid: str, priya_tok: str, priya_uid: str):
    r = requests.get(f"{BASE}/me/reviews-received", headers=h(sophie_tok), timeout=30)
    ok = r.status_code == 200
    if ok:
        data = r.json()
        items = data.get("items") or []
        # If empty, that's still valid; but we assert shape when non-empty.
        shape_ok = True
        excludes_self = True
        for r_item in items:
            if not all(k in r_item for k in ("reviewer", "spot")):
                shape_ok = False
                break
            rev = r_item.get("reviewer") or {}
            spot = r_item.get("spot") or {}
            if not spot.get("spot_id"):
                shape_ok = False
                break
            if rev.get("user_id") == sophie_uid:
                excludes_self = False
                break
        ok = shape_ok and excludes_self and "count" in data
        _log(ok, f"GET /me/reviews-received as sophie -> count={data.get('count')} items={len(items)}",
             f"first_reviewer={items[0].get('reviewer', {}).get('username') if items else '-'}")
    else:
        _log(False, "GET /me/reviews-received as sophie", f"HTTP {r.status_code}: {r.text[:120]}")

    # User without spots — use priya if she has no spots; otherwise just verify shape
    r = requests.get(f"{BASE}/me/reviews-received", headers=h(priya_tok), timeout=30)
    if r.status_code == 200:
        data = r.json()
        # Accept either empty case or valid populated shape
        items = data.get("items") or []
        ok = isinstance(items, list) and "count" in data and data["count"] == len(items)
        _log(ok, f"GET /me/reviews-received as priya -> {{count,items}} shape ok (count={data.get('count')})")
    else:
        _log(False, "GET /me/reviews-received as priya", f"HTTP {r.status_code}: {r.text[:120]}")

    # No auth
    r = requests.get(f"{BASE}/me/reviews-received", timeout=30)
    _log(r.status_code in (401, 403), "GET /me/reviews-received no auth -> 401", f"HTTP {r.status_code}")


def main():
    print(f"BASE = {BASE}")
    sophie_tok = login(*SOPHIE)
    marco_tok = login(*MARCO)
    priya_tok = login(*PRIYA)

    # Get user_ids
    sophie_me = requests.get(f"{BASE}/auth/me", headers=h(sophie_tok), timeout=30).json()
    marco_me = requests.get(f"{BASE}/auth/me", headers=h(marco_tok), timeout=30).json()
    priya_me = requests.get(f"{BASE}/auth/me", headers=h(priya_tok), timeout=30).json()
    sophie_uid = sophie_me.get("user_id")
    marco_uid = marco_me.get("user_id")
    priya_uid = priya_me.get("user_id")
    print(f"sophie_uid={sophie_uid} marco_uid={marco_uid} priya_uid={priya_uid}")
    print(f"sophie mentorship_available={sophie_me.get('mentorship_available')}")
    print(f"marco looking_for_mentor={marco_me.get('looking_for_mentor')}")

    # Ensure flags are set so the mentors/mentees test is deterministic.
    if not sophie_me.get("mentorship_available"):
        ensure_profile(sophie_tok, {"mentorship_available": True})
    if not marco_me.get("looking_for_mentor"):
        ensure_profile(marco_tok, {"looking_for_mentor": True})

    # 1+2. Poll create + vote
    post_id = test_poll_create_and_validation(sophie_tok)
    test_vote_flow(post_id, sophie_tok, marco_tok)

    # 3. mentors / mentees
    test_mentors_mentees(sophie_tok, marco_tok, sophie_uid, marco_uid)

    # 4. reviews-received
    test_reviews_received(sophie_tok, sophie_uid, priya_tok, priya_uid)

    print("\n==== SUMMARY ====")
    print(f"PASS: {len(PASS)}   FAIL: {len(FAIL)}")
    for name, detail in FAIL:
        print(f"  FAIL: {name} -- {detail}")
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
