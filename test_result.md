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
  PhotoScout — Admin Dashboard (Phase 1 of 3)
  Role hierarchy (user|moderator|support|admin|super_admin), require_role() gate,
  audit trail, platform settings, admin overview/users/user-detail/spots/reports/
  analytics/audit/settings screens, with destructive confirmations and role-based
  visibility. Legacy admin.tsx removed in favor of admin/ directory layout.

backend:
  - task: "Role hierarchy + require_role() dependency + super_admin promotion on startup"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "ROLE_LEVELS {user:0, moderator:1, support:1, admin:3, super_admin:4}. require_role(min_role) admits higher levels; always admits super_admin. Existing admin@ account is auto-promoted to super_admin on startup (idempotent)."
        -working: true
        -agent: "testing"
        -comment: "Verified. Login as admin@photoscout.app returns role='super_admin' confirming auto-promotion on startup. All require_role() gates returned 403 for sophie (non-admin) across every /admin/* endpoint."

  - task: "audit_log() helper + indexes (created_at, admin_user_id, target_id)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Writes one entry per admin write action (approve/reject/update/resolve/notes/settings). Fields: admin_user_id, admin_email, admin_role, action, target_type, target_id, before, after, notes, created_at."
        -working: true
        -agent: "testing"
        -comment: "Verified. Audit entries appear for user.update (with before.plan/after.plan diff), spot.approve (target_id matches), report.resolve.dismissed, and settings.update. admin_user_id is populated on all entries."

  - task: "GET /api/admin/overview — dashboard metrics (users, moderation queue, top contributors, trending cities, revenue estimate)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires moderator+. Emits users.{total,new_today,active_7d,suspended,by_plan{free/pro/elite}}, moderation.{pending_spots,pending_reports,pending_photos}, top_contributors[:5], top_cities[:5], revenue.monthly_estimate_usd (MOCKED Stripe)."
        -working: true
        -agent: "testing"
        -comment: "Shape verified exactly as spec. users.{total,new_today,active_7d,suspended,by_plan.{free,pro,elite}}, moderation.{pending_spots,pending_reports,pending_photos}, top_contributors & top_cities arrays, revenue.monthly_estimate_usd numeric. NOTE: revenue is a MOCKED estimate (pro*9 + elite*19) — Stripe not wired."

  - task: "GET /api/admin/users — paginated/filterable user search"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires support+. Supports q (regex over email/name/username/user_id), role/plan/status filters, page (default 1), limit (1..100, default 25). Returns {total, page, limit, pages, items[]}. Items enriched with spot_count + open_reports. Never returns password_hash."
        -working: true
        -agent: "testing"
        -comment: "Verified. q='sophie' returns total>=1 and sophie as items[0]. password_hash NOT present. Items carry plan/role/status/spot_count/open_reports. Pagination (page=1, limit=2) produces correct items.length<=2 and pages=ceil(total/limit)."

  - task: "GET /api/admin/users/{id} — full user detail incl. notes + recent audit"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires support+. Bundles counts, recent 5 spots, last 20 notes, last 20 audit entries. 404 for unknown user_id."
        -working: true
        -agent: "testing"
        -comment: "Verified. Response for sophie_id included notes[], recent_audit[], recent_spots[] as arrays, plus plan/role/status/spot_count/save_count/open_reports all present."

  - task: "PATCH /api/admin/users/{id} — plan/role/status/verification/comp in one call, audit-logged"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires admin+. Authorization: only super_admin can set role=admin/super_admin. Non-super-admin cannot modify a super_admin user. Admins cannot change their own role. Validates enums for plan/role/status. Returns fresh user. Emits before/after audit log."
        -working: true
        -agent: "testing"
        -comment: "Verified. plan='pro' succeeds (audit user.update before/after diff captured). plan='bogus' → 400. Changing own role (super_admin→admin) → 400. Notes: also verified reason field flows through to audit notes."

  - task: "POST /api/admin/users/{id}/notes — internal per-user notes"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires support+. 2000-char cap. Creates admin_notes doc with author_user_id + author_email. Emits audit log."
        -working: true
        -agent: "testing"
        -comment: "Verified. POST 'chargeback risk' → 200; subsequent GET /admin/users/{sophie_id} shows that exact note in notes[]."

  - task: "GET /api/admin/audit-logs — paginated audit trail, filter by action/admin/target"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires admin+. Supports action (prefix regex), admin_user_id, target_id filters. page/limit pagination. Sorted DESC by created_at."
        -working: true
        -agent: "testing"
        -comment: "Verified. action='user.update' prefix filter returns entries DESC by created_at. target_id filter returns spot.approve entry for the specific spot_id. admin_user_id populated on every entry."

  - task: "GET /api/admin/analytics — 30-day time-series + most saved leaderboard"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Requires moderator+. Days 1..90 (default 30). Series per UTC day: {signups, spots, approvals, rejections}. Totals sum. most_saved[:5] from spot_saves agg."
        -working: true
        -agent: "testing"
        -comment: "Verified. days=30 → series.length=30, totals.signups == sum(series[*].signups), most_saved array returned."

  - task: "GET/PATCH /api/admin/settings — platform settings singleton"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "GET requires admin+. PATCH requires super_admin. Fields: app_name, support_email, maintenance_mode, public_registration, auto_approve_verified, require_moderation_spots/_photos, duplicate_radius_m, default_privacy_mode, approximate_radius_km. Stored as singleton {settings_id:'platform_v1'}. Emits audit log on change."
        -working: true
        -agent: "testing"
        -comment: "Verified. GET returns app_name/maintenance_mode/public_registration (and more). PATCH support_email='test@photoscout.app' → 200 {ok:true, settings:{...}} and subsequent GET reflects the change. Sophie gets 403 on PATCH as expected."

  - task: "Existing admin endpoints — approve/reject/resolve now emit audit logs"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "admin/spots/{id}/approve, reject, reports/{id}/resolve now use require_role('moderator') and record audit_logs with spot.approve/spot.reject/report.resolve.{action}. Spot moderation also sets moderated_by + moderated_at."
        -working: false
        -agent: "testing"
        -comment: "POST /admin/spots/{id}/approve → works for super_admin, audit 'spot.approve' entry created with target_id matching. POST /admin/reports/{id}/resolve {action:'dismissed'} → works, audit 'report.resolve.dismissed' entry exists. BUG: Legacy GET /admin/pending (line ~1296) and GET /admin/reports (line ~1342) STILL use the hardcoded check `user.get('role') != 'admin'` and therefore reject super_admin users with 403. Since admin@ is auto-promoted to super_admin on startup, these endpoints are effectively broken for the default admin account. The review request explicitly required GET /admin/pending to return an array for super_admin. FIX: replace the inline `if user.get('role') != 'admin'` guard with `Depends(require_role('moderator'))` on admin_pending and admin_reports (same pattern already used by admin_approve/admin_reject/admin_resolve_report)."

frontend:
  - task: "admin/_layout.tsx — role-guarded layout with scrollable top tabs + role-based tab visibility"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Hard redirect for non-admin users (gate screen). Tabs: Overview, Users, Spots, Reports, Analytics (moderator+), Audit (admin+), Settings (super_admin only). Exit button returns to Profile."

  - task: "admin/index.tsx — dashboard overview with KPIs, queue cards, contributors, trending cities"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Pull-to-refresh. Tappable queue cards route to /admin/spots and /admin/reports."

  - task: "admin/users.tsx — paginated searchable user table with role/plan/status filters"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/users.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Horizontal chip strip of filters. Prev/Next pager. Each row shows plan/role/status pills + open report count. Taps → user detail."

  - task: "admin/user/[id].tsx — user detail: plan/role/status/verify actions + notes + audit + role confirmation modal"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/user/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Typed confirmation modal for role changes (must type exact role name). Plan chips grant immediate override. Suspend/verify toggle buttons. Notes composer + list. Recent admin activity feed."

  - task: "admin/spots.tsx — moderation queue (approve/reject) using new layout"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/spots.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Ported from legacy admin.tsx. Pull-to-refresh. Uses SpotCard + approve/reject buttons. Empty state when queue is clear."

  - task: "admin/reports.tsx — upgraded to live inside new layout (no duplicate chrome)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/reports.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Removed SafeAreaView + back button + role check (layout handles all three). Kept pending/resolved filter chips. resolve actions remain the same."

  - task: "admin/audit.tsx — audit log viewer with action-prefix filter and pagination"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/audit.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Shows action, actor (email + role), target, before/after JSON diff, notes. Filter box does prefix search. Pager for >50 entries."

  - task: "admin/analytics.tsx — 30-day signup/spot/approval SVG charts + most saved leaderboard"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/analytics.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Three charts using react-native-svg. Totals strip. 'Most saved spots' leaderboard."

  - task: "admin/settings.tsx — platform settings editor (super_admin-only writes)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/settings.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "View-only banner when not super_admin. Toggles for maintenance/registration/moderation/auto-approve. Text rows save on explicit Save tap after typing changes. Maintenance mode is UI-only today (Phase 2 wires backend enforcement)."

metadata:
  created_by: "main_agent"
  version: "1.4"
  test_sequence: 4
  run_ui: false

test_plan:
  current_focus:
    - "Existing admin endpoints — approve/reject/resolve now emit audit logs"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Phase 1 Admin Dashboard backend is live. Please validate in this order:
      AUTH RULES (critical):
      - admin@photoscout.app / admin123 is now SUPER_ADMIN on startup (auto-promoted).
      - Non-admin users (e.g. sophie@photoscout.app / demo123) MUST get 403 from every /admin/* endpoint.
      
      NEW ENDPOINTS (all under /api/admin/*):
      1) GET /overview — as super_admin, assert shape matches spec (users.total, users.by_plan.{free,pro,elite}, moderation.*, top_contributors[], top_cities[], revenue.monthly_estimate_usd).
      2) GET /users?q=&role=&plan=&status=&page=&limit= — as super_admin:
         - q="sophie" returns sophie in items
         - role="user" filters correctly, each item has plan/role/status/spot_count/open_reports, NEVER password_hash
         - page=2&limit=1 works (pager math correct)
      3) GET /users/{id} — returns notes, recent_audit, spot_count, save_count, open_reports arrays.
      4) PATCH /users/{id} — as super_admin on sophie:
         - plan="pro" succeeds, audit log entry appears
         - plan="bogus" returns 400
         - role="admin" succeeds, audit entry action="user.update" with before.role="user" / after.role="admin"
         - Then login as a plain admin (create temporarily via direct promotion if needed, or just skip this sub-test)
           — non-super-admin cannot set role to super_admin (403)
         - Admins cannot change their own role (400)
      5) POST /users/{id}/notes — body "chargeback risk", verify note appears in subsequent GET /users/{id}.notes.
      6) GET /audit-logs?action=user.update — returns the prior update; pagination fields present.
      7) GET /analytics?days=30 — series length 30, totals match sum(series), most_saved array present.
      8) GET /settings — returns the singleton with default fields.
         PATCH /settings {"support_email":"foo@bar.com"} as super_admin — returns {ok:true, settings:{...}}.
         PATCH /settings as sophie (normal user) — 403.
         PATCH /settings as a plain 'admin' (non-super) — 403 (super_admin required).
      
      Regression:
      - POST /admin/spots/{id}/approve and /reject now require moderator+; audit_logs entry with action "spot.approve"/"spot.reject" appears.
      - POST /admin/reports/{id}/resolve with body {"action":"dismissed"} still works and emits audit "report.resolve.dismissed".
      
      Do NOT run frontend UI tests. Main agent will ask user first.
      
      Revert helper: after testing, please set sophie back to plan="pro" if you changed her plan (role should already be "user").
    -agent: "testing"
    -message: |
      Admin Dashboard Phase 1 backend validation complete — 64/65 checks PASSED.

      ALL NEW ENDPOINTS PASSED:
      - Auth guards: sophie gets 403 on every /admin/* endpoint in the list (overview, users list, user detail, user PATCH, user notes, audit-logs, analytics, settings GET, settings PATCH).
      - admin@photoscout.app is auto-promoted to super_admin on startup (verified on login).
      - GET /admin/overview — shape matches spec exactly (users.*, moderation.*, top_contributors[], top_cities[], revenue.monthly_estimate_usd numeric). revenue is a MOCKED estimate (Stripe not wired).
      - GET /admin/users — search, filter, pagination, enrichment (spot_count/open_reports), password_hash never exposed.
      - GET /admin/users/{id} — notes[], recent_audit[], recent_spots[], plus all enrichment fields.
      - PATCH /admin/users/{id} — plan='pro' succeeds with before/after audit diff; plan='bogus' → 400; self-role-change for super_admin → 400.
      - POST /admin/users/{id}/notes — note persisted and visible in user detail.
      - GET /admin/audit-logs — prefix filter on action works; admin_user_id populated on entries.
      - GET /admin/analytics?days=30 — series.length==30, totals == sum(series), most_saved[] present.
      - GET /admin/settings / PATCH /admin/settings (super_admin only) — round-trip of support_email confirmed.
      - POST /admin/spots/{id}/approve and POST /admin/reports/{id}/resolve both emit audit logs with correct action and target_id.

      ONE REGRESSION FAILURE (existing legacy endpoints):
      - GET /admin/pending returns 403 for super_admin. Root cause: line ~1297 still uses the hardcoded `if user.get('role') != 'admin'` check. Because admin@ is auto-promoted to super_admin on startup, this check now rejects the default admin account.
      - GET /admin/reports has the identical bug on line ~1343.
      - FIX: swap those two inline role checks for `Depends(require_role('moderator'))` — the same dependency already used by admin_approve / admin_reject / admin_resolve_report further down. Two-line change. Marked task "Existing admin endpoints — approve/reject/resolve now emit audit logs" as working: false until this is fixed.

      CLEANUP: sophie left on plan='pro' per request.

      Backend test script: /app/backend_test.py
