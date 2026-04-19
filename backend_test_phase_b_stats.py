"""Phase B stats check on /api/auth/me."""
import os
import sys
import requests

BASE = os.environ.get("BACKEND_URL", "https://photo-finder-60.preview.emergentagent.com").rstrip("/") + "/api"

def main():
    # Login as sophie
    r = requests.post(f"{BASE}/auth/login", json={"email": "sophie@photoscout.app", "password": "demo123"}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.get(f"{BASE}/auth/me", headers=headers, timeout=30)
    assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
    me = r.json()

    failures = []

    # 1. stats object exists
    stats = me.get("stats")
    if not isinstance(stats, dict):
        failures.append(f"stats missing or not an object: {type(stats).__name__} -> {stats}")
        print("FAIL:", failures)
        sys.exit(1)

    print(f"stats = {stats}")

    # 2. followers
    f = stats.get("followers")
    if not isinstance(f, int) or isinstance(f, bool) or f < 0:
        failures.append(f"stats.followers invalid: {f!r}")

    # 3. following
    f = stats.get("following")
    if not isinstance(f, int) or isinstance(f, bool) or f < 0:
        failures.append(f"stats.following invalid: {f!r}")

    # 4. spots_created >= 1
    sc = stats.get("spots_created")
    if not isinstance(sc, int) or isinstance(sc, bool) or sc < 0:
        failures.append(f"stats.spots_created invalid (must be non-neg int): {sc!r}")
    elif sc < 1:
        failures.append(f"stats.spots_created expected >=1 for sophie, got {sc}")

    # 5. reviews_received
    rr = stats.get("reviews_received")
    if not isinstance(rr, int) or isinstance(rr, bool) or rr < 0:
        failures.append(f"stats.reviews_received invalid: {rr!r}")

    # 6. posts_count
    pc = stats.get("posts_count")
    if not isinstance(pc, int) or isinstance(pc, bool) or pc < 0:
        failures.append(f"stats.posts_count invalid: {pc!r}")

    # 7. existing fields present
    for key in ("plan", "limits", "usage", "user_id", "email"):
        if key not in me:
            failures.append(f"missing existing field: {key}")

    if me.get("email") != "sophie@photoscout.app":
        failures.append(f"email mismatch: {me.get('email')}")

    # Validate plan/limits/usage types
    if not isinstance(me.get("plan"), str):
        failures.append(f"plan not a string: {me.get('plan')!r}")
    if not isinstance(me.get("limits"), dict):
        failures.append(f"limits not a dict: {type(me.get('limits')).__name__}")
    if not isinstance(me.get("usage"), dict):
        failures.append(f"usage not a dict: {type(me.get('usage')).__name__}")

    if failures:
        print("=== FAILURES ===")
        for fl in failures:
            print(" -", fl)
        sys.exit(1)

    print("=== PASS ===")
    print(f"plan={me['plan']} user_id={me['user_id']} email={me['email']}")
    print(f"limits keys={list(me['limits'].keys())}")
    print(f"usage={me['usage']}")
    print(f"stats={stats}")

if __name__ == "__main__":
    main()
