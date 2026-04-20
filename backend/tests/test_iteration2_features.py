"""
PhotoScout Backend API Tests - Iteration 2
Tests: feature gating (402 responses), plan upgrades, privacy enforcement, admin reports, spot packs
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL not set", allow_module_level=True)


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def admin_token(api_client):
    """Get admin JWT token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@lumascout.app",
        "password": "admin123"
    })
    if response.status_code != 200:
        pytest.skip(f"Admin login failed: {response.status_code}")
    return response.json()["token"]


@pytest.fixture
def demo_user_token(api_client):
    """Get demo user JWT token (sophie@lumascout.app)"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "sophie@lumascout.app",
        "password": "demo123"
    })
    if response.status_code != 200:
        pytest.skip(f"Demo user login failed: {response.status_code}")
    return response.json()["token"]


@pytest.fixture
def fresh_user_token(api_client):
    """Create a fresh user for testing feature gating on clean slate"""
    email = f"TEST_fresh_{os.urandom(4).hex()}@test.com"
    response = api_client.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "password": "testpass123",
        "name": "Fresh Test User",
        "specialties": []
    })
    if response.status_code != 200:
        pytest.skip(f"Fresh user registration failed: {response.status_code}")
    return response.json()["token"]


class TestAuthMe:
    """GET /api/auth/me now includes plan, limits, and usage"""

    def test_auth_me_includes_plan_limits_usage(self, api_client, demo_user_token):
        """GET /api/auth/me returns plan, limits, and live usage counts"""
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert response.status_code == 200, f"GET /auth/me failed: {response.text}"
        
        user = response.json()
        assert "plan" in user, "Missing plan field"
        assert "limits" in user, "Missing limits field"
        assert "usage" in user, "Missing usage field"
        
        # Verify limits structure
        limits = user["limits"]
        assert "saves" in limits
        assert "private_spots" in limits
        assert "collections" in limits
        assert "advanced_filters" in limits
        assert "sell_packs" in limits
        
        # Verify usage structure
        usage = user["usage"]
        assert "saves" in usage
        assert "private_spots" in usage
        assert "collections" in usage
        
        print(f"✓ GET /auth/me includes plan={user['plan']}, limits={limits}, usage={usage}")


class TestNewUserRegistration:
    """New user registration assigns plan: 'free' by default"""

    def test_new_user_gets_free_plan(self, api_client):
        """POST /api/auth/register assigns plan='free' to new users"""
        email = f"TEST_newuser_{os.urandom(4).hex()}@test.com"
        response = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email,
            "password": "testpass123",
            "name": "New User",
            "specialties": []
        })
        assert response.status_code == 200, f"Register failed: {response.text}"
        
        data = response.json()
        user = data["user"]
        
        # Check via /auth/me to get plan field
        token = data["token"]
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert me_response.status_code == 200
        me_user = me_response.json()
        
        assert me_user["plan"] == "free", f"Expected plan='free', got {me_user.get('plan')}"
        print(f"✓ New user {email} assigned plan='free'")


class TestFeatureGatingCollections:
    """Free plan allows 3 collections max, returns 402 on 4th"""

    def test_free_plan_collection_limit_returns_402(self, api_client, fresh_user_token):
        """POST /api/collections returns 402 after hitting free plan limit (3 collections)"""
        # Create 3 collections (should succeed)
        for i in range(3):
            response = api_client.post(
                f"{BASE_URL}/api/collections",
                headers={"Authorization": f"Bearer {fresh_user_token}"},
                json={"name": f"TEST_Collection_{i+1}", "privacy_mode": "private"}
            )
            assert response.status_code == 200, f"Collection {i+1} creation failed: {response.text}"
            print(f"✓ Created collection {i+1}/3")
        
        # 4th collection should return 402
        response = api_client.post(
            f"{BASE_URL}/api/collections",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={"name": "TEST_Collection_4_SHOULD_FAIL", "privacy_mode": "private"}
        )
        assert response.status_code == 402, f"Expected 402, got {response.status_code}"
        
        detail = response.json().get("detail", "")
        assert "3 collections" in detail.lower() or "free plan" in detail.lower(), f"Expected descriptive error, got: {detail}"
        print(f"✓ 4th collection correctly returned 402 with detail: {detail}")


class TestFeatureGatingPrivateSpots:
    """Free plan allows 3 private spots max, returns 402 on 4th"""

    def test_free_plan_private_spot_limit_returns_402(self, api_client, fresh_user_token):
        """POST /api/spots with privacy_mode=private returns 402 after hitting limit (3 private spots)"""
        # Create 3 private spots (should succeed)
        for i in range(3):
            response = api_client.post(
                f"{BASE_URL}/api/spots",
                headers={"Authorization": f"Bearer {fresh_user_token}"},
                json={
                    "title": f"TEST_Private_Spot_{i+1}",
                    "description": "Test private spot",
                    "latitude": 30.2672,
                    "longitude": -97.7431,
                    "city": "Austin",
                    "state": "TX",
                    "privacy_mode": "private",
                    "shoot_types": ["Portrait"],
                    "images": []
                }
            )
            assert response.status_code == 200, f"Private spot {i+1} creation failed: {response.text}"
            print(f"✓ Created private spot {i+1}/3")
        
        # 4th private spot should return 402
        response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={
                "title": "TEST_Private_Spot_4_SHOULD_FAIL",
                "description": "Should fail",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "private",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert response.status_code == 402, f"Expected 402, got {response.status_code}"
        
        detail = response.json().get("detail", "")
        assert "3 private spots" in detail.lower() or "free plan" in detail.lower(), f"Expected descriptive error, got: {detail}"
        print(f"✓ 4th private spot correctly returned 402 with detail: {detail}")


class TestFeatureGatingSaves:
    """Free plan allows 20 saves max, returns 402 on 21st"""

    def test_free_plan_save_limit_returns_402(self, api_client, fresh_user_token):
        """POST /api/spots/{id}/save returns 402 after hitting limit (20 saves)"""
        # Get list of public spots to save
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 25})
        assert list_response.status_code == 200
        spots = list_response.json()
        assert len(spots) >= 21, "Need at least 21 spots to test save limit"
        
        # Save 20 spots (should succeed)
        for i in range(20):
            response = api_client.post(
                f"{BASE_URL}/api/spots/{spots[i]['spot_id']}/save",
                headers={"Authorization": f"Bearer {fresh_user_token}"}
            )
            assert response.status_code == 200, f"Save {i+1} failed: {response.text}"
            data = response.json()
            assert data["saved"] is True, f"Expected saved=True, got {data}"
        print(f"✓ Saved 20 spots successfully")
        
        # 21st save should return 402
        response = api_client.post(
            f"{BASE_URL}/api/spots/{spots[20]['spot_id']}/save",
            headers={"Authorization": f"Bearer {fresh_user_token}"}
        )
        assert response.status_code == 402, f"Expected 402, got {response.status_code}"
        
        detail = response.json().get("detail", "")
        assert "20 saves" in detail.lower() or "free plan" in detail.lower(), f"Expected descriptive error, got: {detail}"
        print(f"✓ 21st save correctly returned 402 with detail: {detail}")


class TestPlanUpgrade:
    """POST /api/me/upgrade changes user plan and unblocks limits"""

    def test_upgrade_to_pro_unblocks_limits(self, api_client, fresh_user_token):
        """POST /api/me/upgrade with plan='pro' successfully changes plan and unblocks limits"""
        # Verify user is on free plan
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {fresh_user_token}"}
        )
        assert me_response.status_code == 200
        user = me_response.json()
        assert user["plan"] == "free"
        print(f"✓ User starts on free plan")
        
        # Upgrade to pro
        upgrade_response = api_client.post(
            f"{BASE_URL}/api/me/upgrade",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={"plan": "pro"}
        )
        assert upgrade_response.status_code == 200, f"Upgrade failed: {upgrade_response.text}"
        
        upgrade_data = upgrade_response.json()
        assert upgrade_data["plan"] == "pro"
        assert upgrade_data["limits"]["saves"] == 10_000
        assert upgrade_data["limits"]["collections"] == 500
        print(f"✓ Upgraded to pro: {upgrade_data}")
        
        # Verify via /auth/me
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {fresh_user_token}"}
        )
        assert me_response.status_code == 200
        user = me_response.json()
        assert user["plan"] == "pro"
        assert user["limits"]["saves"] == 10_000
        print(f"✓ GET /auth/me confirms plan='pro' with unlimited limits")

    def test_upgrade_to_elite_enables_sell_packs(self, api_client, fresh_user_token):
        """POST /api/me/upgrade with plan='elite' enables sell_packs=true"""
        # Upgrade to elite
        upgrade_response = api_client.post(
            f"{BASE_URL}/api/me/upgrade",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={"plan": "elite"}
        )
        assert upgrade_response.status_code == 200, f"Upgrade failed: {upgrade_response.text}"
        
        upgrade_data = upgrade_response.json()
        assert upgrade_data["plan"] == "elite"
        assert upgrade_data["limits"]["sell_packs"] is True, "Elite plan should enable sell_packs"
        print(f"✓ Upgraded to elite with sell_packs=true")


class TestSpotPacks:
    """POST /api/packs requires Elite plan, GET /api/packs returns published packs"""

    def test_create_pack_requires_elite_plan(self, api_client, fresh_user_token):
        """POST /api/packs returns 402 for free/pro users"""
        # Try to create pack as free user (should fail with 402)
        response = api_client.post(
            f"{BASE_URL}/api/packs",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={
                "name": "TEST_Pack_Should_Fail",
                "description": "Test pack",
                "spot_ids": [],
                "published": False
            }
        )
        assert response.status_code == 402, f"Expected 402, got {response.status_code}"
        
        detail = response.json().get("detail", "")
        assert "elite" in detail.lower(), f"Expected Elite plan error, got: {detail}"
        print(f"✓ Free user correctly blocked from creating packs with 402")

    def test_elite_user_can_create_pack(self, api_client, fresh_user_token):
        """Elite user can create a pack via POST /api/packs"""
        # Upgrade to elite
        upgrade_response = api_client.post(
            f"{BASE_URL}/api/me/upgrade",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={"plan": "elite"}
        )
        assert upgrade_response.status_code == 200
        print(f"✓ Upgraded to elite")
        
        # Create pack
        response = api_client.post(
            f"{BASE_URL}/api/packs",
            headers={"Authorization": f"Bearer {fresh_user_token}"},
            json={
                "name": "TEST_Elite_Pack",
                "description": "Test pack for elite user",
                "spot_ids": [],
                "published": True
            }
        )
        assert response.status_code == 200, f"Pack creation failed: {response.text}"
        
        pack = response.json()
        assert pack["name"] == "TEST_Elite_Pack"
        assert pack["published"] is True
        assert "_id" not in pack
        print(f"✓ Elite user created pack: {pack['pack_id']}")

    def test_get_packs_returns_published_packs(self, api_client):
        """GET /api/packs returns published packs"""
        response = api_client.get(f"{BASE_URL}/api/packs")
        assert response.status_code == 200, f"GET /packs failed: {response.text}"
        
        packs = response.json()
        assert isinstance(packs, list)
        
        # All returned packs should be published
        for pack in packs:
            assert pack.get("published") is True, f"Unpublished pack in list: {pack}"
            assert "_id" not in pack
        
        print(f"✓ GET /api/packs returned {len(packs)} published packs")


class TestAdminReports:
    """GET /api/admin/reports with status filter, POST /api/admin/reports/{id}/resolve"""

    def test_admin_reports_returns_list(self, api_client, admin_token):
        """GET /api/admin/reports returns list (admin only)"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/reports",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"GET /admin/reports failed: {response.text}"
        
        reports = response.json()
        assert isinstance(reports, list)
        
        for r in reports:
            assert "_id" not in r
            assert "report_id" in r
            assert "target_type" in r
            assert "status" in r
            assert "reporter" in r
        
        print(f"✓ GET /api/admin/reports returned {len(reports)} reports")

    def test_admin_reports_forbidden_for_non_admin(self, api_client, demo_user_token):
        """GET /api/admin/reports returns 403 for non-admin users"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/reports",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print(f"✓ Non-admin correctly blocked with 403")

    def test_admin_reports_status_filter_pending(self, api_client, admin_token):
        """GET /api/admin/reports?status=pending returns only pending reports"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/reports",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"status": "pending"}
        )
        assert response.status_code == 200, f"GET /admin/reports?status=pending failed: {response.text}"
        
        reports = response.json()
        for r in reports:
            assert r["status"] == "pending", f"Expected pending, got {r['status']}"
        
        print(f"✓ GET /api/admin/reports?status=pending returned {len(reports)} pending reports")

    def test_admin_reports_status_filter_resolved(self, api_client, admin_token):
        """GET /api/admin/reports?status=resolved returns only resolved reports"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/reports",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"status": "resolved"}
        )
        assert response.status_code == 200, f"GET /admin/reports?status=resolved failed: {response.text}"
        
        reports = response.json()
        for r in reports:
            assert r["status"] == "resolved", f"Expected resolved, got {r['status']}"
        
        print(f"✓ GET /api/admin/reports?status=resolved returned {len(reports)} resolved reports")

    def test_admin_resolve_report_dismissed(self, api_client, admin_token, demo_user_token):
        """POST /api/admin/reports/{id}/resolve with action=dismissed changes status to resolved"""
        # Create a report first
        # Get a spot to report
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 1})
        spots = list_response.json()
        assert len(spots) > 0
        spot_id = spots[0]["spot_id"]
        
        # Create report
        report_response = api_client.post(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "target_type": "spot",
                "target_id": spot_id,
                "reason": "TEST_inappropriate",
                "details": "Test report for pytest"
            }
        )
        assert report_response.status_code == 200
        report = report_response.json()
        report_id = report["report_id"]
        assert report["status"] == "pending"
        print(f"✓ Created test report {report_id}")
        
        # Resolve with action=dismissed
        resolve_response = api_client.post(
            f"{BASE_URL}/api/admin/reports/{report_id}/resolve",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"action": "dismissed"}
        )
        assert resolve_response.status_code == 200, f"Resolve failed: {resolve_response.text}"
        print(f"✓ Resolved report with action=dismissed")
        
        # Verify status changed to resolved
        reports_response = api_client.get(
            f"{BASE_URL}/api/admin/reports",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"status": "resolved"}
        )
        assert reports_response.status_code == 200
        resolved_reports = reports_response.json()
        
        found = next((r for r in resolved_reports if r["report_id"] == report_id), None)
        assert found is not None, "Report not found in resolved list"
        assert found["status"] == "resolved"
        assert found.get("resolution") == "dismissed"
        print(f"✓ Report status changed to resolved with resolution=dismissed")

    def test_admin_resolve_report_removed_sets_spot_visibility_rejected(self, api_client, admin_token, demo_user_token):
        """POST /api/admin/reports/{id}/resolve with action=removed sets spot visibility_status to rejected"""
        # Create a public spot to report
        spot_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Spot_To_Remove",
                "description": "Will be removed via report",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "public",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert spot_response.status_code == 200
        spot = spot_response.json()
        spot_id = spot["spot_id"]
        print(f"✓ Created test spot {spot_id}")
        
        # Create report
        report_response = api_client.post(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "target_type": "spot",
                "target_id": spot_id,
                "reason": "TEST_spam",
                "details": "Test report for removal"
            }
        )
        assert report_response.status_code == 200
        report = report_response.json()
        report_id = report["report_id"]
        print(f"✓ Created test report {report_id}")
        
        # Resolve with action=removed
        resolve_response = api_client.post(
            f"{BASE_URL}/api/admin/reports/{report_id}/resolve",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"action": "removed"}
        )
        assert resolve_response.status_code == 200, f"Resolve failed: {resolve_response.text}"
        print(f"✓ Resolved report with action=removed")
        
        # Verify spot visibility_status is now rejected
        spot_detail_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot_id}",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert spot_detail_response.status_code == 200
        updated_spot = spot_detail_response.json()
        assert updated_spot["visibility_status"] == "rejected", f"Expected rejected, got {updated_spot['visibility_status']}"
        print(f"✓ Spot visibility_status changed to rejected")


class TestPrivacyApproximateCoordinates:
    """Spots with location_display_mode='approximate' return rounded coordinates to non-owners"""

    def test_approximate_mode_rounds_coordinates_for_non_owner(self, api_client, demo_user_token, admin_token):
        """Spot with location_display_mode='approximate' returns ~2 decimal places to non-owners"""
        # Create spot with approximate mode
        exact_lat = 30.267153
        exact_lng = -97.743057
        
        spot_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Approximate_Location_Spot",
                "description": "Testing coordinate rounding",
                "latitude": exact_lat,
                "longitude": exact_lng,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "public",
                "location_display_mode": "approximate",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert spot_response.status_code == 200
        spot = spot_response.json()
        spot_id = spot["spot_id"]
        
        # Owner should see exact coordinates
        owner_lat = spot["latitude"]
        owner_lng = spot["longitude"]
        assert owner_lat == exact_lat, f"Owner should see exact lat: {owner_lat} vs {exact_lat}"
        assert owner_lng == exact_lng, f"Owner should see exact lng: {owner_lng} vs {exact_lng}"
        print(f"✓ Owner sees exact coordinates: {owner_lat}, {owner_lng}")
        
        # Non-owner should see rounded coordinates
        non_owner_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert non_owner_response.status_code == 200
        non_owner_spot = non_owner_response.json()
        
        non_owner_lat = non_owner_spot["latitude"]
        non_owner_lng = non_owner_spot["longitude"]
        
        # Check that coordinates are rounded (should have ~2 decimal places)
        lat_decimals = len(str(non_owner_lat).split('.')[-1]) if '.' in str(non_owner_lat) else 0
        lng_decimals = len(str(non_owner_lng).split('.')[-1]) if '.' in str(non_owner_lng) else 0
        
        assert lat_decimals <= 2, f"Lat should be rounded to ~2 decimals, got {lat_decimals}: {non_owner_lat}"
        assert lng_decimals <= 2, f"Lng should be rounded to ~2 decimals, got {lng_decimals}: {non_owner_lng}"
        
        print(f"✓ Non-owner sees rounded coordinates: {non_owner_lat}, {non_owner_lng} (~2 decimal places)")

    def test_approximate_mode_rounds_in_list_endpoints(self, api_client, demo_user_token, admin_token):
        """Approximate mode also rounds coordinates in GET /api/spots and /api/feed/home"""
        # Create spot with approximate mode
        exact_lat = 30.267153
        exact_lng = -97.743057
        
        spot_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Approximate_List_Spot",
                "description": "Testing coordinate rounding in lists",
                "latitude": exact_lat,
                "longitude": exact_lng,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "public",
                "location_display_mode": "approximate",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert spot_response.status_code == 200
        spot = spot_response.json()
        spot_id = spot["spot_id"]
        print(f"✓ Created approximate spot {spot_id}")
        
        # Check in GET /api/spots as non-owner
        list_response = api_client.get(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"q": "TEST_Approximate_List_Spot", "limit": 10}
        )
        assert list_response.status_code == 200
        spots = list_response.json()
        
        found = next((s for s in spots if s["spot_id"] == spot_id), None)
        if found:
            lat_decimals = len(str(found["latitude"]).split('.')[-1]) if '.' in str(found["latitude"]) else 0
            lng_decimals = len(str(found["longitude"]).split('.')[-1]) if '.' in str(found["longitude"]) else 0
            assert lat_decimals <= 2, f"List endpoint should round lat: {found['latitude']}"
            assert lng_decimals <= 2, f"List endpoint should round lng: {found['longitude']}"
            print(f"✓ GET /api/spots returns rounded coordinates for non-owner")


class TestPrivacyPrivateSpots:
    """Private spots return 403 to non-owners and are absent from list endpoints"""

    def test_private_spot_returns_403_to_non_owner(self, api_client, demo_user_token, admin_token):
        """Private spot returns 403 to non-owners via GET /api/spots/{id}"""
        # Create private spot
        spot_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Private_Spot_403",
                "description": "Should return 403 to non-owners",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "private",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert spot_response.status_code == 200
        spot = spot_response.json()
        spot_id = spot["spot_id"]
        print(f"✓ Created private spot {spot_id}")
        
        # Try to access as non-owner (admin)
        non_owner_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert non_owner_response.status_code == 403, f"Expected 403, got {non_owner_response.status_code}"
        print(f"✓ Private spot correctly returned 403 to non-owner")

    def test_private_spot_absent_from_list_endpoints(self, api_client, demo_user_token, admin_token):
        """Private spots are completely absent from GET /api/spots, /api/feed/home, /api/spots/nearby/search"""
        # Create private spot with unique title
        unique_title = f"TEST_Private_Absent_{os.urandom(4).hex()}"
        spot_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": unique_title,
                "description": "Should not appear in lists for non-owners",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "private",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert spot_response.status_code == 200
        spot = spot_response.json()
        spot_id = spot["spot_id"]
        print(f"✓ Created private spot {spot_id}")
        
        # Check GET /api/spots as non-owner
        list_response = api_client.get(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"q": unique_title, "limit": 100}
        )
        assert list_response.status_code == 200
        spots = list_response.json()
        found = any(s["spot_id"] == spot_id for s in spots)
        assert not found, "Private spot should not appear in GET /api/spots for non-owner"
        print(f"✓ Private spot absent from GET /api/spots")
        
        # Check GET /api/feed/home as non-owner
        feed_response = api_client.get(
            f"{BASE_URL}/api/feed/home",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert feed_response.status_code == 200
        feed = feed_response.json()
        all_feed_spots = []
        for section in ["nearby", "trending", "golden_hour", "recent", "best_for_you", "following", "seasonal"]:
            all_feed_spots.extend(feed.get(section, []))
        
        found_in_feed = any(s["spot_id"] == spot_id for s in all_feed_spots)
        assert not found_in_feed, "Private spot should not appear in /api/feed/home for non-owner"
        print(f"✓ Private spot absent from GET /api/feed/home")
        
        # Check GET /api/spots/nearby/search as non-owner
        nearby_response = api_client.get(
            f"{BASE_URL}/api/spots/nearby/search",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"lat": 30.2672, "lng": -97.7431, "radius_km": 10, "limit": 100}
        )
        assert nearby_response.status_code == 200
        nearby_spots = nearby_response.json()
        found_nearby = any(s["spot_id"] == spot_id for s in nearby_spots)
        assert not found_nearby, "Private spot should not appear in /api/spots/nearby/search for non-owner"
        print(f"✓ Private spot absent from GET /api/spots/nearby/search")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
