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
  PhotoScout — Flexible Location Entry for Portfolio Imports
  Replace rigid GPS-only location entry with 4 methods (Current GPS / Search a
  place / Drop pin on map / Enter manually), add recent-location quick-pick
  for bulk portfolio imports, and add Save-as-Draft. Photographers must be able
  to create spots from past shoots without standing at the location.

backend:
  - task: "Spot model — new location-provenance fields (source_type, original_search_query, geocode_confidence, imported_from_bulk_mode, address_line1, postal_code, landmark_notes, save_as_draft)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "SpotCreateIn gained 8 optional fields. source_type enum (frontend-side): gps|searched_place|dropped_pin|manual_entry|metadata_detected. save_as_draft is NOT persisted — it's stripped from doc and used only to force visibility_status='draft'."
        -working: true
        -agent: "testing"
        -comment: "Verified via POST /api/spots as sophie: source_type='manual_entry' and original_search_query='McAllister' round-trip in the response. save_as_draft is popped (not present on response). All provenance fields persist."

  - task: "POST /api/spots — save_as_draft=true forces visibility_status='draft' (owner-only, no moderation)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Drafts bypass moderation regardless of privacy_mode. doc does NOT include save_as_draft (popped). Response includes visibility_status='draft'. Regression: non-draft public posts still enter pending_review (or approved for verified contributors)."
        -working: true
        -agent: "testing"
        -comment: "1A public+draft → visibility_status='draft' ✅. 1B private+draft → 'draft' ✅. 1C public+non-draft (sophie verified pro) → 'approved' ✅. Response has no save_as_draft field."

  - task: "GET /api/geocode/search?q=&limit=&country= — OSM Nominatim autocomplete proxy (keyless)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "q<2 chars returns empty. Clamps limit 1..15. Shapes response as {query, results: [{place_id, display_name, latitude, longitude, name, city, state, country, postcode, type, confidence}]}. Falls back gracefully on Nominatim errors (returns empty with error field, never 5xx)."
        -working: true
        -agent: "testing"
        -comment: "q='' and q='a' → results:[] ✅. q='McAllister Park' → returns first result with lat/lng/city/state/confidence(0..1)/place_id/display_name all populated ✅. limit=20 clamped to <=15 (returned 7) ✅."

  - task: "GET /api/geocode/reverse?lat=&lng= — OSM reverse geocode for dropped pins"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Returns same shape as search item. Used post-pin-drop to label coordinates with nearest city/state."
        -working: true
        -agent: "testing"
        -comment: "reverse(30.2672,-97.7431) → city='Austin', state='Texas', display_name='Downtown, Austin, Travis County, Texas, 78701, United States' ✅."

  - task: "GET /api/me/recent-locations?limit= — distinct recent locations for one-tap reuse"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Dedupes by (round(lat,3), round(lng,3), city.lower()). Clamps limit 1..30. Sort: most recent first. Returns {count, items:[{title, city, state, latitude, longitude, source_type, last_used_at}]}."
        -working: true
        -agent: "testing"
        -comment: "Default returns {count, items[]} with title/city/state/latitude/longitude ✅. limit=50 clamped to 30 ✅. Dedup verified: two distinct spots created at lat=30.27,lng=-97.74,city=Austin dedupe to a single items entry (matched=1) ✅."

  - task: "GET /api/me/drafts — owner's draft spots"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Returns visibility_status='draft' spots for the caller. Uses public_spot_view so owner sees exact coords."
        -working: true
        -agent: "testing"
        -comment: "Sophie's /me/drafts includes her 1A draft; all returned entries have visibility_status='draft'. Admin's /me/drafts does NOT include sophie's draft (scoped to caller) ✅."

  - task: "POST /api/spots/{id}/publish-draft — promote draft to pending_review or approved"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "403 if not owner, 404 if not found, 400 if already not-draft. Public/premium → pending_review (or approved for verified contributors). Private → approved."
        -working: true
        -agent: "testing"
        -comment: "Owner publish returned {ok:true, visibility_status:'approved'} (sophie verified) ✅. Re-publish same → 400 'Not a draft' ✅. Admin on sophie's draft → 403 'Not your draft' ✅. nonexistent_id → 404 'Not found' ✅."

frontend:
  - task: "LocationSearchSheet — autocomplete place search with manual-entry fallback"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/LocationSearchSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Page-sheet modal, debounced 350ms hit to /geocode/search. Empty-state with 'Create custom location manually' CTA. FlatList of results with display_name preview."

  - task: "MapPickerSheet — drop pin with draggable marker + reverse geocode + center-on-me"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/MapPickerSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Uses react-native-maps (lazy-required so web doesn't choke). Tap-to-drop, drag-to-adjust. Reverse geocodes on each update. Web fallback screen. 'My location' crosshair button (graceful if permission denied)."

  - task: "ManualLocationSheet — typed entry with optional coordinates"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/ManualLocationSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Required: title, city, state (2-char). Optional: address_line1, postal_code, country, lat, lng, landmark_notes. Pure typed entry — no API calls — so it works without GPS or connectivity."

  - task: "Add Spot flow — steps reordered (Photos first, Location second) with 4-method picker, recent-locations reuse, save-as-draft"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/add.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "New STEPS order: Photos → Location → Details → Notes → Privacy → Review. Location step is a 4-card picker (Current GPS / Search / Drop pin / Manual) with a horizontal Recent Locations strip above. Review step now has both Save-draft (outline button) and Publish spot (primary). Removed forced GPS; permission denial is handled gracefully. Duplicate check still runs after location is set."

metadata:
  created_by: "main_agent"
  version: "1.4"
  test_sequence: 4
  run_ui: false

test_plan:
  current_focus:
    - "Spot model — new location-provenance fields (source_type, original_search_query, geocode_confidence, imported_from_bulk_mode, address_line1, postal_code, landmark_notes, save_as_draft)"
    - "POST /api/spots — save_as_draft=true forces visibility_status='draft' (owner-only, no moderation)"
    - "GET /api/geocode/search?q=&limit=&country= — OSM Nominatim autocomplete proxy (keyless)"
    - "GET /api/geocode/reverse?lat=&lng= — OSM reverse geocode for dropped pins"
    - "GET /api/me/recent-locations?limit= — distinct recent locations for one-tap reuse"
    - "GET /api/me/drafts — owner's draft spots"
    - "POST /api/spots/{id}/publish-draft — promote draft to pending_review or approved"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Flexible location entry backend is live. Please validate these in order:
      
      Creds: sophie@photoscout.app / demo123 (verified pro user) and admin@photoscout.app / admin123 (super_admin).
      
      1) POST /api/spots with save_as_draft=true:
         - privacy_mode="public" + save_as_draft=true → visibility_status MUST be "draft" (NOT pending_review)
         - privacy_mode="private" + save_as_draft=true → visibility_status MUST be "draft"
         - Regression: save_as_draft=false + privacy_mode="public" → visibility_status ∈ {"pending_review", "approved"} (approved if verified)
         - Confirm the persisted doc does NOT contain a "save_as_draft" field (only visibility_status)
         - Confirm source_type/original_search_query/geocode_confidence/address_line1/postal_code/landmark_notes are persisted when provided
      
      2) GET /api/geocode/search:
         - q="" → {results: []}
         - q="a" (1 char) → {results: []}
         - q="McAllister Park" → results.length ≥ 1; first result has latitude/longitude (non-null), city, state, confidence (0..1), place_id
         - limit=20 → clamped to 15
         - Nominatim may be slow; timeout is 8s, on error returns 200 with empty results + error field (not 5xx)
      
      3) GET /api/geocode/reverse?lat=30.2672&lng=-97.7431:
         - Returns object with city (should contain "Austin"), state ("Texas"), country, display_name
      
      4) GET /api/me/recent-locations (auth required, sophie):
         - Returns {count, items[]} ordered newest first
         - Dedupes: if sophie has 2 spots at the exact same lat/lng/city, items has only 1 entry
         - limit=50 clamps to 30
      
      5) GET /api/me/drafts:
         - Create a draft via step 1 then confirm it appears in /me/drafts
         - Other users' drafts do NOT appear
      
      6) POST /api/spots/{draft_id}/publish-draft:
         - Owner: 200 {ok:true, visibility_status:"pending_review"} for public draft (or "approved" if sophie is verified)
         - Non-owner: 403
         - Non-existent id: 404
         - Re-publishing same draft: 400 "Not a draft"
      
      Do NOT run frontend UI tests. Main agent will ask user before invoking UI testing agent.

    -agent: "testing"
    -message: |
      Backend validation complete — 29/29 checks PASS across all 7 Flexible Location Entry tasks.
      Sophie's login confirms verification_status='verified' and plan='pro', so 1C and 6A returned 'approved'
      (within the allowed set {pending_review, approved}). Nominatim upstream responded within 2s; no
      graceful-degradation path exercised but error-field handling is wired in. All created spots were
      cleaned up via DELETE /api/spots/{id}. No critical or minor issues found. Recommend main agent
      finalize and move on — do not re-test unless new changes land.
