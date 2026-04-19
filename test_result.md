#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

user_problem_statement: |
  PhotoScout — Community Foundation (Phase 1 of 3)
  Posts, comments, likes, direct messaging, nearby photographers, extended
  profile fields. Home gains a community tab strip; new /community feed,
  /community/compose, /community/post/[id], /messages inbox and thread.

backend:
  - task: "User profile — new community fields (service_area, years_shooting, available_for_second_shooter, available_for_associate, mentorship_available, looking_for_mentor, community_onboarded)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "UserUpdateIn extended. Round-trips via PATCH /auth/me."
        -working: true
        -agent: "testing"
        -comment: "PATCH /api/auth/me as sophie with {specialties, service_area, years_shooting, website, instagram, available_for_second_shooter, mentorship_available, community_onboarded} returned 200. Subsequent GET /api/auth/me confirmed all 8 fields persisted exactly. PASS."

  - task: "POST/GET/DELETE /api/posts + /like/unlike + /comments — community posts"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "10 categories enum-gated. Hydrates author with name/avatar/verification/plan. Viewer's liked_by_me set per request. Likes use unique index (post_id, user_id) — second like is no-op. DELETE by owner or admin (admin deletion is audit-logged)."
        -working: false
        -agent: "testing"
        -comment: "CRITICAL: All community endpoints return 404 Not Found. Root cause identified: in /app/backend/server.py, `app.include_router(api)` is called on line 2047, BEFORE the entire community block is defined (POST_CATEGORIES at line 2065, @api.post('/posts') at line 2105, through @api.get('/community/onboarding-status') at line 2368). FastAPI's include_router copies routes at call-time; any @api.<method> decorators that fire AFTER include_router are silently dropped from the app's routing table. Confirmed via /openapi.json: 48 paths registered, ZERO community paths (`/posts`, `/conversations`, `/photographers/nearby`, `/me/conversations`, `/community/onboarding-status` are all absent). FIX: move `app.include_router(api)` (and likely the CORS middleware added immediately after it) to the very bottom of the file, AFTER the community block ends (currently around line 2373) and before `@app.on_event('startup')`. Do not register the router before all decorators have executed."

  - task: "GET /api/photographers/nearby — city-based photographer discovery"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Defaults to viewer's city. Excludes viewer themselves + suspended accounts. Optional specialty filter. Never returns password_hash."
        -working: false
        -agent: "testing"
        -comment: "Blocked by the same bug as community posts: endpoint is declared at line 2247 but the router is already included at line 2047, so GET /api/photographers/nearby returns 404. Implementation itself looks correct (excludes viewer via $ne, strips password_hash via projection, defaults to viewer.city) — it just never gets registered. Will pass once include_router is moved to the bottom of the file."

  - task: "Conversations + messages — DM inbox, 1:1 chat with participant_key dedupe, read markers"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "POST /conversations is idempotent via sorted participant_key. 400 for self-DM, 404 for unknown recipient. GET /me/conversations includes unread count + other-user summary. GET /conversations/{id}/messages marks as read for viewer. POST message rate-limited via review bucket (30/day) and caps to 2000 chars."
        -working: false
        -agent: "testing"
        -comment: "Blocked by the same include_router-before-decorator bug. POST /api/conversations, GET /api/me/conversations, GET/POST /api/conversations/{id}/messages all return 404. The one case that APPEARED to pass ('unknown recipient → 404') was a false positive — the 404 came from FastAPI's catch-all 'Not Found' for the missing route, not from our recipient-check logic. Will need full re-test after the router fix."

  - task: "POST /api/spots — create spot still works + graceful 413 on oversize payload"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Regression check: /api/spots POST used to blow up with 500 when >16MB BSON. Now wrapped in try/except DocumentTooLarge → 413 with a user-friendly message. Normal small-payload spot creation must still return 200."
        -working: true
        -agent: "testing"
        -comment: "Regression happy-path verified. (1) POST /api/spots as sophie with Austin lat/lng + tiny 1x1 PNG base64 image + privacy_mode=private → 200 with spot_id. (2) POST /api/spots with save_as_draft:true and privacy_mode=public → 200, response.visibility_status='draft' (draft override beats the moderation path). No 500s. The DocumentTooLarge → 413 wrapper is in place at line 678-684 but genuinely oversized payloads were not generated through HTTP per the task note; the wrapper path is unexercised but structurally correct."

frontend:
  - task: "Home — community tab strip + Messages icon"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Horizontal strip: For You (current home) · Community · Local · Opportunities (cat=referral) · Learn (cat=tip). Messages icon in top bar routes to /messages."

  - task: "Community feed screen — 10-category filter chips, post cards with like/comment, Message CTA"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/community.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Compose button in top bar. Each post card shows author avatar + verified badge, category pill, body preview, optimistic like toggle, and per-card 'Message' CTA that deep-links to /messages/new?user=<authorId>."

  - task: "Post composer — category picker + title + body + optional image"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/community/compose.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "10 category chips, 140-char title, 2000-char body, base64 image upload, tip banner."

  - task: "Post detail + comments — inline composer, like, message author"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/community/post/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Pull-to-refresh. Inline comment composer. Like toggle with optimistic UI. Message-author chip (hidden for the author)."

  - task: "Messages inbox — last-message preview, unread badges"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/messages.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Empty state routes to community. Unread count badge per row."

  - task: "Messages thread — 5s polling, chat bubbles, send"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/messages/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "If id === 'new' with ?user=X, lazily POST /conversations then load the resulting conversation. Auto-scrolls to bottom on new messages. Polls /messages every 5s."

metadata:
  created_by: "main_agent"
  version: "1.5"
  test_sequence: 5
  run_ui: false

test_plan:
  current_focus:
    - "POST /api/spots — create spot still works + graceful 413 on oversize payload"
    - "POST/GET/DELETE /api/posts + /like/unlike + /comments — community posts"
    - "GET /api/photographers/nearby — city-based photographer discovery"
    - "Conversations + messages — DM inbox, 1:1 chat with participant_key dedupe, read markers"
    - "User profile — new community fields (service_area, years_shooting, available_for_second_shooter, available_for_associate, mentorship_available, looking_for_mentor, community_onboarded)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Community Phase 1 backend is live. Please validate:
      
      Creds: sophie@photoscout.app / demo123 (verified pro user, lives in Austin), admin@photoscout.app / admin123 (super_admin).
      
      1) Posts CRUD:
         - POST /api/posts {category:"win", title:"Booked 4 sessions this month!", body:"So grateful.", city:"Austin", state:"TX"} as sophie → 200 with post_id; response.author.name matches sophie
         - Invalid category → 400 with enum list
         - GET /api/posts → {total, items[]}; recent post appears first with liked_by_me=false
         - GET /api/posts?category=win → filters correctly
         - POST /api/posts/{id}/like as admin → 200; GET as admin shows liked_by_me=true, like_count=1
         - Second like from same user → no count increase (idempotent)
         - DELETE /api/posts/{id}/like as admin → like_count=0
         - GET /api/posts/{id}/comments empty → []
         - POST /api/posts/{id}/comments {body:"congrats!"} as admin → 200; then GET comments has 1 item with author info
         - DELETE /api/posts/{id} as the author → 200
         - DELETE /api/posts/{id} as other user (not admin) → 403
         - DELETE /api/posts/{id} as admin → 200, audit log entry "post.remove" exists
      
      2) Photographers discovery:
         - GET /api/photographers/nearby as sophie (city=Austin auto) → 200 {city, count, items[]}
         - Items do NOT include sophie herself
         - Items do NOT include password_hash
         - ?city=Austin → same result
         - ?specialty=Family → items restricted to those with 'Family' in specialties[] (may be 0 which is fine)
      
      3) Messaging:
         - As sophie: POST /api/conversations {participant_user_id: <admin_user_id>} → 200 with conversation_id
         - Repeat same call → returns SAME conversation_id (idempotent via sorted participant_key)
         - POST /api/conversations with participant_user_id=<sophie's own> → 400
         - POST /api/conversations with unknown participant → 404
         - POST /api/conversations/{id}/messages {body:"hey!"} as sophie → 200 with message_id
         - GET /api/me/conversations as sophie → 1 conversation with last_message:"hey!", unread:0 (she sent it)
         - GET /api/me/conversations as admin → 1 conversation with unread:1
         - GET /api/conversations/{id}/messages as admin → 200 with msgs; then re-GET /me/conversations as admin → unread:0 (marked read)
         - GET /api/conversations/{id}/messages as a third user (create a fresh user or use a different login) → 404
         - Empty body POST message → 400
      
      4) Profile fields via PATCH /api/auth/me as sophie:
         - Body: {specialties:["Family","Pets"], service_area:"Austin & San Antonio", years_shooting:5, website:"https://petographytx.com", instagram:"@petographytx", available_for_second_shooter:true, mentorship_available:true, community_onboarded:true}
         - Then GET /api/auth/me → fields persisted exactly
      
      Do NOT run frontend UI tests. Main agent will ask user first.

    -agent: "testing"
    -message: |
      BACKEND TEST RESULTS (Phase 1 Community) — 1 critical blocker found.

      ✅ PASS
        - POST /api/spots regression (happy path + save_as_draft=true) — 2/2
        - Profile community fields PATCH/GET round-trip — 2/2 (all 8 fields persisted exactly)

      ❌ BLOCKED BY A SINGLE ROOT-CAUSE BUG (not 3 separate bugs):
        - Community posts CRUD — 0/12
        - Messaging conversations+messages — 0/4 real cases (one 404 was a false positive from routing, not from logic)
        - GET /api/photographers/nearby — 0/3

      ROOT CAUSE
        /app/backend/server.py line 2047 calls `app.include_router(api)` BEFORE the entire
        community block (lines 2060–2373) is executed. FastAPI's include_router() snapshots
        routes at call-time, so every @api.<method> decorator registered after line 2047 is
        silently dropped from the app.
        Confirmed via `curl http://localhost:8001/openapi.json`: 48 paths registered, ZERO
        community paths (/posts, /conversations, /me/conversations, /photographers/nearby,
        /community/onboarding-status all absent). Every call returns FastAPI's default
        404 {"detail":"Not Found"}.

      REQUIRED FIX (main agent):
        Move these two blocks:
          app.include_router(api)
          app.add_middleware(CORSMiddleware, ...)
        from their current position at lines 2047–2055 to the very BOTTOM of the module,
        right before `@app.on_event("startup")` (around line 2376). Do NOT register the
        router before all @api.<method> decorators have executed. Everything else in the
        community block looks correct by code review — this single relocation should
        unblock all 3 failing tasks.

      After the fix, please re-trigger backend testing so I can run the full Phase 1 suite
      (backend_test.py at /app/backend_test.py covers everything requested).
