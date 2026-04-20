"""
routes/support.py — Support Hub endpoints.

Second domain extracted from server.py (after routes/scout_ai.py).
Follows the same pattern: import shared primitives from server, expose a
local APIRouter that server.py mounts at the bottom.
"""
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException

from server import (
    db,
    get_current_user,
    utcnow,
    SUPPORT_FAQS,
    SupportTicketIn,
    SupportReplyIn,
)

router = APIRouter(prefix="/api", tags=["support"])


@router.get("/support/faqs")
async def support_faqs():
    return {"items": SUPPORT_FAQS}


@router.post("/support/tickets")
async def create_support_ticket(body: SupportTicketIn, user: dict = Depends(get_current_user)):
    subj = (body.subject or "").strip()
    msg = (body.body or "").strip()
    if not subj or not msg:
        raise HTTPException(status_code=400, detail="Subject and message are required")
    cat = (body.category or "general").lower()
    if cat not in ("general", "bug", "billing", "abuse", "feature"):
        cat = "general"
    doc = {
        "ticket_id": f"sup_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name") or user.get("username"),
        "subject": subj[:140],
        "body": msg[:4000],
        "category": cat,
        "status": "open",
        "replies": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.support_tickets.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/me/support/tickets")
async def my_support_tickets(user: dict = Depends(get_current_user)):
    items = await db.support_tickets.find(
        {"user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(100).to_list(100)
    return {"count": len(items), "items": items}


@router.get("/admin/support/tickets")
async def admin_list_tickets(
    status: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if category:
        q["category"] = category
    items = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 200)).to_list(200)
    counts = {
        "open": await db.support_tickets.count_documents({"status": "open"}),
        "pending": await db.support_tickets.count_documents({"status": "pending"}),
        "resolved": await db.support_tickets.count_documents({"status": "resolved"}),
        "closed": await db.support_tickets.count_documents({"status": "closed"}),
    }
    return {"items": items, "counts": counts}


@router.post("/admin/support/tickets/{ticket_id}/reply")
async def admin_reply_ticket(ticket_id: str, body: SupportReplyIn, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    if not (body.body or "").strip():
        raise HTTPException(status_code=400, detail="Reply body required")
    reply = {
        "from": "staff",
        "staff_id": user["user_id"],
        "staff_name": user.get("name") or user.get("username"),
        "body": body.body.strip()[:4000],
        "created_at": utcnow(),
    }
    r = await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$push": {"replies": reply}, "$set": {"status": "pending", "updated_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"ok": True, "reply": reply}


@router.post("/admin/support/tickets/{ticket_id}/resolve")
async def admin_resolve_ticket(ticket_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    r = await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$set": {"status": "resolved", "updated_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"ok": True}
