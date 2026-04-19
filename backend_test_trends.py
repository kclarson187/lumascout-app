"""Retest GET /api/me/trends after tz-aware fix."""
import re
import requests
import sys

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
EMAIL = "sophie@photoscout.app"
PASSWORD = "demo123"

results = []


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append((name, ok, detail))
    print(f"[{status}] {name} — {detail}")


def main():
    # 1) no token -> 401/403
    r = requests.get(f"{BASE}/me/trends", timeout=30)
    log("no-token 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    # 2) login
    r = requests.post(
        f"{BASE}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        log("login", False, f"status={r.status_code} body={r.text[:200]}")
        return
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    log("login", bool(tok), f"token_len={len(tok or '')}")
    h = {"Authorization": f"Bearer {tok}"}

    # 3) days=7
    r = requests.get(f"{BASE}/me/trends?days=7", headers=h, timeout=30)
    if r.status_code != 200:
        log("days=7 200", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        series = data.get("series", [])
        totals = data.get("totals", {})
        ok = True
        details = []
        if len(series) != 7:
            ok = False
            details.append(f"len(series)={len(series)} expected 7")
        date_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        sum_spots = 0
        sum_saves = 0
        for i, b in enumerate(series):
            if not date_re.match(b.get("date", "")):
                ok = False
                details.append(f"bucket[{i}].date bad: {b.get('date')}")
            lbl = b.get("label", "")
            if not isinstance(lbl, str) or len(lbl) != 3:
                ok = False
                details.append(f"bucket[{i}].label bad: {lbl!r}")
            for k in ("spots", "saves"):
                v = b.get(k)
                if not isinstance(v, int) or v < 0:
                    ok = False
                    details.append(f"bucket[{i}].{k} bad: {v!r}")
            sum_spots += int(b.get("spots") or 0)
            sum_saves += int(b.get("saves") or 0)
        if totals.get("spots") != sum_spots:
            ok = False
            details.append(f"totals.spots={totals.get('spots')} sum={sum_spots}")
        if totals.get("saves") != sum_saves:
            ok = False
            details.append(f"totals.saves={totals.get('saves')} sum={sum_saves}")
        log("days=7 shape", ok, "; ".join(details) or f"totals={totals} sample={series[0] if series else None}")

    # 4) days=0 -> len=1
    r = requests.get(f"{BASE}/me/trends?days=0", headers=h, timeout=30)
    if r.status_code != 200:
        log("days=0 200", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        series = data.get("series", [])
        log("days=0 len=1", len(series) == 1, f"len={len(series)}")

    # 5) days=100 -> len=30
    r = requests.get(f"{BASE}/me/trends?days=100", headers=h, timeout=30)
    if r.status_code != 200:
        log("days=100 200", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        series = data.get("series", [])
        log("days=100 len=30", len(series) == 30, f"len={len(series)}")

    print()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"RESULT: {passed}/{len(results)} passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
