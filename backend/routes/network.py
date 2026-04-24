"""
routes/network.py — Follows + Direct Messages + Discovery + Viewers + Mentors.

Phase 2a of the server.py modularization (after Phase 1A marketplace + 1B admin).
22 endpoints + 2 request models covering:
  • Who-Viewed-Your-Profile (/me/viewers + summary + analytics)
  • Follow / unfollow toggle (POST /users/{id}/follow)
  • DM threads (start, list, get, send, mark-read, mute, delete)
  • DM request queue (accept, ignore, block)
  • Legacy 1:1 conversations (pre-thread model — kept for compat)
  • Trust metrics (GET /users/{id}/trust)
  • Discovery + search (/network/discover, /network/search)
  • Mentorship matching (GET /mentors)

PRESERVED SEMANTICS — no behaviour change, no path change. Every endpoint
was moved verbatim from server.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user, get_optional_user,
    utcnow, plan_of, _effective_plan,
    _emit_notification,
    _user_public_view,
    _compute_trust_metrics,
    _dm_get_or_create_thread, _dm_insert_message, _thread_is_accepted,
    check_rate_limit,
    DMSendIn, DMStartIn,
)

router = APIRouter(prefix="/api", tags=["network"])


# --- get_my_viewers (server.py:1142-1292) ---
@router.get("/me/viewers")
async def get_my_viewers(
    limit: int = 50,
    since_days: int = 30,
    user: dict = Depends(get_current_user),
):
    """List photographers who viewed my profile.

    Response shape (tier-gated):
      {
        "plan": "free" | "pro" | "elite",
        "total_views": int,              # distinct viewers in window
        "total_impressions": int,        # sum of `count`s
        "period_days": int,
        "viewers": [                     # empty for free; full list for pro/elite
          {
            "user_id", "name", "username", "avatar_url", "city", "state",
            "specialties", "verification_status", "plan",
            "last_viewed_at", "view_count", "is_following"
          }, ...
        ],
        "teaser": {                      # present for free tier only
          "blurred_avatars": [ "data:..." | null, ...],   # up to 3
          "blurred_initials": ["SC", "MA", ...],
          "message": "12 photographers viewed your profile this week"
        },
        "analytics": {...}               # present for elite only
      }
    """
    uid = user["user_id"]
    plan = plan_of(user)
    tier = _effective_plan(plan)  # free | pro | elite
    cutoff = utcnow() - timedelta(days=max(1, min(since_days, 90)))
    # Collect distinct-viewer rows (most recent first), bounded by cutoff
    cursor = db.profile_views.find(
        {"viewed_user_id": uid, "last_viewed_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("last_viewed_at", -1).limit(max(1, min(limit, 200)))
    rows = await cursor.to_list(length=max(1, min(limit, 200)))
    total_views = len(rows)
    total_impressions = sum(int(r.get("count") or 1) for r in rows)

    # Free tier: teaser only (blurred)
    if tier == "free":
        teaser_rows = rows[:3]
        teaser_avatars: List[Optional[str]] = []
        teaser_initials: List[str] = []
        for r in teaser_rows:
            v = await db.users.find_one(
                {"user_id": r["viewer_user_id"]},
                {"_id": 0, "avatar_url": 1, "name": 1},
            ) or {}
            teaser_avatars.append(v.get("avatar_url"))
            nm = (v.get("name") or "").strip()
            teaser_initials.append("".join([w[0].upper() for w in nm.split()[:2] if w]) or "?")
        return {
            "plan": plan,
            "total_views": total_views,
            "total_impressions": total_impressions,
            "period_days": since_days,
            "viewers": [],
            "teaser": {
                "blurred_avatars": teaser_avatars,
                "blurred_initials": teaser_initials,
                "message": (
                    f"{total_views} photographer{'s' if total_views != 1 else ''} "
                    f"viewed your profile this {'week' if since_days <= 7 else 'month'}"
                ),
            },
        }

    # Pro / Elite — hydrate viewer profiles and enrich with is_following
    viewers_out: List[dict] = []
    for r in rows:
        v = await db.users.find_one(
            {"user_id": r["viewer_user_id"]},
            {"_id": 0, "password_hash": 0, "email": 0},
        )
        if not v:
            continue
        is_following = await db.follows.count_documents({
            "follower_user_id": uid,
            "followed_user_id": r["viewer_user_id"],
        }) > 0
        viewers_out.append({
            "user_id": v.get("user_id"),
            "name": v.get("name"),
            "username": v.get("username"),
            "avatar_url": v.get("avatar_url"),
            "city": v.get("city"),
            "state": v.get("state"),
            "specialties": v.get("specialties") or [],
            "verification_status": v.get("verification_status"),
            "plan": plan_of(v),
            "last_viewed_at": r.get("last_viewed_at"),
            "view_count": int(r.get("count") or 1),
            "is_following": is_following,
        })

    resp = {
        "plan": plan,
        "total_views": total_views,
        "total_impressions": total_impressions,
        "period_days": since_days,
        "viewers": viewers_out,
    }

    # Elite — add analytics block
    if tier == "elite":
        # Top cities
        city_counts: Dict[str, int] = {}
        for r in rows:
            c = (r.get("viewer_city") or "").strip()
            if c:
                city_counts[c] = city_counts.get(c, 0) + int(r.get("count") or 1)
        top_cities = sorted(
            [{"city": k, "views": v} for k, v in city_counts.items()],
            key=lambda x: -x["views"],
        )[:5]
        # Specialty breakdown
        spec_counts: Dict[str, int] = {}
        for r in rows:
            for s in (r.get("viewer_specialties") or []):
                if s:
                    spec_counts[s] = spec_counts.get(s, 0) + 1
        top_specialties = sorted(
            [{"specialty": k, "viewers": v} for k, v in spec_counts.items()],
            key=lambda x: -x["viewers"],
        )[:5]
        # Repeat viewers (count >= 2)
        repeat_viewers = sum(1 for r in rows if int(r.get("count") or 1) >= 2)
        # 7-day trend (counts per day for last 7 days)
        today = utcnow().date()
        trend: List[dict] = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            d_start = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)
            d_end = d_start + timedelta(days=1)
            c = await db.profile_views.count_documents({
                "viewed_user_id": uid,
                "last_viewed_at": {"$gte": d_start, "$lt": d_end},
            })
            trend.append({"date": d.isoformat(), "views": c})
        resp["analytics"] = {
            "top_cities": top_cities,
            "top_specialties": top_specialties,
            "repeat_viewers": repeat_viewers,
            "trend_7d": trend,
        }

    return resp

# --- get_my_viewers_summary (server.py:1295-1311) ---
@router.get("/me/viewers/summary")
async def get_my_viewers_summary(user: dict = Depends(get_current_user)):
    """Lightweight teaser for home/profile badges.
    Returns {total_7d, total_30d} so the UI can render "3 new viewers"
    without pulling the full list.
    """
    uid = user["user_id"]
    now = utcnow()
    t7 = await db.profile_views.count_documents({
        "viewed_user_id": uid,
        "last_viewed_at": {"$gte": now - timedelta(days=7)},
    })
    t30 = await db.profile_views.count_documents({
        "viewed_user_id": uid,
        "last_viewed_at": {"$gte": now - timedelta(days=30)},
    })
    return {"total_7d": t7, "total_30d": t30, "plan": plan_of(user)}

# --- my_networking_analytics (server.py:1314-1400) ---
@router.get("/me/analytics/networking")
async def my_networking_analytics(
    since_days: int = 30,
    user: dict = Depends(get_current_user),
):
    """Phase B.3 — Elite networking analytics dashboard.
    Pro tier gets a read-only preview with a single headline stat.
    Elite gets full numbers. Free tier gets a teaser shape.
    """
    uid = user["user_id"]
    tier = _effective_plan(plan_of(user))
    now = utcnow()
    cutoff = now - timedelta(days=max(1, min(since_days, 90)))

    # Baseline counts — shared across all tiers (cheap)
    views_7d = await db.profile_views.count_documents({
        "viewed_user_id": uid, "last_viewed_at": {"$gte": now - timedelta(days=7)},
    })
    views_30d = await db.profile_views.count_documents({
        "viewed_user_id": uid, "last_viewed_at": {"$gte": now - timedelta(days=30)},
    })
    follows_gained = await db.follows.count_documents({
        "followed_user_id": uid, "created_at": {"$gte": cutoff},
    }) if True else 0  # follows collection may lack created_at on older docs

    # Marketplace — applications sent + acceptance rate
    apps_sent = await db.referral_applications.count_documents({
        "applicant_user_id": uid, "created_at": {"$gte": cutoff},
    })
    apps_accepted = await db.referral_applications.count_documents({
        "applicant_user_id": uid, "status": "accepted", "created_at": {"$gte": cutoff},
    })
    acceptance_rate = round((apps_accepted / apps_sent) * 100, 1) if apps_sent > 0 else 0.0

    # Needs posted + applicants received
    needs_posted = await db.referral_needs.count_documents({
        "poster_user_id": uid, "posted_at": {"$gte": cutoff},
    })
    applicants_received = 0
    if needs_posted > 0:
        need_ids = [n["need_id"] async for n in db.referral_needs.find(
            {"poster_user_id": uid, "posted_at": {"$gte": cutoff}}, {"need_id": 1, "_id": 0}
        )]
        applicants_received = await db.referral_applications.count_documents({
            "need_id": {"$in": need_ids},
        })

    # Messaging — threads created + conversion (we count distinct thread starts via dm_requests)
    threads_active = await db.dm_threads.count_documents({
        "participant_user_ids": uid, "last_message_at": {"$ne": None},
        "last_message_at": {"$gte": cutoff},
    })

    base = {
        "plan": plan_of(user),
        "period_days": max(1, min(since_days, 90)),
        "profile_views_7d": views_7d,
        "profile_views_30d": views_30d,
        "follows_gained": follows_gained,
        "applications_sent": apps_sent,
        "applications_accepted": apps_accepted,
        "acceptance_rate_pct": acceptance_rate,
        "needs_posted": needs_posted,
        "applicants_received": applicants_received,
        "active_threads": threads_active,
    }

    # Elite-only extras: 7-day trend + funnel
    if tier == "elite":
        today = now.date()
        trend: List[dict] = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            d_start = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)
            d_end = d_start + timedelta(days=1)
            cnt = await db.profile_views.count_documents({
                "viewed_user_id": uid,
                "last_viewed_at": {"$gte": d_start, "$lt": d_end},
            })
            trend.append({"date": d.isoformat(), "views": cnt})
        base["trend_7d"] = trend
        base["funnel"] = {
            "views_to_follow_pct": round((follows_gained / views_30d) * 100, 1) if views_30d > 0 else 0.0,
            "applications_to_acceptance_pct": acceptance_rate,
        }

    return base


# --- my_followers / my_following (added for web dashboard) ---
# Additive-only. Returns lightweight user cards for the current user's
# followers and who they're following. No change to existing /follow endpoint.
@router.get("/me/followers")
async def my_followers(user: dict = Depends(get_current_user), limit: int = 100):
    rows = await db.follows.find(
        {"followed_user_id": user["user_id"]},
        {"_id": 0, "follower_user_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    user_ids = [r["follower_user_id"] for r in rows]
    if not user_ids:
        return []
    users_map = {
        u["user_id"]: u async for u in db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
             "city": 1, "state": 1, "verification_status": 1, "plan": 1},
        )
    }
    result = []
    for r in rows:
        u = users_map.get(r["follower_user_id"])
        if u:
            result.append({**u, "followed_at": r.get("created_at")})
    return result


@router.get("/me/following")
async def my_following(user: dict = Depends(get_current_user), limit: int = 100):
    rows = await db.follows.find(
        {"follower_user_id": user["user_id"]},
        {"_id": 0, "followed_user_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    user_ids = [r["followed_user_id"] for r in rows]
    if not user_ids:
        return []
    users_map = {
        u["user_id"]: u async for u in db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
             "city": 1, "state": 1, "verification_status": 1, "plan": 1},
        )
    }
    result = []
    for r in rows:
        u = users_map.get(r["followed_user_id"])
        if u:
            result.append({**u, "followed_at": r.get("created_at")})
    return result


# --- follow_user (server.py:1403-1432) ---
@router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, user: dict = Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # PRD #12: refuse follow if either side has blocked the other.
    blocked = await db.user_blocks.find_one({
        "$or": [
            {"blocker_user_id": user["user_id"], "blocked_user_id": user_id},
            {"blocker_user_id": user_id, "blocked_user_id": user["user_id"]},
        ],
    })
    if blocked:
        raise HTTPException(status_code=403, detail="Cannot follow a blocked user")
    existing = await db.follows.find_one({"follower_user_id": user["user_id"], "followed_user_id": user_id})
    if existing:
        await db.follows.delete_one({"follower_user_id": user["user_id"], "followed_user_id": user_id})
        return {"following": False}
    await db.follows.insert_one({
        "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
        "follower_user_id": user["user_id"],
        "followed_user_id": user_id,
        "created_at": utcnow(),
    })
    # Notify followed user (non-blocking)
    try:
        await _emit_notification(
            user_id,
            "new_follower",
            f"{user.get('name') or 'Someone'} followed you",
            f"@{user.get('username') or ''} just hit follow",
            actor_user_id=user["user_id"],
            deep_link=f"/profile/{user['user_id']}",
        )
    except Exception:
        pass
    return {"following": True}


# PRD #12: Full social-graph — Block / Unblock.
# Idempotent endpoints; blocking ALSO severs any follow relationships in
# both directions so the blocked user stops seeing the blocker's content
# immediately. `dm_blocks` is intentionally left untouched (DM-request
# specific) — `user_blocks` is the higher-scope profile block.
@router.post("/users/{user_id}/block")
async def block_user(user_id: str, user: dict = Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Upsert so it's idempotent.
    await db.user_blocks.update_one(
        {"blocker_user_id": user["user_id"], "blocked_user_id": user_id},
        {"$set": {
            "blocker_user_id": user["user_id"],
            "blocked_user_id": user_id,
            "created_at": utcnow(),
        }},
        upsert=True,
    )
    # Drop follows both ways so the graph reflects the block immediately.
    await db.follows.delete_many({
        "$or": [
            {"follower_user_id": user["user_id"], "followed_user_id": user_id},
            {"follower_user_id": user_id, "followed_user_id": user["user_id"]},
        ],
    })
    # Mirror the block on the DM layer so message requests are refused.
    await db.dm_blocks.update_one(
        {"blocker_user_id": user["user_id"], "blocked_user_id": user_id},
        {"$set": {
            "blocker_user_id": user["user_id"],
            "blocked_user_id": user_id,
            "created_at": utcnow(),
        }},
        upsert=True,
    )
    return {"blocked": True}


@router.delete("/users/{user_id}/block")
async def unblock_user(user_id: str, user: dict = Depends(get_current_user)):
    await db.user_blocks.delete_one({
        "blocker_user_id": user["user_id"],
        "blocked_user_id": user_id,
    })
    await db.dm_blocks.delete_one({
        "blocker_user_id": user["user_id"],
        "blocked_user_id": user_id,
    })
    return {"blocked": False}

# --- dm_start_thread (server.py:3195-3289) ---
@router.post("/dm/threads/start")
async def dm_start_thread(
    body: DMStartIn,
    user: dict = Depends(get_current_user),
):
    """Return the 1:1 thread with `user_id` (creates if needed). If the
    other user does not follow the sender, a pending message_request is
    created so recipient can accept/ignore/block from the Requests tab.

    Supports quick-start kinds (refer / collab) that pre-fill the first
    message body when the caller doesn't supply one.
    """
    target_id = body.user_id
    if target_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Safety: if recipient has blocked sender, refuse.
    blocked = await db.dm_blocks.find_one({"blocker_user_id": target_id, "blocked_user_id": user["user_id"]})
    if blocked:
        raise HTTPException(status_code=403, detail="You cannot message this user")
    thread = await _dm_get_or_create_thread(user["user_id"], target_id)
    # Message request if recipient doesn't follow sender and hasn't accepted
    target_follows_sender = await db.follows.find_one({
        "follower_user_id": target_id, "followed_user_id": user["user_id"],
    })
    accepted = await _thread_is_accepted(thread, target_id)
    is_request = not target_follows_sender and not accepted
    if is_request:
        # Phase B.3 — Free-tier gate: max 5 concurrent PENDING requests.
        # Pro/Elite are unlimited. Rate limit still applies (5/hr).
        tier = _effective_plan(plan_of(user))
        if tier == "free":
            pending_total = await db.dm_requests.count_documents({
                "from_user_id": user["user_id"], "status": "pending",
            })
            if pending_total >= 5:
                raise HTTPException(
                    status_code=402,
                    detail="Free plan limit: 5 pending message requests. Upgrade to Pro for unlimited.",
                )
        # Rate limit: max 5 pending requests per hour from free-tier senders.
        # Pro / Elite are not rate-limited (feature they pay for).
        if tier == "free":
            hour_ago = utcnow() - timedelta(hours=1)
            sent = await db.dm_requests.count_documents({
                "from_user_id": user["user_id"], "status": "pending",
                "created_at": {"$gte": hour_ago},
            })
            if sent >= 5:
                raise HTTPException(status_code=429, detail="Too many new requests. Try again later.")
        existing_req = await db.dm_requests.find_one({
            "from_user_id": user["user_id"], "to_user_id": target_id,
            "status": {"$in": ["pending", "ignored"]},
        })
        if not existing_req:
            await db.dm_requests.insert_one({
                "request_id": f"dmr_{uuid.uuid4().hex[:12]}",
                "from_user_id": user["user_id"],
                "to_user_id": target_id,
                "thread_id": thread["thread_id"],
                "status": "pending",
                "kind": body.kind or "message",
                "created_at": utcnow(),
            })
            try:
                await _emit_notification(
                    target_id,
                    "new_message_request",
                    f"Message request from {user.get('name') or 'a photographer'}",
                    (body.opening_body or '')[:140] or "Tap to review and accept",
                    actor_user_id=user["user_id"],
                    image_url=user.get("avatar_url"),
                    deep_link=f"/inbox?tab=requests",
                )
            except Exception:
                pass
    # Optional opening body → post as first message via the /messages endpoint logic
    opening_preview = None
    if body.opening_body and body.opening_body.strip():
        # Pre-filled templates for refer/collab kinds
        if not body.opening_body.strip() and body.kind == "refer":
            body.opening_body = "Hey! I may have a client to refer to you — are you available?"
        if not body.opening_body.strip() and body.kind == "collab":
            body.opening_body = "Loved your work. Open to a collab shoot?"
        msg_doc = await _dm_insert_message(
            thread, user, {"type": "text", "body": body.opening_body.strip()},
        )
        opening_preview = msg_doc["body"]
    return {
        "thread_id": thread["thread_id"],
        "is_request": is_request,
        "opening_preview": opening_preview,
    }

# --- dm_send_message (server.py:3349-3366) ---
@router.post("/dm/threads/{thread_id}/messages")
async def dm_send_message(
    thread_id: str,
    body: DMSendIn,
    user: dict = Depends(get_current_user),
):
    thread = await db.dm_threads.find_one({"thread_id": thread_id})
    if not thread or user["user_id"] not in thread["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Thread not found")
    # Block check on the recipient side
    other_ids = [u for u in thread["participant_user_ids"] if u != user["user_id"]]
    if other_ids:
        blk = await db.dm_blocks.find_one({"blocker_user_id": other_ids[0], "blocked_user_id": user["user_id"]})
        if blk:
            raise HTTPException(status_code=403, detail="Cannot send to this user")
    msg = await _dm_insert_message(thread, user, body.model_dump())
    msg.pop("_id", None)
    return msg

# --- dm_list_threads (server.py:3369-3435) ---
@router.get("/dm/threads")
async def dm_list_threads(
    tab: str = "all",   # "all" | "requests" | "accepted"
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    """List my threads grouped/filtered by tab.

    - 'accepted' ⇒ exclude threads whose last_message_at is null AND we
      have a pending request from the other side.
    - 'requests' ⇒ only pending inbound requests.
    """
    limit = max(1, min(100, limit))
    if tab == "requests":
        pending = await db.dm_requests.find(
            {"to_user_id": user["user_id"], "status": "pending"}, {"_id": 0}
        ).sort("created_at", -1).limit(limit).to_list(limit)
        # Hydrate sender
        sids = list({r["from_user_id"] for r in pending})
        users = await db.users.find({"user_id": {"$in": sids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
             "verification_status": 1, "plan": 1, "city": 1, "specialties": 1}).to_list(len(sids))
        umap = {u["user_id"]: u for u in users}
        for r in pending:
            r["sender"] = umap.get(r["from_user_id"])
        return {"items": pending, "tab": "requests"}

    # Accepted / all
    part_filter = {"user_id": user["user_id"], "hidden": {"$ne": True}}
    myparts = await db.dm_participants.find(part_filter, {"_id": 0}).to_list(500)
    tids = [p["thread_id"] for p in myparts]
    threads = await db.dm_threads.find(
        {"thread_id": {"$in": tids}}, {"_id": 0}
    ).sort("last_message_at", -1).to_list(limit)
    # Drop threads with no messages that still have pending inbound requests
    # (those live in Requests tab)
    pending_from_me_ids = await db.dm_requests.find(
        {"from_user_id": user["user_id"], "status": "pending"}, {"_id": 0, "thread_id": 1}
    ).to_list(500)
    pending_thread_ids = {r["thread_id"] for r in pending_from_me_ids}
    # Hydrate other participant + unread counts
    other_ids: list = []
    for t in threads: other_ids += [u for u in t["participant_user_ids"] if u != user["user_id"]]
    other_ids = list(set(other_ids))
    ulist = await db.users.find({"user_id": {"$in": other_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
         "verification_status": 1, "plan": 1, "city": 1, "specialties": 1}).to_list(len(other_ids))
    umap = {u["user_id"]: u for u in ulist}
    my_map = {p["thread_id"]: p for p in myparts}
    out = []
    for t in threads:
        others = [u for u in t["participant_user_ids"] if u != user["user_id"]]
        other = umap.get(others[0]) if others else None
        last_read = (my_map.get(t["thread_id"]) or {}).get("last_read_at")
        q_unread: dict = {"thread_id": t["thread_id"], "sender_user_id": {"$ne": user["user_id"]}}
        if last_read:
            q_unread["created_at"] = {"$gt": last_read}
        unread = await db.dm_messages.count_documents(q_unread)
        row = {
            **t,
            "other": other,
            "unread_count": unread,
            "is_muted": (my_map.get(t["thread_id"]) or {}).get("is_muted", False),
            "is_pending_from_me": t["thread_id"] in pending_thread_ids,
        }
        out.append(row)
    return {"items": out, "tab": tab}

# --- dm_get_thread (server.py:3438-3485) ---
@router.get("/dm/threads/{thread_id}")
async def dm_get_thread(
    thread_id: str,
    limit: int = 50,
    before: Optional[str] = None,  # ISO timestamp for pagination
    user: dict = Depends(get_current_user),
):
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0})
    if not thread or user["user_id"] not in thread["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    limit = max(1, min(100, limit))
    q: dict = {"thread_id": thread_id, "is_deleted": {"$ne": True}}
    if before:
        try:
            q["created_at"] = {"$lt": datetime.fromisoformat(before.replace("Z", "+00:00"))}
        except Exception:
            pass
    msgs = await db.dm_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    msgs.reverse()  # chronological
    # Hydrate refs (spot_share + profile_share)
    ref_spot_ids = list({m["ref_spot_id"] for m in msgs if m.get("ref_spot_id")})
    ref_user_ids = list({m["ref_user_id"] for m in msgs if m.get("ref_user_id")})
    smap, umap = {}, {}
    if ref_spot_ids:
        rows = await db.spots.find({"spot_id": {"$in": ref_spot_ids}},
            {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1, "images": 1}).to_list(len(ref_spot_ids))
        for s in rows:
            imgs = s.get("images") or []
            cover = next((i.get("image_url") for i in imgs if isinstance(i, dict) and i.get("is_cover")), None) or (imgs[0].get("image_url") if imgs and isinstance(imgs[0], dict) else None)
            smap[s["spot_id"]] = {"spot_id": s["spot_id"], "title": s.get("title"), "city": s.get("city"), "state": s.get("state"), "cover_image_url": cover}
    if ref_user_ids:
        rows = await db.users.find({"user_id": {"$in": ref_user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "city": 1, "specialties": 1}).to_list(len(ref_user_ids))
        umap = {u["user_id"]: u for u in rows}
    for m in msgs:
        if m.get("ref_spot_id"): m["spot_ref"] = smap.get(m["ref_spot_id"])
        if m.get("ref_user_id"): m["user_ref"] = umap.get(m["ref_user_id"])
    # Hydrate other + last_read
    others = [u for u in thread["participant_user_ids"] if u != user["user_id"]]
    other_u = await db.users.find_one({"user_id": others[0]} if others else {"user_id": "__none__"},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "plan": 1, "city": 1, "specialties": 1}) if others else None
    other_part = await db.dm_participants.find_one({"thread_id": thread_id, "user_id": others[0]}, {"_id": 0}) if others else None
    return {
        "thread": thread,
        "other": other_u,
        "other_last_read_at": (other_part or {}).get("last_read_at"),
        "messages": msgs,
    }

# --- dm_mark_read (server.py:3488-3497) ---
@router.post("/dm/threads/{thread_id}/mark-read")
async def dm_mark_read(thread_id: str, user: dict = Depends(get_current_user)):
    thread = await db.dm_threads.find_one({"thread_id": thread_id})
    if not thread or user["user_id"] not in thread["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    now = utcnow()
    await db.dm_participants.update_one(
        {"thread_id": thread_id, "user_id": user["user_id"]},
        {"$set": {"last_read_at": now}},
    )
    # Tier 1 read-receipts: stamp seen_at on every inbound message that
    # hasn't been seen yet. This gives per-message Seen indicators to the
    # *sender* (i.e. the other participant) without websockets.
    await db.dm_messages.update_many(
        {
            "thread_id": thread_id,
            "sender_user_id": {"$ne": user["user_id"]},
            "seen_at": None,
        },
        {"$set": {"seen_at": now}},
    )
    return {"ok": True}


# Tier 1: total unread across all accepted threads for the current viewer.
# Used by nav-bar badge + profile-avatar red dot on home.
@router.get("/dm/unread-count")
async def dm_unread_count(user: dict = Depends(get_current_user)):
    parts = await db.dm_participants.find(
        {"user_id": user["user_id"], "hidden": {"$ne": True}},
        {"_id": 0, "thread_id": 1, "last_read_at": 1},
    ).to_list(1000)
    total = 0
    threads_with_unread = 0
    for p in parts:
        q: dict = {
            "thread_id": p["thread_id"],
            "sender_user_id": {"$ne": user["user_id"]},
            "is_deleted": {"$ne": True},
        }
        if p.get("last_read_at"):
            q["created_at"] = {"$gt": p["last_read_at"]}
        n = await db.dm_messages.count_documents(q)
        if n:
            total += n
            threads_with_unread += 1
    # Include pending inbound requests so the badge reflects true "needs attention"
    pending = await db.dm_requests.count_documents({
        "to_user_id": user["user_id"], "status": "pending",
    })
    return {
        "unread_messages": total,
        "unread_threads": threads_with_unread,
        "pending_requests": pending,
        "total": total + pending,
    }


# Tier 1: lightweight inbox preview for the Home screen row.
# Returns just enough to render ~3 thread pills (avatar, name, preview, unread).
# Stripped of any heavy fields to protect home-feed perf.
@router.get("/dm/inbox/preview")
async def dm_inbox_preview(
    limit: int = 3,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(10, limit))
    parts = await db.dm_participants.find(
        {"user_id": user["user_id"], "hidden": {"$ne": True}},
        {"_id": 0},
    ).to_list(500)
    tids = [p["thread_id"] for p in parts]
    if not tids:
        return {"items": []}
    threads = await db.dm_threads.find(
        {"thread_id": {"$in": tids}, "last_message_at": {"$ne": None}},
        {"_id": 0, "thread_id": 1, "participant_user_ids": 1,
         "last_message_at": 1, "last_message_preview": 1},
    ).sort("last_message_at", -1).limit(limit).to_list(limit)
    if not threads:
        return {"items": []}
    other_ids: list = []
    for t in threads:
        other_ids += [u for u in t["participant_user_ids"] if u != user["user_id"]]
    other_ids = list(set(other_ids))
    ulist = await db.users.find(
        {"user_id": {"$in": other_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1,
         "avatar_url": 1, "verification_status": 1, "plan": 1},
    ).to_list(len(other_ids))
    umap = {u["user_id"]: u for u in ulist}
    my_map = {p["thread_id"]: p for p in parts}
    out = []
    for t in threads:
        others = [u for u in t["participant_user_ids"] if u != user["user_id"]]
        other = umap.get(others[0]) if others else None
        last_read = (my_map.get(t["thread_id"]) or {}).get("last_read_at")
        q: dict = {"thread_id": t["thread_id"], "sender_user_id": {"$ne": user["user_id"]},
                   "is_deleted": {"$ne": True}}
        if last_read:
            q["created_at"] = {"$gt": last_read}
        unread = await db.dm_messages.count_documents(q)
        out.append({
            "thread_id": t["thread_id"],
            "other": other,
            "last_message_preview": t.get("last_message_preview"),
            "last_message_at": t.get("last_message_at"),
            "unread_count": unread,
        })
    return {"items": out}

# --- dm_mute_toggle (server.py:3500-3510) ---
@router.post("/dm/threads/{thread_id}/mute")
async def dm_mute_toggle(thread_id: str, user: dict = Depends(get_current_user)):
    p = await db.dm_participants.find_one({"thread_id": thread_id, "user_id": user["user_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    new_val = not p.get("is_muted", False)
    await db.dm_participants.update_one(
        {"thread_id": thread_id, "user_id": user["user_id"]},
        {"$set": {"is_muted": new_val}},
    )
    return {"is_muted": new_val}

# --- dm_delete_thread (server.py:3513-3520) ---
@router.delete("/dm/threads/{thread_id}")
async def dm_delete_thread(thread_id: str, user: dict = Depends(get_current_user)):
    """Soft-delete for this viewer only — re-appears on next inbound message."""
    await db.dm_participants.update_one(
        {"thread_id": thread_id, "user_id": user["user_id"]},
        {"$set": {"hidden": True, "last_read_at": utcnow()}},
    )
    return {"ok": True}

# --- dm_accept_request (server.py:3523-3529) ---
@router.post("/dm/requests/{request_id}/accept")
async def dm_accept_request(request_id: str, user: dict = Depends(get_current_user)):
    r = await db.dm_requests.find_one({"request_id": request_id})
    if not r or r["to_user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    await db.dm_requests.update_one({"request_id": request_id}, {"$set": {"status": "accepted", "acted_at": utcnow()}})
    return {"ok": True, "thread_id": r["thread_id"]}

# --- dm_ignore_request (server.py:3532-3543) ---
@router.post("/dm/requests/{request_id}/ignore")
async def dm_ignore_request(request_id: str, user: dict = Depends(get_current_user)):
    r = await db.dm_requests.find_one({"request_id": request_id})
    if not r or r["to_user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    await db.dm_requests.update_one({"request_id": request_id}, {"$set": {"status": "ignored", "acted_at": utcnow()}})
    # Hide the thread for the recipient until further action
    await db.dm_participants.update_one(
        {"thread_id": r["thread_id"], "user_id": user["user_id"]},
        {"$set": {"hidden": True}},
    )
    return {"ok": True}

# --- dm_block_from_request (server.py:3546-3561) ---
@router.post("/dm/requests/{request_id}/block")
async def dm_block_from_request(request_id: str, user: dict = Depends(get_current_user)):
    r = await db.dm_requests.find_one({"request_id": request_id})
    if not r or r["to_user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    await db.dm_blocks.update_one(
        {"blocker_user_id": user["user_id"], "blocked_user_id": r["from_user_id"]},
        {"$set": {"blocker_user_id": user["user_id"], "blocked_user_id": r["from_user_id"], "created_at": utcnow()}},
        upsert=True,
    )
    await db.dm_requests.update_one({"request_id": request_id}, {"$set": {"status": "blocked", "acted_at": utcnow()}})
    await db.dm_participants.update_one(
        {"thread_id": r["thread_id"], "user_id": user["user_id"]},
        {"$set": {"hidden": True}},
    )
    return {"ok": True}

# --- get_user_trust (server.py:3652-3656) ---
@router.get("/users/{user_id}/trust")
async def get_user_trust(user_id: str):
    m = await _compute_trust_metrics(user_id)
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "created_at": 1, "verification_status": 1, "city": 1, "state": 1, "specialties": 1})
    return {**m, **(u or {})}

# --- network_discover (server.py:3659-3735) ---
@router.get("/network/discover")
async def network_discover(
    limit_per_rail: int = 10,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Return the 'Network' discovery rails in one call."""
    limit_per_rail = max(1, min(20, limit_per_rail))
    proj = {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
            "verification_status": 1, "plan": 1, "city": 1, "state": 1,
            "specialties": 1, "is_bot": 1, "is_official": 1, "created_at": 1,
            "available_for_referrals": 1, "available_for_second_shooter": 1,
            "years_experience": 1, "bio": 1}
    base = {"is_bot": {"$ne": True}, "is_official": {"$ne": True}}
    if viewer: base["user_id"] = {"$ne": viewer["user_id"]}

    near_rail: list = []
    if viewer and viewer.get("city"):
        near_rail = await db.users.find({**base, "city": viewer["city"]}, proj).limit(limit_per_rail).to_list(limit_per_rail)
    # Popular in city
    popular_in_city: list = []
    if viewer and viewer.get("city"):
        popular_in_city = await db.users.find({**base, "city": viewer["city"]}, proj).sort("created_at", -1).limit(limit_per_rail).to_list(limit_per_rail)

    async def _niche(tag: str) -> list:
        return await db.users.find({**base, "specialties": {"$regex": tag, "$options": "i"}}, proj).limit(limit_per_rail).to_list(limit_per_rail)
    pet = await _niche("pet")
    wedding = await _niche("wedding")
    family = await _niche("family")
    # New members (joined last 30d)
    cutoff = utcnow() - timedelta(days=30)
    new_members = await db.users.find({**base, "created_at": {"$gte": cutoff}}, proj).sort("created_at", -1).limit(limit_per_rail).to_list(limit_per_rail)
    # Top contributors: users with the most approved community uploads
    pipeline = [
        {"$match": {"moderation_status": "approved"}},
        {"$group": {"_id": "$user_id", "uploads": {"$sum": 1}}},
        {"$sort": {"uploads": -1}},
        {"$limit": limit_per_rail},
    ]
    top_ids = [r["_id"] async for r in db.spot_community_uploads.aggregate(pipeline)]
    top_contribs = await db.users.find({**base, "user_id": {"$in": top_ids}}, proj).to_list(limit_per_rail) if top_ids else []
    # Verified pros
    verified = await db.users.find({**base, "verification_status": "verified"}, proj).limit(limit_per_rail).to_list(limit_per_rail)
    # Available for referrals / second shooter
    avail_refer = await db.users.find({**base, "available_for_referrals": True}, proj).limit(limit_per_rail).to_list(limit_per_rail)
    avail_second = await db.users.find({**base, "available_for_second_shooter": True}, proj).limit(limit_per_rail).to_list(limit_per_rail)

    # Phase B.3 — Elite discovery boost.
    # Moderate boost so Elite photographers surface first in every rail
    # without feeling spammy. Preserves existing order within each tier.
    def _elite_boost(lst: list) -> list:
        elites = [u for u in lst if (u.get("plan") or "free") == "elite"]
        pros = [u for u in lst if (u.get("plan") or "free") == "pro"]
        rest = [u for u in lst if (u.get("plan") or "free") not in ("elite", "pro")]
        return elites + pros + rest

    near_rail = _elite_boost(near_rail)
    popular_in_city = _elite_boost(popular_in_city)
    pet = _elite_boost(pet)
    wedding = _elite_boost(wedding)
    family = _elite_boost(family)
    new_members = _elite_boost(new_members)
    top_contribs = _elite_boost(top_contribs)
    verified = _elite_boost(verified)
    avail_refer = _elite_boost(avail_refer)
    avail_second = _elite_boost(avail_second)
    return {
        "near_you": [_user_public_view(u) for u in near_rail],
        "popular_in_city": [_user_public_view(u) for u in popular_in_city],
        "pet": [_user_public_view(u) for u in pet],
        "wedding": [_user_public_view(u) for u in wedding],
        "family": [_user_public_view(u) for u in family],
        "new_members": [_user_public_view(u) for u in new_members],
        "top_contributors": [_user_public_view(u) for u in top_contribs],
        "verified_pros": [_user_public_view(u) for u in verified],
        "available_for_referrals": [_user_public_view(u) for u in avail_refer],
        "available_for_second_shooter": [_user_public_view(u) for u in avail_second],
    }

# --- network_search (server.py:3738-3772) ---
@router.get("/network/search")
async def network_search(
    q: Optional[str] = None,
    city: Optional[str] = None,
    niche: Optional[str] = None,
    min_years: Optional[int] = None,
    available_for_referrals: Optional[bool] = None,
    available_for_second_shooter: Optional[bool] = None,
    verified_only: bool = False,
    plan: Optional[str] = None,  # "pro"|"elite"
    limit: int = 30,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    limit = max(1, min(60, limit))
    query: dict = {"is_bot": {"$ne": True}, "is_official": {"$ne": True}}
    if viewer: query["user_id"] = {"$ne": viewer["user_id"]}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"username": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}},
            {"specialties": {"$regex": q, "$options": "i"}},
        ]
    if city: query["city"] = {"$regex": f"^{city}", "$options": "i"}
    if niche: query["specialties"] = {"$regex": niche, "$options": "i"}
    if min_years is not None: query["years_experience"] = {"$gte": min_years}
    if available_for_referrals: query["available_for_referrals"] = True
    if available_for_second_shooter: query["available_for_second_shooter"] = True
    if verified_only: query["verification_status"] = "verified"
    if plan in ("pro", "elite"): query["plan"] = plan
    rows = await db.users.find(query, {"_id": 0, "user_id": 1, "name": 1, "username": 1,
        "avatar_url": 1, "verification_status": 1, "plan": 1, "city": 1, "state": 1,
        "specialties": 1, "years_experience": 1, "bio": 1, "available_for_referrals": 1,
        "available_for_second_shooter": 1}).limit(limit).to_list(limit)
    return {"items": rows, "total": len(rows)}

# --- list_mentors (server.py:5720-5743) ---
@router.get("/mentors")
async def list_mentors(
    specialty: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    """List photographers offering mentorship. Excludes viewer + suspended."""
    q: Dict[str, Any] = {
        "mentorship_available": True,
        "user_id": {"$ne": user["user_id"]},
        "plan": {"$ne": "suspended"},
    }
    if specialty:
        q["specialties"] = specialty
    if city:
        q["city"] = city
    items = await db.users.find(
        q,
        {
            "_id": 0, "password_hash": 0,
        },
    ).sort([("verification_status", -1), ("created_at", -1)]).limit(min(limit, 100)).to_list(100)
    return {"count": len(items), "items": items}

# --- ConversationCreateIn (server.py:6099-6100) ---
class ConversationCreateIn(BaseModel):
    participant_user_id: str

# --- create_or_get_conversation (server.py:6103-6125) ---
@router.post("/conversations")
async def create_or_get_conversation(body: ConversationCreateIn, user: dict = Depends(get_current_user)):
    """Idempotent — returns existing 1:1 conversation if already created."""
    if body.participant_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    target = await db.users.find_one({"user_id": body.participant_user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    ids = sorted([user["user_id"], body.participant_user_id])
    convo = await db.conversations.find_one({"participant_key": "|".join(ids)}, {"_id": 0})
    if convo:
        return convo
    convo = {
        "conversation_id": f"conv_{uuid.uuid4().hex[:12]}",
        "participant_user_ids": ids,
        "participant_key": "|".join(ids),
        "last_message": None,
        "last_message_at": utcnow(),
        "created_at": utcnow(),
    }
    await db.conversations.insert_one(convo)
    convo.pop("_id", None)
    return convo

# --- list_my_conversations (server.py:6128-6151) ---
@router.get("/me/conversations")
async def list_my_conversations(user: dict = Depends(get_current_user)):
    convos = await db.conversations.find(
        {"participant_user_ids": user["user_id"]}, {"_id": 0},
    ).sort("last_message_at", -1).to_list(100)
    # Attach other participant summary + unread count
    other_ids = []
    for c in convos:
        other = next((p for p in c["participant_user_ids"] if p != user["user_id"]), None)
        c["other_user_id"] = other
        other_ids.append(other)
    others = await db.users.find(
        {"user_id": {"$in": [o for o in other_ids if o]}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1},
    ).to_list(200)
    umap = {u["user_id"]: u for u in others}
    for c in convos:
        c["other"] = umap.get(c["other_user_id"])
        c["unread"] = await db.messages.count_documents({
            "conversation_id": c["conversation_id"],
            "sender_user_id": {"$ne": user["user_id"]},
            "read_by": {"$ne": user["user_id"]},
        })
    return convos

# --- list_messages (server.py:6154-6165) ---
@router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"conversation_id": conversation_id})
    if not convo or user["user_id"] not in convo["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    msgs = await db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # Mark all read by this viewer in one shot
    await db.messages.update_many(
        {"conversation_id": conversation_id, "sender_user_id": {"$ne": user["user_id"]}, "read_by": {"$ne": user["user_id"]}},
        {"$addToSet": {"read_by": user["user_id"]}},
    )
    return msgs

# --- MessageIn (server.py:6168-6169) ---
class MessageIn(BaseModel):
    body: str

# --- send_message (server.py:6172-6194) ---
@router.post("/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, body: MessageIn, user: dict = Depends(get_current_user)):
    check_rate_limit("review_create", user["user_id"])
    convo = await db.conversations.find_one({"conversation_id": conversation_id})
    if not convo or user["user_id"] not in convo["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Empty message")
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "conversation_id": conversation_id,
        "sender_user_id": user["user_id"],
        "body": body.body.strip()[:2000],
        "read_by": [user["user_id"]],
        "created_at": utcnow(),
    }
    await db.messages.insert_one(doc)
    await db.conversations.update_one(
        {"conversation_id": conversation_id},
        {"$set": {"last_message": doc["body"][:120], "last_message_at": doc["created_at"]}},
    )
    doc.pop("_id", None)
    return doc

