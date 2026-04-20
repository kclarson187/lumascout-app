"""
routes/scout_ai.py — Scout AI endpoints (Phase 1 / 2 / 3).

This is the first domain extracted out of the monolithic server.py. It serves
as the canonical template for the remaining migrations (see REFACTOR_PLAN.md).

Design notes
------------
- All shared primitives (db, auth deps, utcnow, audit_log, rate-limit, logger,
  system prompt, helpers) are imported from `server` at module-top. This works
  because server.py mounts this router from the BOTTOM of its file, after all
  definitions are complete — no circular import at evaluation time.

- The endpoints themselves are pure passthroughs to helpers that remain in
  server.py for now (e.g. `_build_scout_ai_context`, `_scout_llm_compose`).
  Those helpers can be migrated later with zero client-facing impact.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

# Import shared primitives from server.py. Order matters: server.py includes
# this router at the very end of its file, after all these symbols exist.
from server import (
    db,
    get_current_user,
    require_role,
    audit_log,
    utcnow,
    check_rate_limit,
    logger,
    SCOUT_AI_SYSTEM_PROMPT,
    SCOUT_AI_USER_ID,
    EDITORIAL_TEMPLATES,
    ScoutAIChatIn,
    ScoutAIPreferencesIn,
    ScoutSettingsIn,
    _build_scout_ai_context,
    _scout_ai_follow_ups,
    _scout_llm_compose,
    _get_scout_settings,
    _scout_posts_today,
)

# Shared imports from stdlib needed by the handlers below.
import os
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/api", tags=["scout_ai"])


# ---------------------------------------------------------------------------
# Phase 1 — stateless chat
# ---------------------------------------------------------------------------
@router.post("/ai/chat")
async def scout_ai_chat(body: ScoutAIChatIn, user: dict = Depends(get_current_user)):
    """Scout AI stateless chat. Returns a single reply plus follow-up chips."""
    check_rate_limit("scout_ai_chat", user["user_id"])

    if not body.messages:
        raise HTTPException(status_code=400, detail="No messages supplied.")

    last_user = None
    for m in reversed(body.messages):
        if m.role == "user" and (m.content or "").strip():
            last_user = m.content.strip()
            break
    if not last_user:
        raise HTTPException(status_code=400, detail="Empty user message.")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        raise HTTPException(status_code=500, detail="AI service is not available.")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="AI service is not configured.")

    context_block = await _build_scout_ai_context(user, body.spot_id, body.placement)
    sys_msg = (
        f"{SCOUT_AI_SYSTEM_PROMPT}\n\n"
        "=== LIVE APP CONTEXT (this session only - do not quote verbatim) ===\n"
        f"{context_block}\n"
        "=== END CONTEXT ==="
    )

    session_id = f"scout:{user['user_id']}:{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message=sys_msg,
    ).with_model("openai", "gpt-5.2")

    try:
        reply = await chat.send_message(UserMessage(text=last_user))
    except Exception as e:
        logger.warning("Scout AI chat failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Scout AI is briefly unavailable. Please try again in a moment.",
        )

    return {
        "reply": (reply or "").strip(),
        "follow_ups": _scout_ai_follow_ups(body.placement),
        "model": "gpt-5.2",
        "disclosure": "Scout AI is an official PhotoScout AI assistant. Replies are AI-generated.",
    }


# ---------------------------------------------------------------------------
# Phase 2 — onboarding preferences
# ---------------------------------------------------------------------------
@router.get("/ai/preferences")
async def scout_ai_get_preferences(user: dict = Depends(get_current_user)):
    prefs = user.get("scout_prefs") or {}
    return {
        "shoots": prefs.get("shoots") or [],
        "priorities": prefs.get("priorities") or [],
        "max_distance": prefs.get("max_distance"),
        "preferred_time": prefs.get("preferred_time"),
        "completed_at": prefs.get("completed_at"),
    }


@router.post("/ai/preferences")
async def scout_ai_set_preferences(body: ScoutAIPreferencesIn, user: dict = Depends(get_current_user)):
    payload = {
        "shoots": (body.shoots or [])[:8],
        "priorities": (body.priorities or [])[:3],
        "max_distance": body.max_distance,
        "preferred_time": body.preferred_time,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"scout_prefs": payload}},
    )
    return {"ok": True, **payload}


# ---------------------------------------------------------------------------
# Phase 3 — admin cadence + editorial + unanswered-Q&A reply
# ---------------------------------------------------------------------------
@router.get("/admin/ai/settings")
async def admin_ai_settings_get(user: dict = Depends(require_role("moderator"))):
    s = await _get_scout_settings()
    s["posts_today"] = await _scout_posts_today()
    return s


@router.post("/admin/ai/settings")
async def admin_ai_settings_set(body: ScoutSettingsIn, user: dict = Depends(require_role("super_admin"))):
    patch = {}
    for k in ("enabled", "community_replies_enabled", "editorial_posts_enabled"):
        v = getattr(body, k)
        if v is not None:
            patch[k] = bool(v)
    if body.max_posts_per_day is not None:
        patch["max_posts_per_day"] = max(0, min(20, int(body.max_posts_per_day)))
    if body.unanswered_reply_delay_hours is not None:
        patch["unanswered_reply_delay_hours"] = max(1, min(168, int(body.unanswered_reply_delay_hours)))
    patch["updated_at"] = utcnow()
    await db.app_settings.update_one({"_id": "scout_ai_settings"}, {"$set": patch}, upsert=True)
    await audit_log(user, "scout_ai.settings_update", "scout_ai", after=patch)
    return await _get_scout_settings()


@router.post("/admin/ai/generate-editorial")
async def admin_ai_generate_editorial(
    city: Optional[str] = None,
    template_index: Optional[int] = None,
    user: dict = Depends(require_role("moderator")),
):
    settings = await _get_scout_settings()
    if not settings["enabled"]:
        raise HTTPException(status_code=400, detail="Scout AI is disabled.")
    if settings["max_posts_per_day"] > 0 and (await _scout_posts_today()) >= settings["max_posts_per_day"]:
        raise HTTPException(status_code=429, detail="Daily Scout AI post cap reached.")

    idx = template_index if template_index is not None else (datetime.now(timezone.utc).day % len(EDITORIAL_TEMPLATES))
    idx = max(0, min(idx, len(EDITORIAL_TEMPLATES) - 1))
    title_stub, brief = EDITORIAL_TEMPLATES[idx]

    q: dict = {"privacy_mode": "public"}
    if city:
        q["city"] = city
    spots = await db.spots.find(q, {
        "_id": 0, "title": 1, "city": 1, "state": 1, "shoot_types": 1,
        "best_time_of_day": 1, "shoot_score": 1, "updated_at": 1,
    }).sort("updated_at", -1).limit(10).to_list(10)
    ctx_lines = [f"EDITORIAL_BRIEF: {brief}"]
    if city:
        ctx_lines.append(f"CITY_FOCUS: {city}")
    if spots:
        ctx_lines.append("CANDIDATE_SPOTS:")
        for s in spots:
            ctx_lines.append(
                f"  - {s.get('title')} ({s.get('city')}, {s.get('state')}) "
                f"score={s.get('shoot_score')} best={s.get('best_time_of_day')} "
                f"shoots={','.join((s.get('shoot_types') or [])[:3])}"
            )
    context = "\n".join(ctx_lines)

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are composing a short editorial community post for the PhotoScout feed. "
        + "Output plain text only (no markdown headings, no hashtags). Keep it under 140 words. "
        + "Open with the concrete value, name 3-5 spots from CANDIDATE_SPOTS (one per line with a 1-sentence reason). "
        + "End with one short question to invite real-user comments."
    )
    body_text = await _scout_llm_compose(
        system,
        f"Write the post body for the editorial '{title_stub}'.",
        context,
    )

    post_id = f"pst_{uuid.uuid4().hex[:12]}"
    doc = {
        "post_id": post_id,
        "author_user_id": SCOUT_AI_USER_ID,
        "category": "guide",
        "title": title_stub,
        "body": body_text[:2000],
        "image_url": None,
        "city": city,
        "state": None,
        "like_count": 0,
        "comment_count": 0,
        "status": "active",
        "ai_generated": True,
        "ai_template_index": idx,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.community_posts.insert_one(doc)
    await audit_log(user, "scout_ai.editorial_post", "community_post", post_id, after={"title": title_stub, "city": city})
    return {"ok": True, "post_id": post_id, "title": title_stub, "body": body_text}


@router.post("/admin/ai/reply-to-post/{post_id}")
async def admin_ai_reply_to_post(post_id: str, user: dict = Depends(require_role("moderator"))):
    settings = await _get_scout_settings()
    if not settings["enabled"]:
        raise HTTPException(status_code=400, detail="Scout AI is disabled.")

    post = await db.community_posts.find_one({"post_id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    prior = await db.community_comments.find({"post_id": post_id}, {"_id": 0, "body": 1, "author_user_id": 1}).limit(20).to_list(20)
    ctx_lines = [
        f"POST_TITLE: {post.get('title')}",
        f"POST_CATEGORY: {post.get('category')}",
        f"POST_BODY: {(post.get('body') or '')[:1200]}",
    ]
    if post.get("city"):
        ctx_lines.append(f"POST_CITY: {post['city']}, {post.get('state') or ''}")
    if prior:
        ctx_lines.append(f"PRIOR_COMMENTS: {len(prior)} existing — do not repeat obvious points.")

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are writing a single helpful reply to a PhotoScout community post. "
        + "Plain text only. Under 120 words. Lead with the most practical answer, "
        + "then 2-4 concrete considerations. If the question cannot be answered from "
        + "the data you have, say what would be needed to help further."
    )
    reply_txt = await _scout_llm_compose(
        system,
        "Write the reply comment body now.",
        "\n".join(ctx_lines),
    )

    comment = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:12]}",
        "post_id": post_id,
        "author_user_id": SCOUT_AI_USER_ID,
        "body": reply_txt[:2000],
        "ai_generated": True,
        "status": "active",
        "created_at": utcnow(),
    }
    await db.community_comments.insert_one(comment)
    await db.community_posts.update_one({"post_id": post_id}, {"$inc": {"comment_count": 1}})
    await audit_log(user, "scout_ai.reply", "community_post", post_id, after={"comment_id": comment["comment_id"]})
    return {"ok": True, "comment_id": comment["comment_id"], "body": reply_txt}



# ---------------------------------------------------------------------------
# Phase 4 — Planners + assists (weekend / route / collection / upload)
# ---------------------------------------------------------------------------
import json as _json
import re as _re

from server import haversine_km  # noqa: E402


class CollectionPlanIn(BaseModel):
    theme: str
    city: Optional[str] = None
    state: Optional[str] = None
    min_count: Optional[int] = 6
    max_count: Optional[int] = 10
    seed_from_preferences: Optional[bool] = False  # used by empty-Saved FLOW 5


class WeekendPlanIn(BaseModel):
    city: str
    state: Optional[str] = None
    focus: Optional[str] = None          # e.g. "golden hour", "family portraits"
    days: Optional[int] = 2              # 1 or 2
    party: Optional[str] = None          # "solo", "couple", "family"


class RoutePlanIn(BaseModel):
    base_lat: float
    base_lng: float
    city: Optional[str] = None
    max_stops: Optional[int] = 5
    focus: Optional[str] = None
    radius_km: Optional[int] = 60


class UploadAssistIn(BaseModel):
    rough_title: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    shoot_types: Optional[List[str]] = None
    notes: Optional[str] = None


def _parse_llm_json(raw: str) -> dict:
    """Robust JSON parser: strip ```json fences, locate first {...} block."""
    if not raw:
        return {}
    t = raw.strip()
    t = _re.sub(r"^```(?:json)?\s*", "", t)
    t = _re.sub(r"```\s*$", "", t).strip()
    m = _re.search(r"\{.*\}", t, _re.S)
    if m:
        t = m.group(0)
    try:
        return _json.loads(t)
    except Exception:
        return {}


def _spot_public_view(s: dict) -> dict:
    """Compact, safe spot payload for planner responses."""
    return {
        "spot_id": s.get("spot_id"),
        "title": s.get("title"),
        "city": s.get("city"),
        "state": s.get("state"),
        "latitude": s.get("latitude"),
        "longitude": s.get("longitude"),
        "shoot_score": s.get("shoot_score"),
        "best_time_of_day": s.get("best_time_of_day"),
        "shoot_types": s.get("shoot_types") or [],
        "primary_photo": (s.get("photos") or [None])[0] if s.get("photos") else s.get("primary_photo"),
        "summary": (s.get("summary") or "")[:200],
    }


async def _query_candidate_spots(
    *,
    city: Optional[str] = None,
    state: Optional[str] = None,
    near: Optional[tuple] = None,
    radius_km: float = 60.0,
    limit: int = 40,
) -> List[dict]:
    q: dict = {"privacy_mode": "public", "status": {"$ne": "pending"}}
    if city:
        q["city"] = {"$regex": f"^{_re.escape(city)}$", "$options": "i"}
    if state:
        q["state"] = {"$regex": f"^{_re.escape(state)}$", "$options": "i"}
    proj = {
        "_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1,
        "latitude": 1, "longitude": 1, "shoot_score": 1, "best_time_of_day": 1,
        "shoot_types": 1, "photos": 1, "summary": 1, "tags": 1,
    }
    cursor = db.spots.find(q, proj).sort("shoot_score", -1).limit(200)
    items = await cursor.to_list(200)
    if near:
        lat, lng = near
        for s in items:
            if s.get("latitude") is not None and s.get("longitude") is not None:
                s["_d_km"] = haversine_km(lat, lng, s["latitude"], s["longitude"])
            else:
                s["_d_km"] = 1e9
        items = [s for s in items if s["_d_km"] <= radius_km]
        items.sort(key=lambda s: (s["_d_km"], -(s.get("shoot_score") or 0)))
    return items[:limit]


# ---- 1c. Collection planner ------------------------------------------------
@router.post("/ai/plan/collection")
async def scout_plan_collection(body: CollectionPlanIn, user: dict = Depends(get_current_user)):
    check_rate_limit("scout_ai_plan", user["user_id"])

    # If seeded from preferences (FLOW 5 — empty Saved onboarding), infer a theme.
    if body.seed_from_preferences and (not body.theme or body.theme.strip() == ""):
        prefs = user.get("scout_prefs") or {}
        shoots = prefs.get("shoots") or []
        theme = " / ".join((shoots or ["photogenic"])[:2]) + " starter"
    else:
        theme = (body.theme or "").strip()
    if not theme:
        raise HTTPException(status_code=400, detail="A theme is required.")

    min_c = max(4, min(12, int(body.min_count or 6)))
    max_c = max(min_c, min(15, int(body.max_count or 10)))

    cands = await _query_candidate_spots(city=body.city, state=body.state, limit=40)
    if not cands:
        raise HTTPException(status_code=404, detail="No candidate spots for that area yet.")

    # Build LLM context
    ctx_lines = [
        f"THEME: {theme}",
        f"REGION: {body.city or 'anywhere'}" + (f", {body.state}" if body.state else ""),
        f"COLLECTION_SIZE: between {min_c} and {max_c} spots.",
        "CANDIDATE_SPOTS (pick only from these):",
    ]
    for s in cands[:30]:
        ctx_lines.append(
            f"- {s['spot_id']} | {s.get('title')} | {s.get('city')}, {s.get('state')} "
            f"| score={s.get('shoot_score')} | best={s.get('best_time_of_day')} "
            f"| types={','.join((s.get('shoot_types') or [])[:3])}"
        )
    context = "\n".join(ctx_lines)
    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are building a named PhotoScout collection. "
        + "Respond with ONLY a valid JSON object (no prose, no markdown fences) shaped as:\n"
        + '{"name": str, "description": str (1-2 short sentences), '
        + '"spots": [{"spot_id": str, "reason": str (max 14 words)}]}\n'
        + "Pick 6-10 of the strongest matches to the theme. Use only spot_ids from CANDIDATE_SPOTS."
    )
    raw = await _scout_llm_compose(
        system, "Compose the collection now.", context,
    )
    parsed = _parse_llm_json(raw)
    if not parsed or not parsed.get("spots"):
        raise HTTPException(status_code=502, detail="Scout AI returned an unusable plan. Try again.")

    valid_ids = {s["spot_id"] for s in cands}
    picks = [p for p in (parsed.get("spots") or []) if p.get("spot_id") in valid_ids][:max_c]
    if len(picks) < min_c:
        # backfill with top-score candidates if LLM under-picked
        seen = {p["spot_id"] for p in picks}
        for s in cands:
            if s["spot_id"] not in seen and len(picks) < min_c:
                picks.append({"spot_id": s["spot_id"], "reason": "High-scoring match for this theme."})
                seen.add(s["spot_id"])

    by_id = {s["spot_id"]: s for s in cands}
    stops = []
    for p in picks:
        s = by_id.get(p["spot_id"])
        if not s:
            continue
        stops.append({
            **_spot_public_view(s),
            "reason": (p.get("reason") or "").strip()[:160],
        })

    return {
        "plan_type": "collection",
        "name": (parsed.get("name") or f"{theme.title()}").strip()[:80],
        "description": (parsed.get("description") or "").strip()[:300],
        "theme": theme,
        "city": body.city, "state": body.state,
        "spots": stops,
        "count": len(stops),
        "disclosure": "AI-generated collection. Review before saving.",
    }


# ---- 1a. Weekend planner ---------------------------------------------------
def _weekend_slot_skeleton(days: int) -> List[dict]:
    one_day = [
        {"slot": "morning",      "time": "7:30 AM – 10:00 AM",  "hint": "soft light, low-angle"},
        {"slot": "golden_hour",  "time": "6:30 PM – 8:00 PM",  "hint": "sunset + reflections"},
    ]
    two_day = [
        {"slot": "sat_morning",   "time": "Sat  7:30 AM – 10:00 AM", "hint": "soft light, architecture"},
        {"slot": "sat_golden",    "time": "Sat  6:30 PM – 8:00 PM",  "hint": "sunset + long shadows"},
        {"slot": "sun_sunrise",   "time": "Sun  6:00 AM – 8:00 AM",  "hint": "sunrise, mist, water"},
        {"slot": "sun_brunch",    "time": "Sun  10:00 AM – 12:00 PM","hint": "casual portraits, cafés"},
    ]
    return two_day if days >= 2 else one_day


@router.post("/ai/plan/weekend")
async def scout_plan_weekend(body: WeekendPlanIn, user: dict = Depends(get_current_user)):
    check_rate_limit("scout_ai_plan", user["user_id"])
    if not body.city or not body.city.strip():
        raise HTTPException(status_code=400, detail="City is required.")

    days = 2 if (body.days or 2) >= 2 else 1
    slots = _weekend_slot_skeleton(days)

    cands = await _query_candidate_spots(city=body.city, state=body.state, limit=30)
    if not cands:
        raise HTTPException(status_code=404, detail=f"No public spots in {body.city} yet.")

    ctx_lines = [
        f"CITY: {body.city}" + (f", {body.state}" if body.state else ""),
        f"FOCUS: {body.focus or 'a balanced weekend'}",
        f"PARTY: {body.party or 'any'}",
        f"NUMBER_OF_SLOTS: {len(slots)}",
        "SLOTS_TO_FILL (in order):",
    ]
    for s in slots:
        ctx_lines.append(f"  {s['slot']} — {s['time']} — hint: {s['hint']}")
    ctx_lines.append("CANDIDATE_SPOTS:")
    for s in cands[:25]:
        ctx_lines.append(
            f"- {s['spot_id']} | {s.get('title')} | best={s.get('best_time_of_day')} "
            f"| score={s.get('shoot_score')} | types={','.join((s.get('shoot_types') or [])[:3])}"
        )

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are planning a weekend photo trip. Output ONLY valid JSON:\n"
        + '{"title": str (<= 60 chars), "summary": str (1 sentence), '
        + '"slots": [{"slot": str, "spot_id": str, "narrative": str (1-2 sentences), '
        + '"tip": str (1 sentence, concrete)}]}\n'
        + "Choose a DIFFERENT spot for each slot. Only use spot_ids from CANDIDATE_SPOTS. "
        + "Match best_time_of_day to the slot where possible (e.g. sunrise spots for sun_sunrise)."
    )
    raw = await _scout_llm_compose(system, "Plan the weekend now.", "\n".join(ctx_lines))
    parsed = _parse_llm_json(raw)
    if not parsed or not parsed.get("slots"):
        raise HTTPException(status_code=502, detail="Scout AI returned an unusable plan. Try again.")

    valid = {s["spot_id"]: s for s in cands}
    used = set()
    filled = []
    for sk in slots:
        match = None
        for item in (parsed.get("slots") or []):
            if item.get("slot") == sk["slot"] and item.get("spot_id") in valid and item["spot_id"] not in used:
                match = item
                break
        if not match:
            # fallback: pick a unused high-score candidate
            for s in cands:
                if s["spot_id"] not in used:
                    match = {"spot_id": s["spot_id"], "narrative": f"Strong fit for {sk['slot'].replace('_', ' ')}.", "tip": sk["hint"]}
                    break
        if not match:
            continue
        used.add(match["spot_id"])
        sp = valid.get(match["spot_id"])
        filled.append({
            "slot": sk["slot"],
            "slot_label": sk["slot"].replace("_", " ").title(),
            "time": sk["time"],
            "narrative": (match.get("narrative") or "").strip()[:260],
            "tip": (match.get("tip") or sk["hint"]).strip()[:160],
            "spot": _spot_public_view(sp) if sp else None,
        })

    return {
        "plan_type": "weekend",
        "title": (parsed.get("title") or f"A weekend in {body.city}").strip()[:80],
        "summary": (parsed.get("summary") or "").strip()[:240],
        "city": body.city, "state": body.state, "days": days,
        "focus": body.focus,
        "slots": filled,
        "count": len(filled),
        "disclosure": "AI-generated itinerary. Check weather + access before heading out.",
    }


# ---- 1b. Route planner -----------------------------------------------------
@router.post("/ai/plan/route")
async def scout_plan_route(body: RoutePlanIn, user: dict = Depends(get_current_user)):
    check_rate_limit("scout_ai_plan", user["user_id"])
    if body.base_lat is None or body.base_lng is None:
        raise HTTPException(status_code=400, detail="base_lat and base_lng are required.")

    max_stops = max(2, min(8, int(body.max_stops or 5)))
    radius_km = max(10, min(200, int(body.radius_km or 60)))
    cands = await _query_candidate_spots(
        city=body.city, near=(body.base_lat, body.base_lng),
        radius_km=radius_km, limit=40,
    )
    if len(cands) < 2:
        raise HTTPException(status_code=404, detail="Not enough nearby public spots to build a route.")

    ctx_lines = [
        f"BASE: {body.base_lat:.4f}, {body.base_lng:.4f}",
        f"RADIUS: {radius_km} km",
        f"MAX_STOPS: {max_stops}",
        f"FOCUS: {body.focus or 'varied composition, golden-hour friendly'}",
        "NEARBY_SPOTS (distance in km from base):",
    ]
    for s in cands[:20]:
        ctx_lines.append(
            f"- {s['spot_id']} | {s.get('title')} | "
            f"d={s['_d_km']:.1f}km | best={s.get('best_time_of_day')} | "
            f"score={s.get('shoot_score')} | types={','.join((s.get('shoot_types') or [])[:3])}"
        )
    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are ordering a one-day driving photo route. Output ONLY valid JSON:\n"
        + '{"title": str, "summary": str (1 sentence), '
        + '"stops": [{"spot_id": str, "reason": str (1 sentence, concrete)}]}\n'
        + "Pick 4-" + str(max_stops) + " spots total. Order them to minimise back-tracking "
        + "AND to respect best_time_of_day (sunrise spots first, golden/sunset near end). "
        + "Only use spot_ids from NEARBY_SPOTS."
    )
    raw = await _scout_llm_compose(system, "Compose the route now.", "\n".join(ctx_lines))
    parsed = _parse_llm_json(raw)
    picks_raw = (parsed or {}).get("stops") or []
    valid = {s["spot_id"]: s for s in cands}
    picks = [p for p in picks_raw if p.get("spot_id") in valid][:max_stops]

    # Fallback: distance-ordered if LLM failed
    if len(picks) < 3:
        picks = [{"spot_id": s["spot_id"], "reason": f"Score {s.get('shoot_score')}, {s.get('best_time_of_day')}."} for s in cands[:max_stops]]

    # Compute per-leg distances + ETA (assume avg 55 km/h urban+hwy blend)
    stops = []
    prev_lat, prev_lng = body.base_lat, body.base_lng
    for i, p in enumerate(picks):
        s = valid[p["spot_id"]]
        leg_km = haversine_km(prev_lat, prev_lng, s["latitude"], s["longitude"])
        leg_min = round(leg_km / 55.0 * 60.0)
        stops.append({
            **_spot_public_view(s),
            "order": i + 1,
            "distance_from_prev_km": round(leg_km, 1),
            "eta_from_prev_min": leg_min,
            "reason": (p.get("reason") or "").strip()[:160],
        })
        prev_lat, prev_lng = s["latitude"], s["longitude"]

    total_km = sum(x["distance_from_prev_km"] for x in stops)
    total_min = sum(x["eta_from_prev_min"] for x in stops)
    return {
        "plan_type": "route",
        "title": ((parsed or {}).get("title") or "Your photo route").strip()[:80],
        "summary": ((parsed or {}).get("summary") or "").strip()[:240],
        "base": {"lat": body.base_lat, "lng": body.base_lng},
        "focus": body.focus,
        "stops": stops,
        "total_distance_km": round(total_km, 1),
        "total_eta_min": int(total_min),
        "disclosure": (
            "ETA is a straight-line estimate at 55 km/h — real driving time may vary. "
            "Scout AI does not include live traffic."
        ),
    }


# ---- 3. Upload assist / FLOW 6 --------------------------------------------
@router.post("/ai/assist/upload")
async def scout_assist_upload(body: UploadAssistIn, user: dict = Depends(get_current_user)):
    """Generate a title / summary / best time / tips for a half-filled upload form."""
    check_rate_limit("scout_ai_plan", user["user_id"])

    # Context from nearby spots for local flavor
    nearby_ctx = ""
    if body.lat is not None and body.lng is not None:
        nearby = await _query_candidate_spots(near=(body.lat, body.lng), radius_km=20, limit=5)
        if nearby:
            nearby_ctx = "NEARBY_PHOTOGENIC_SPOTS:\n" + "\n".join(
                f"- {s.get('title')} ({s.get('best_time_of_day')})" for s in nearby
            )

    ctx_lines = [
        f"LOCATION: {body.city or 'unknown city'}" + (f", {body.state}" if body.state else ""),
    ]
    if body.rough_title:
        ctx_lines.append(f"USER_DRAFT_TITLE: {body.rough_title.strip()[:120]}")
    if body.shoot_types:
        ctx_lines.append(f"SHOOT_TYPES: {', '.join(body.shoot_types[:5])}")
    if body.notes:
        ctx_lines.append(f"USER_NOTES: {body.notes.strip()[:400]}")
    if nearby_ctx:
        ctx_lines.append(nearby_ctx)

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are helping a photographer describe a new PhotoScout location. "
        + "Output ONLY valid JSON:\n"
        + '{"title": str (<= 60 chars), '
        + '"summary": str (2-3 sentences, <= 280 chars, concrete, no hype), '
        + '"best_time_of_day": one of ["sunrise","morning","golden_hour","night","any"], '
        + '"tips": [str, str, str] (3 concrete, specific tips <= 90 chars each)}\n'
        + "Use plain, natural language. Avoid generic phrases like 'stunning' or 'breathtaking'."
    )
    raw = await _scout_llm_compose(system, "Draft the listing now.", "\n".join(ctx_lines))
    parsed = _parse_llm_json(raw) or {}

    VALID_BEST = {"sunrise", "morning", "golden_hour", "night", "any"}
    best = (parsed.get("best_time_of_day") or "any").strip().lower()
    if best not in VALID_BEST:
        best = "any"

    tips = [(t or "").strip() for t in (parsed.get("tips") or []) if (t or "").strip()]
    tips = [t[:120] for t in tips][:4]

    return {
        "title": (parsed.get("title") or "").strip()[:80],
        "summary": (parsed.get("summary") or "").strip()[:320],
        "best_time_of_day": best,
        "tips": tips,
        "disclosure": "AI-generated suggestion. You can edit everything before posting.",
    }
