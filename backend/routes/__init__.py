"""
Package boundary for per-domain FastAPI routers.

Each submodule here exposes a `router: APIRouter` which server.py mounts via
`app.include_router(<module>.router)`. This lets us migrate the monolithic
server.py into per-domain route files incrementally without downtime.

Current layout (migration in progress):
    routes/
        __init__.py              (this file)
        scout_ai.py              (Scout AI Phase 1-3 endpoints — see REFACTOR_PLAN.md)

Planned layout (after the full split — see /app/backend/REFACTOR_PLAN.md):
    routes/
        auth.py                  (/api/auth/*)
        users.py                 (/api/users/*, /api/me/*)
        spots.py                 (/api/spots/*)
        collections.py           (/api/collections/*)
        feed.py                  (/api/feed/*)
        community.py             (/api/community/*, /api/posts/*, /api/comments/*)
        messages.py              (/api/messages/*, /api/dm/*)
        billing.py               (/api/billing/*, /api/webhook/stripe)
        admin.py                 (/api/admin/*)
        mentors.py               (/api/mentors/*)
        groups.py                (/api/groups/*)
        support.py               (/api/support/*)
        scout_ai.py              (/api/ai/*, /api/admin/ai/*)
"""
