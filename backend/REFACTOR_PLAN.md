# PhotoScout Backend — Migration from monolithic `server.py`

**Current state**: `/app/backend/server.py` is ~5600 lines and owns every route,
model, helper, and integration wiring. The goal is to gradually move each
domain into `/app/backend/routes/<domain>.py` without breaking the running app.

**Why incremental**: many endpoints share private helpers inside `server.py`
(e.g. `get_current_user`, `require_role`, `audit_log`, `db`, `umap`-style
enrichment). Moving everything at once would risk circular imports, missed
references, and regressions that block users. The safer pattern is:

1. Extract ONE domain per PR.
2. Keep helpers used by >1 domain in `server.py` until the second caller moves.
3. Run the full backend test suite after each extraction before doing the next.

## The Established Pattern (proven with Scout AI in Phase 3)

```python
# routes/<domain>.py
from fastapi import APIRouter, Depends, HTTPException

# Pull shared primitives from the still-monolithic server module. This is
# safe as long as server.py includes the router *after* all definitions,
# which it already does at the bottom of the file.
from server import (
    db, get_current_user, require_role, audit_log, utcnow, check_rate_limit,
    logger,
)

router = APIRouter(prefix="/api", tags=["<domain>"])


@router.get("/<path>")
async def my_endpoint(user: dict = Depends(get_current_user)):
    ...
```

In `server.py` — after `app.include_router(api)`:
```python
from routes import <domain> as <domain>_routes  # noqa: E402
app.include_router(<domain>_routes.router)
```

## Migration Order (recommended)

| # | Target module       | Est. lines | Why first/last                                              |
|---|---------------------|-----------:|--------------------------------------------------------------|
| 1 | `routes/scout_ai.py`| ~350       | **Isolated, brand-new code. Lowest risk. Do this first.**    |
| 2 | `routes/billing.py` | ~420       | Isolated (Stripe), webhook already a named function.         |
| 3 | `routes/support.py` | ~180       | Few internal refs, clean domain surface.                     |
| 4 | `routes/groups.py`  | ~240       | Isolated.                                                    |
| 5 | `routes/mentors.py` | ~180       | Isolated.                                                    |
| 6 | `routes/messages.py`| ~300       | Isolated but shares the realtime push helper.                |
| 7 | `routes/collections.py` | ~260   | Mild coupling to spot enrichment.                            |
| 8 | `routes/community.py`   | ~700   | Heavy helper sharing with posts/comments/polls.              |
| 9 | `routes/feed.py`        | ~520   | Depends on community + spots enrichment — do after those.    |
|10 | `routes/spots.py`       | ~1100  | Core surface with most helpers.                              |
|11 | `routes/admin.py`       | ~900   | Touches every collection — migrate last.                     |
|12 | `routes/auth.py`        | ~250   | Last; server.py boot needs JWT helpers ready before then.    |

## Cross-cutting cleanup (can happen any time)

- Move Pydantic models into `models.py` (or per-domain `*_models.py`) once the
  owning route file is extracted.
- Move constants (`SCOUT_AI_SYSTEM_PROMPT`, `EDITORIAL_TEMPLATES`, plan price
  map) into `constants.py`.
- Move shared helpers (`utcnow`, `paginate`, `public_spot_view`, `public_user_view`)
  into a `lib.py`. server.py re-exports them for route modules that still
  reference them via `from server import ...`.

## Validation gate for every extraction

After extracting a domain:
1. `sudo supervisorctl restart backend` — must come up clean with no 500s.
2. Run `deep_testing_backend_v2` agent with a targeted smoke of the extracted
   endpoints (auth, list, create, update, delete paths).
3. Validate with `grep -n "<removed_name>" server.py` that no dangling refs remain.

## Things NOT to touch in the first pass

- `/app/backend/.env` (env + Stripe keys).
- The FastAPI `app = FastAPI(...)` construction, CORS middleware, and
  startup/shutdown handlers.
- The MongoDB bootstrap / index creation.

Keep these centralized in `server.py` (or a future `main.py`) until the whole
route surface is migrated — they need the app object before any router mount.
