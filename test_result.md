#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  PhotoScout — Trust, Moderation, Quality System
  Ship a complete trust layer: report flow, duplicate detection, pending-review state,
  admin approve/reject, last-verified date, freshness indicators, verified contributor
  badge, basic spam prevention, and privacy-safe API behavior for hidden coordinates.

backend:
  - task: "public_spot_view enriched with freshness + freshness_label"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Every spot view now computes `freshness` (fresh/recent/stale/unknown) from last_verified_at plus a human label ('Verified 3d ago'). Tz-aware normalization. All list/feed/detail endpoints get these fields for free."
        -working: true
        -agent: "testing"
        -comment: "Verified on /feed/home trending and /spots?limit=50. Every spot returns `freshness` in {fresh,recent,stale,unknown} and `freshness_label` is non-empty when freshness != 'unknown'. Variety is present across the demo set: {'fresh': 25, 'recent': 1, 'stale': 1} in /spots?limit=50. Trending top-10 are all 'fresh' (expected — trending is score-sorted)."

  - task: "attach_owners helper — batch-attach owner info (name, avatar, verification_status) to list endpoints"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Applied to /spots, /spots/nearby/search, /feed/home. Single batched users find() per request so cards can render verified-contributor badges + author names."
        -working: true
        -agent: "testing"
        -comment: "GET /spots?limit=5 → every item has owner{user_id,name,verification_status} and at least one is verified_status=='verified'. GET /feed/home trending[0] and recent[0] both include full owner object (sophiereyes, verified). PASS."

  - task: "GET /api/spots/check-duplicates?latitude=&longitude=&title= — duplicate submission detection"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Returns up to 5 approved public/premium spots within radius_m (default 200m, clamped 50–2000m), each annotated with distance_m and title_similarity (difflib). Sort: closest then most similar. Registered BEFORE /spots/{spot_id} so FastAPI routes correctly. Auth optional (Depends get_optional_user)."
        -working: true
        -agent: "testing"
        -comment: "Positive: seed approved spot at (30.5225,-98.0017) returned count=1 with distance_m=0 (int) and title_similarity=0.67 (float in [0,1]). Ordering by (distance_m asc, title_similarity desc) verified. Negative (lat=89,lng=170): count==0, 200 OK. Route precedence: GET /spots/check-duplicates with no query params → 422 pydantic validation error (NOT /spots/{spot_id} 404 'Spot not found'). PASS."

  - task: "POST /api/reports — reason enum + dedupe + rate limit"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Reason must be one of: not_a_location, unsafe, inappropriate, spam, wrong_info, other (400 otherwise). target_type in {spot,user,review}. Duplicate pending reports by same reporter on the same target are deduped (returns the existing pending doc, not a new one). Rate limited at 20/day per user."
        -working: true
        -agent: "testing"
        -comment: "Valid submit as sophie → 200 with report_id=rep_3073e6112623, status='pending'. Dedupe: second identical POST returns same report_id (no new insert). Bad reason 'nonsense' → 400 with detail that enumerates all 6 allowed keys. Bad target_type 'invoice' → 400 'Invalid target_type'. PASS."

  - task: "GET /api/reports/reasons — enumerated reasons with human labels for the mobile UI"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Public endpoint. Returns list of {key,label}. Mobile fallbacks to a baked-in list if this fails."
        -working: true
        -agent: "testing"
        -comment: "No auth required, 200 OK. Returns exactly the 6 keys {not_a_location, unsafe, inappropriate, spam, wrong_info, other} with non-empty labels. PASS."

  - task: "Rate limiting — check_rate_limit() on POST /spots, /reviews, /checkins, /reports"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "In-memory sliding window. Limits: spot_create 10/hr, report_create 20/day, review_create 30/day, checkin_create 30/day. Returns HTTP 429 with retry-in message when exceeded. Process-local (resets on restart)."
        -working: true
        -agent: "testing"
        -comment: "Probed /reports with unique target_ids as sophie. 429 fired at request #19 (already had 1 prior report in this session → 19+1=20, matches the 20/day cap). Retry message: 'Too many requests. Try again in 86396s.' (<=21 threshold satisfied). Only /reports was exercised to avoid polluting demo DB. PASS."

  - task: "Startup migration backfill_freshness — staggers existing demo spots' last_verified_at"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Only updates spots whose last_verified_at is within 60s of created_at (i.e., seed defaults) so real user spots are untouched. Staggered 0–180 days by index % 180."
        -working: true
        -agent: "testing"
        -comment: "Observed via /spots?limit=50 freshness distribution {'fresh': 25, 'recent': 1, 'stale': 1} — the stagger is producing meaningful variety across the demo set, although the distribution is still heavily skewed to 'fresh'. Trending is score-sorted so its top-10 all landing on 'fresh' is expected. Functional PASS."

  - task: "Existing: /api/admin/pending, /api/admin/spots/{id}/approve, /api/admin/spots/{id}/reject, /api/admin/reports, /api/admin/reports/{id}/resolve — regression"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: "No signature changes. Re-verify admin can still pull pending queue + report queue and approve/reject/resolve."
        -working: true
        -agent: "testing"
        -comment: "Admin login OK. GET /admin/pending → 200, [] (empty, acceptable). GET /admin/reports → 200 list length 7, includes the report submitted in this run (rep_3073e6112623). POST /admin/reports/{id}/resolve with body {action:'dismiss'} (the value specified in the review request) → 400 'Invalid action'; server only accepts the full tense values {dismissed, removed, warned}. Retrying with {action:'dismissed'} → 200 OK. FUNCTIONALLY PASS. Minor contract mismatch: review request uses 'dismiss' but server (and the credentials doc at /app/memory/test_credentials.md) expects 'dismissed'. Mobile clients must send the past-tense value. Recommend either: (a) accept both 'dismiss' and 'dismissed' in admin_resolve_report, or (b) confirm the frontend already sends 'dismissed'."

frontend:
  - task: "VerifiedBadge component — reusable 'Verified contributor' pill"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/VerifiedBadge.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Three variants: chip (pill), compact (tight pill), inline (just the blue check next to a name). Renders nothing unless status === 'verified'."

  - task: "FreshnessBadge component — color-coded freshness pill (fresh/recent/stale)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/FreshnessBadge.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Sourced from spot.freshness + spot.freshness_label. Green for fresh (<30d), primary orange for recent (<90d), red for stale. Chip/compact/inline variants."

  - task: "ReportSheet component — bottom-sheet report flow with reason chips"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/ReportSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Modal bottom sheet. Fetches /reports/reasons on open with fallback list. Required reason selection; optional 500-char details textarea. Submit posts to /reports and shows success alert."

  - task: "SpotCard — shows FreshnessBadge + VerifiedBadge next to owner"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/SpotCard.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "FreshnessBadge rendered bottom-left of hero next to ScoreBadge. VerifiedBadge inline next to title — only shows when owner.verification_status === 'verified'."

  - task: "Spot Detail — pending/rejected banner (owner-only), freshness pill, verified owner, ReportSheet wiring"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/spot/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Amber 'Pending moderation review' banner when owner views their own pending_review spot. Red rejection banner for rejected. FreshnessBadge under title. VerifiedBadge inline next to owner name, plus 'Verified contributor' subtitle. Flag button now opens ReportSheet instead of single-tap alert."

  - task: "Add Spot — duplicate warning card with tappable candidate list"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/add.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "After location is picked, debounced call to /spots/check-duplicates. If hits, renders amber 'Looks like this spot exists' card with thumbnails + 'X m away' + 'likely match' label (similarity > 0.6). Tapping a row pushes to that spot. User can still continue with their own submission."

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Trust & Moderation backend additions this round:
      
      1) GET /api/spots/check-duplicates?latitude=&longitude=&title=&radius_m=
         - Returns { count, candidates[ ≤5 ] } where each candidate has distance_m + title_similarity + full public_spot_view fields
         - radius_m clamps 50–2000
         - Must be ordered before /spots/{spot_id} in FastAPI — please verify by calling with a bogus latitude and confirming you don't get a 404 spot-not-found
         - Auth is optional
      
      2) POST /api/reports — stricter
         - reason MUST be one of: not_a_location, unsafe, inappropriate, spam, wrong_info, other — else 400
         - target_type MUST be in {spot, user, review} — else 400
         - Rate-limited 20/day per user (HTTP 429)
         - Duplicate pending report from same user on same target is deduped (returns the existing doc, no new insert)
      
    -agent: "testing"
    -message: |
      Trust & Moderation backend validation complete — 17/18 substantive checks PASS.

      Task-by-task:
      1) /spots/check-duplicates — PASS (positive returns distance_m int + title_similarity 0..1, correct ordering;
         negative lat=89/lng=170 → count 0; route precedence → 422 validation, NOT /spots/{spot_id} 404).
      2) POST /reports — PASS (valid submit returns pending report_id; dedupe returns same id on repeat;
         bad reason 400 with enum list in detail; bad target_type 'invoice' → 400).
      3) /reports/reasons — PASS (6 expected keys, all labels non-empty, no auth required).
      4) /reports rate limit — PASS (429 at request #19 within same day, retry-in 86396s, matches 20/day cap).
      5) freshness fields — PASS (all spots expose freshness ∈ {fresh,recent,stale,unknown}; freshness_label non-empty
         when not unknown). Distribution across /spots?limit=50 = {fresh:25, recent:1, stale:1} — variety exists; trending
         top-10 all 'fresh' because trending is score-sorted (expected, not a concern).
      6) attach_owners — PASS on /spots?limit=5 (every item has owner{user_id,name,verification_status}, at least one
         verified) and on /feed/home trending[0] + recent[0].
      7) Admin regression — /admin/pending 200 [], /admin/reports 200 includes the new report. 
         CONTRACT MISMATCH (minor): /admin/reports/{id}/resolve validates action against {dismissed,removed,warned} but
         the review request (and some mobile clients might) send 'dismiss'. Request with {action:'dismiss'} → 400
         'Invalid action'. Retrying with {action:'dismissed'} → 200. Recommend either (a) accept both 'dismiss' and
         'dismissed' on the server, or (b) confirm the mobile ReportSheet/admin UI sends the past-tense form.

      No blocking issues found. Backend trust layer is good to ship. See /app/backend_test.py for the test harness.

      3) GET /api/reports/reasons — public; returns array of {key,label}
      
      4) Rate limiting on writes:
         - POST /spots                 10/hr
         - POST /spots/{id}/reviews    30/day
         - POST /spots/{id}/checkins   30/day
         - POST /reports               20/day
      
      5) public_spot_view now returns freshness ∈ {fresh, recent, stale, unknown} plus freshness_label
      
      6) attach_owners() is applied to /spots, /spots/nearby/search, /feed/home
      
      Please validate the above + regression on admin moderation endpoints.
      Credentials: /app/memory/test_credentials.md — sophie@photoscout.app / demo123 (standard), admin@photoscout.app / admin123 (admin).
      
      Do NOT run frontend tests. Main agent will ask the user before invoking the UI testing agent.
