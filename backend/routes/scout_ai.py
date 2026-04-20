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
