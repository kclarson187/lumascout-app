#!/usr/bin/env python3
"""
Batch 2 backend stability tests for LumaScout pre-release audit.

Verifies the free-tier DM lockout fix at routes/network.py L482-505:
  - 5-pending-DM-requests cap was previously LIFETIME → permanent lockout.
  - FIX: now scoped to a 30-day rolling window.
  - Independent hourly rate-limit (5/hr → 429) still fires.

Endpoint under test: POST /api/dm/threads/start  (sets is_request when
recipient does NOT already follow sender).

Test plan (per review request):
  T1. Register 2 free-tier sender + 6 free-tier recipients (none follow back).
  T2. Send 5 successive DM-start requests → first 5 should be 200 with
      is_request=true.
  T3. The 6th request to a 6th recipient → MUST return either 402 (30d cap)
      OR 429 (hourly cap) — either is the documented correct behaviour.
      A 500 here is a regression and is failed loudly.
  T4. Pro/Elite-tier sender (admin) → should NOT hit either gate even after
      6+ DM requests.
"""
import os
import sys
import json
import time
import uuid
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

results = []
created_user_ids = []  # for cleanup tracking only


def log(label, ok, detail=""):
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {label}")
    if detail:
        print(f"        {detail}")
    results.append({"label": label, "ok": ok, "detail": detail})


def post(url, headers=None, json_body=None, timeout=20):
    return requests.post(url, headers=headers or {}, json=json_body, timeout=timeout)


def get(url, headers=None, timeout=20):
    return requests.get(url, headers=headers or {}, timeout=timeout)


def login(email, password):
    r = post(f"{BASE}/auth/login", json_body={"email": email, "password": password})
    r.raise_for_status()
    j = r.json()
    return j["token"], j["user"]


def register_user(email, password, name):
    r = post(f"{BASE}/auth/register", json_body={
        "email": email,
        "password": password,
        "name": name,
        "specialties": [],
    })
    if r.status_code != 200:
        raise RuntimeError(f"register {email} failed: {r.status_code} {r.text[:200]}")
    j = r.json()
    return j["token"], j["user"]


def main():
    print("=" * 78)
    print(f"Batch 2 — DM lockout fix verification ({BASE})")
    print("=" * 78)

    # --- Login admin (super_admin, Elite plan) ---
    try:
        admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASS)
    except Exception as e:
        log("Login admin", False, f"login failed: {e}")
        return _summary()
    log("Login admin (super_admin, elite)", True,
        f"user_id={admin_user['user_id']}, plan={admin_user.get('plan')}")
    AH = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}

    # --- Register free-tier sender ---
    suffix = uuid.uuid4().hex[:6]
    sender_email = f"batch2_sender_{suffix}@lumascout-qa.com"
    try:
        sender_token, sender_user = register_user(
            sender_email, "Batch2QApass!1", "Batch2 Sender")
    except Exception as e:
        log("Register free-tier sender", False, str(e))
        return _summary()
    created_user_ids.append(sender_user["user_id"])
    log("Register free-tier sender", True,
        f"user_id={sender_user['user_id']}, plan={sender_user.get('plan')}")
    SH = {"Authorization": f"Bearer {sender_token}", "Content-Type": "application/json"}

    # Confirm sender is on free plan
    if sender_user.get("plan") not in (None, "free"):
        log("Sender plan == free", False, f"plan={sender_user.get('plan')}")
    else:
        log("Sender plan == free", True, f"plan={sender_user.get('plan')!r}")

    # --- Register 6 free-tier recipients (NONE follow sender) ---
    recipients = []
    for i in range(6):
        rsuf = uuid.uuid4().hex[:6]
        email = f"batch2_recv_{i+1}_{rsuf}@lumascout-qa.com"
        try:
            tk, u = register_user(email, "Batch2QApass!1", f"Batch2 Recv {i+1}")
            recipients.append({"email": email, "user_id": u["user_id"], "token": tk})
            created_user_ids.append(u["user_id"])
        except Exception as e:
            log(f"Register recipient #{i+1}", False, str(e))
            return _summary()
    log("Register 6 free-tier recipients", True,
        f"user_ids={[r['user_id'] for r in recipients]}")

    # === T2: Send 5 successive DM requests to first 5 recipients ===
    successful_requests = 0
    request_results = []
    for i in range(5):
        rcv = recipients[i]
        body = {
            "user_id": rcv["user_id"],
            "kind": "message",
            "opening_body": f"hi from batch2 sender msg {i+1}",
        }
        r = post(f"{BASE}/dm/threads/start", headers=SH, json_body=body)
        request_results.append({"i": i+1, "status": r.status_code, "body": r.text[:200]})
        if r.status_code == 200:
            j = r.json()
            if j.get("is_request") is True:
                successful_requests += 1
                log(f"T2.{i+1} DM request to {rcv['user_id']} → 200 is_request=true",
                    True, f"thread_id={j.get('thread_id')}")
            else:
                log(f"T2.{i+1} DM request → 200 but is_request not true", False,
                    f"body={j}")
        else:
            log(f"T2.{i+1} DM request → expected 200, got {r.status_code}",
                False, f"body={r.text[:300]}")
            break  # If hourly cap fires earlier than 5, stop and analyse below

    log("T2 SUMMARY: 5 successive sends produced expected 200s",
        successful_requests == 5,
        f"successful={successful_requests}/5")

    # === T3: 6th request — must be 402 OR 429 (NOT 500, NOT 200) ===
    rcv6 = recipients[5]
    body6 = {
        "user_id": rcv6["user_id"],
        "kind": "message",
        "opening_body": "hi from batch2 sender msg 6 (should be capped)",
    }
    r6 = post(f"{BASE}/dm/threads/start", headers=SH, json_body=body6)
    detail_text = ""
    try:
        detail_text = r6.json().get("detail") or r6.text[:300]
    except Exception:
        detail_text = r6.text[:300]

    if r6.status_code == 402:
        ok402 = isinstance(detail_text, str) and \
                "Free plan limit: 5 pending message requests in 30 days" in detail_text
        log("T3 6th DM → 402 with 30-day cap detail", ok402,
            f"status=402, detail={detail_text!r}")
    elif r6.status_code == 429:
        ok429 = isinstance(detail_text, str) and \
                ("Too many" in detail_text or "Try again later" in detail_text)
        log("T3 6th DM → 429 hourly cap (acceptable per spec)", ok429,
            f"status=429, detail={detail_text!r}")
    elif r6.status_code == 500:
        log("T3 6th DM — REGRESSION: 500 returned (not 402/429)", False,
            f"status=500, body={r6.text[:300]}")
    elif r6.status_code == 200:
        log("T3 6th DM — UNEXPECTED 200 (cap did not fire)", False,
            f"status=200, body={r6.text[:300]} — gate may be broken")
    else:
        log(f"T3 6th DM — unexpected status {r6.status_code}", False,
            f"body={r6.text[:300]}")

    # === T4: Pro/Elite-tier sender (admin = elite) — should NEVER hit cap ===
    # Use admin (already Elite) to send 6+ requests to 6 fresh recipients.
    # Register 6 throwaway recipients for admin to message (independent set).
    admin_recipients = []
    for i in range(6):
        rsuf = uuid.uuid4().hex[:6]
        email = f"batch2_admrcv_{i+1}_{rsuf}@lumascout-qa.com"
        try:
            _tk, u = register_user(email, "Batch2QApass!1", f"Batch2 AdminRcv {i+1}")
            admin_recipients.append({"email": email, "user_id": u["user_id"]})
            created_user_ids.append(u["user_id"])
        except Exception as e:
            log(f"T4 register admin-recv #{i+1}", False, str(e))

    if len(admin_recipients) == 6:
        admin_success = 0
        for i, rcv in enumerate(admin_recipients):
            body = {
                "user_id": rcv["user_id"],
                "kind": "message",
                "opening_body": f"admin elite tier test {i+1}",
            }
            r = post(f"{BASE}/dm/threads/start", headers=AH, json_body=body)
            if r.status_code == 200:
                admin_success += 1
            else:
                log(f"T4.{i+1} admin DM → expected 200, got {r.status_code}",
                    False, f"body={r.text[:200]}")
        log("T4 Pro/Elite sender unrestricted (6/6 succeed)",
            admin_success == 6,
            f"admin_success={admin_success}/6 (admin plan=elite)")
    else:
        log("T4 setup incomplete", False,
            f"only {len(admin_recipients)}/6 admin-recv users registered")

    # ============================================================
    # REGRESSION: re-run the 13 Batch-1 checks (spot validators +
    # spot CRUD + DM analytics) using admin token. We piggy-back
    # by importing the Batch 1 module's main() — but since it has
    # global side effects, we'll run inline minimal versions.
    # ============================================================
    print()
    print("=" * 78)
    print("REGRESSION: Batch 1 spot/DM-analytics checks")
    print("=" * 78)

    base_spot = {
        "title": "Batch2 regress — Austin Capitol",
        "description": "Batch 2 regression check spot",
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "private",
        "shoot_types": ["landscape"],
        "style_tags": [],
        "images": [],
    }
    created_spot_ids = []

    # R1 valid coords
    r = post(f"{BASE}/spots", headers=AH,
             json_body=dict(base_spot, latitude=30.2672, longitude=-97.7431,
                            title="Batch2 regress — valid"))
    a1_id = None
    if r.status_code == 200:
        a1_id = r.json().get("spot_id")
        if a1_id:
            created_spot_ids.append(a1_id)
        log("R1 valid spot Austin 30.2672/-97.7431 → 200", True, f"spot_id={a1_id}")
    else:
        log("R1 valid spot → 200", False, f"{r.status_code} {r.text[:200]}")

    # R2 Null island
    r = post(f"{BASE}/spots", headers=AH,
             json_body=dict(base_spot, latitude=0.0, longitude=0.0,
                            title="Batch2 regress — null island"))
    if r.status_code == 422:
        try:
            errs = r.json().get("detail") or []
            msgs = json.dumps(errs)
        except Exception:
            msgs = r.text
        ok = ("refresh GPS" in msgs or "pin the location" in msgs
              or "Invalid coordinates" in msgs)
        log("R2 Null Island (0,0) → 422 friendly msg", ok, f"msg={msgs[:200]}")
    else:
        log("R2 Null Island → 422", False, f"{r.status_code} {r.text[:200]}")

    # R3 Latitude OOR
    r = post(f"{BASE}/spots", headers=AH,
             json_body=dict(base_spot, latitude=91.0, longitude=-97.0,
                            title="Batch2 regress — lat OOR"))
    if r.status_code == 422:
        try:
            msgs = json.dumps(r.json().get("detail") or [])
        except Exception:
            msgs = r.text
        log("R3 Lat 91 → 422 mentions '-90 and 90'",
            "between -90 and 90" in msgs, f"msg={msgs[:200]}")
    else:
        log("R3 Lat 91 → 422", False, f"{r.status_code} {r.text[:200]}")

    # R4 Longitude OOR
    r = post(f"{BASE}/spots", headers=AH,
             json_body=dict(base_spot, latitude=30.0, longitude=181.0,
                            title="Batch2 regress — lng OOR"))
    if r.status_code == 422:
        try:
            msgs = json.dumps(r.json().get("detail") or [])
        except Exception:
            msgs = r.text
        log("R4 Lng 181 → 422 mentions '-180 and 180'",
            "between -180 and 180" in msgs, f"msg={msgs[:200]}")
    else:
        log("R4 Lng 181 → 422", False, f"{r.status_code} {r.text[:200]}")

    # R5 Tiny coords (current behaviour either 200 or 422 — both acceptable)
    r = post(f"{BASE}/spots", headers=AH,
             json_body=dict(base_spot, latitude=0.00001, longitude=-0.00001,
                            title="Batch2 regress — tiny coords"))
    if r.status_code == 200:
        sid = r.json().get("spot_id")
        if sid:
            created_spot_ids.append(sid)
        log("R5 Tiny coords (0.00001) — accepted", True, f"200 sid={sid}")
    elif r.status_code == 422:
        log("R5 Tiny coords (0.00001) — rejected", True, f"422 (acceptable)")
    else:
        log("R5 Tiny coords — unexpected", False,
            f"{r.status_code} {r.text[:200]}")

    # R6 Auth check (no token)
    r = post(f"{BASE}/spots",
             headers={"Content-Type": "application/json"},
             json_body=dict(base_spot, latitude=30.2672, longitude=-97.7431,
                            title="Batch2 regress — no auth"))
    log("R6 POST /spots without bearer → 401/403 (not 500)",
        r.status_code in (401, 403),
        f"{r.status_code} {r.text[:120]}")

    # R7 list spots
    r = get(f"{BASE}/spots?limit=5")
    log("R7 GET /spots?limit=5 → 200", r.status_code == 200,
        f"{r.status_code} bytes={len(r.content)}")

    if a1_id:
        # R8 detail
        r = get(f"{BASE}/spots/{a1_id}", headers=AH)
        log(f"R8 GET /spots/{a1_id} → 200", r.status_code == 200,
            f"{r.status_code}")

        # R9 save
        r = post(f"{BASE}/spots/{a1_id}/save", headers=AH)
        ok = r.status_code == 200 and r.json().get("saved") is True
        log(f"R9 POST /spots/{a1_id}/save → saved=true", ok,
            f"{r.status_code} {r.text[:120]}")

        # R10 toggle off
        r = post(f"{BASE}/spots/{a1_id}/save", headers=AH)
        ok = r.status_code == 200 and r.json().get("saved") is False
        log(f"R10 POST /spots/{a1_id}/save toggle off", ok,
            f"{r.status_code} {r.text[:120]}")
    else:
        log("R8/R9/R10 skipped — no R1 spot_id", False, "")

    # R11 networking analytics (the duplicate-key fix)
    r = get(f"{BASE}/me/analytics/networking?since_days=30", headers=AH)
    if r.status_code == 200:
        try:
            j = r.json()
            ta = j.get("active_threads")
            log("R11 GET /me/analytics/networking", isinstance(ta, int),
                f"active_threads={ta}, plan={j.get('plan')}")
        except Exception as e:
            log("R11 networking", False, f"json parse: {e}")
    else:
        log("R11 networking", False, f"{r.status_code} {r.text[:200]}")

    # R12 list dm threads
    r = get(f"{BASE}/dm/threads?tab=all&limit=5", headers=AH)
    log("R12 GET /dm/threads?tab=all → 200", r.status_code == 200,
        f"{r.status_code} bytes={len(r.content)}")

    # R13 unread-count (Tier-1 messaging endpoint, sanity)
    r = get(f"{BASE}/dm/unread-count", headers=AH)
    log("R13 GET /dm/unread-count → 200", r.status_code == 200,
        f"{r.status_code} {r.text[:120]}")

    # ============================================================
    # Cleanup spots
    # ============================================================
    print()
    print("Cleanup — deleting created spots:", created_spot_ids)
    for sid in created_spot_ids:
        try:
            r = requests.delete(f"{BASE}/spots/{sid}", headers=AH, timeout=15)
            print(f"  DELETE /spots/{sid} → {r.status_code}")
        except Exception as e:
            print(f"  DELETE /spots/{sid} → ERR {e}")

    return _summary()


def _summary():
    print()
    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    passes = sum(1 for r in results if r["ok"])
    fails = sum(1 for r in results if not r["ok"])
    for r in results:
        icon = "PASS" if r["ok"] else "FAIL"
        print(f"  [{icon}] {r['label']}")
    print()
    print(f"Total: {passes} pass / {fails} fail / {len(results)} total")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
