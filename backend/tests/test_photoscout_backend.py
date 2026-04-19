"""
PhotoScout Backend API Tests
Tests: health, auth, spots, feed, collections, reviews, follows, admin, privacy
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
        "email": "admin@photoscout.app",
        "password": "admin123"
    })
    if response.status_code != 200:
        pytest.skip(f"Admin login failed: {response.status_code}")
    return response.json()["token"]


@pytest.fixture
def demo_user_token(api_client):
    """Get demo user JWT token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "sophie@photoscout.app",
        "password": "demo123"
    })
    if response.status_code != 200:
        pytest.skip(f"Demo user login failed: {response.status_code}")
    return response.json()["token"]


class TestHealth:
    """Health check endpoint"""

    def test_health_check(self, api_client):
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["app"] == "PhotoScout"
        assert data["status"] == "ok"
        print("✓ Health check passed")


class TestAuth:
    """Authentication endpoints"""

    def test_register_returns_token_and_user(self, api_client):
        """POST /api/auth/register returns token + user (no _id, no password_hash)"""
        email = f"TEST_newuser_{os.urandom(4).hex()}@test.com"
        response = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email,
            "password": "testpass123",
            "name": "Test User",
            "specialties": ["Portrait"]
        })
        assert response.status_code == 200, f"Register failed: {response.text}"
        
        data = response.json()
        assert "token" in data, "Missing token in response"
        assert "user" in data, "Missing user in response"
        
        user = data["user"]
        assert "_id" not in user, "Response contains _id (should be excluded)"
        assert "password_hash" not in user, "Response contains password_hash (should be excluded)"
        assert user["email"] == email.lower(), "Email should be lowercased by backend"
        assert user["name"] == "Test User"
        assert "Portrait" in user.get("specialties", [])
        print(f"✓ Register successful for {email}")

    def test_login_admin_returns_token_and_role(self, api_client):
        """POST /api/auth/login with admin credentials returns token + user with role admin"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@photoscout.app",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        
        data = response.json()
        assert "token" in data
        assert "user" in data
        
        user = data["user"]
        assert "_id" not in user
        assert "password_hash" not in user
        assert user["role"] == "admin", f"Expected admin role, got {user.get('role')}"
        print("✓ Admin login successful with correct role")

    def test_get_auth_me_with_bearer_token(self, api_client, admin_token):
        """GET /api/auth/me with Bearer token returns current user"""
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"GET /auth/me failed: {response.text}"
        
        user = response.json()
        assert user["email"] == "admin@photoscout.app"
        assert user["role"] == "admin"
        assert "_id" not in user
        assert "password_hash" not in user
        print("✓ GET /auth/me successful")

    def test_google_session_invalid_returns_401_or_500(self, api_client):
        """POST /api/auth/google/session with invalid session_id returns 401/500"""
        response = api_client.post(f"{BASE_URL}/api/auth/google/session", json={
            "session_id": "invalid_session_12345"
        })
        assert response.status_code in [401, 500], f"Expected 401/500, got {response.status_code}"
        print(f"✓ Google session with invalid ID returned {response.status_code}")


class TestFeed:
    """Feed endpoints"""

    def test_feed_home_returns_sections(self, api_client):
        """GET /api/feed/home returns sections with seeded Texas spots"""
        response = api_client.get(f"{BASE_URL}/api/feed/home")
        assert response.status_code == 200, f"Feed home failed: {response.text}"
        
        data = response.json()
        assert "nearby" in data
        assert "trending" in data
        assert "golden_hour" in data
        assert "recent" in data
        assert "seasonal" in data
        
        # Check that we have seeded spots
        assert len(data["nearby"]) > 0, "No nearby spots found"
        assert len(data["trending"]) > 0, "No trending spots found"
        
        # Verify no _id in spot responses
        for spot in data["nearby"]:
            assert "_id" not in spot, "Spot contains _id"
            assert "shoot_score" in spot, "Missing shoot_score"
        
        print(f"✓ Feed home returned {len(data['nearby'])} nearby, {len(data['trending'])} trending spots")


class TestSpots:
    """Spot endpoints"""

    def test_get_spots_with_filters(self, api_client):
        """GET /api/spots with filters returns filtered list and no _id fields"""
        # Test with shoot_type filter
        response = api_client.get(f"{BASE_URL}/api/spots", params={
            "shoot_type": "Wedding",
            "limit": 10
        })
        assert response.status_code == 200, f"GET /spots failed: {response.text}"
        
        spots = response.json()
        assert isinstance(spots, list)
        
        for spot in spots:
            assert "_id" not in spot, "Spot contains _id"
            assert "shoot_score" in spot
            assert "Wedding" in spot.get("shoot_types", [])
        
        print(f"✓ GET /spots with shoot_type=Wedding returned {len(spots)} spots")
        
        # Test with dog_friendly filter
        response = api_client.get(f"{BASE_URL}/api/spots", params={
            "dog_friendly": True,
            "limit": 10
        })
        assert response.status_code == 200
        spots = response.json()
        for spot in spots:
            assert spot.get("dog_friendly") is True
        print(f"✓ GET /spots with dog_friendly=True returned {len(spots)} spots")
        
        # Test with min_rating filter
        response = api_client.get(f"{BASE_URL}/api/spots", params={
            "min_rating": 70,
            "limit": 10
        })
        assert response.status_code == 200
        spots = response.json()
        for spot in spots:
            assert spot["shoot_score"] >= 70
        print(f"✓ GET /spots with min_rating=70 returned {len(spots)} spots")

    def test_get_spot_detail(self, api_client):
        """GET /api/spots/{spot_id} returns full detail including owner, reviews, similar_spots, shoot_score"""
        # First get a spot ID from the list
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 1})
        assert list_response.status_code == 200
        spots = list_response.json()
        assert len(spots) > 0, "No spots found to test detail"
        
        spot_id = spots[0]["spot_id"]
        
        # Get detail
        response = api_client.get(f"{BASE_URL}/api/spots/{spot_id}")
        assert response.status_code == 200, f"GET /spots/{spot_id} failed: {response.text}"
        
        spot = response.json()
        assert "_id" not in spot
        assert "shoot_score" in spot
        assert "owner" in spot, "Missing owner field"
        assert "reviews" in spot, "Missing reviews field"
        assert "similar_spots" in spot, "Missing similar_spots field"
        assert "is_saved" in spot
        
        # Verify owner has no _id or password_hash
        owner = spot["owner"]
        assert "_id" not in owner
        assert "password_hash" not in owner
        
        print(f"✓ GET /spots/{spot_id} returned full detail with owner, reviews, similar_spots")

    def test_create_private_spot_authenticated(self, api_client, demo_user_token):
        """POST /api/spots creates a new private spot when authenticated (approved status)"""
        response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Private Test Spot",
                "description": "Test spot for pytest",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "private",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert response.status_code == 200, f"Create spot failed: {response.text}"
        
        spot = response.json()
        assert spot["title"] == "TEST_Private Test Spot"
        assert spot["privacy_mode"] == "private"
        assert spot["visibility_status"] == "approved", "Private spot should be auto-approved"
        assert "_id" not in spot
        
        print(f"✓ Created private spot {spot['spot_id']} with approved status")
        
        # Verify persistence with GET
        get_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot['spot_id']}",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert get_response.status_code == 200
        retrieved = get_response.json()
        assert retrieved["title"] == "TEST_Private Test Spot"
        print(f"✓ Verified spot persisted in database")

    def test_toggle_save_spot(self, api_client, demo_user_token):
        """POST /api/spots/{id}/save toggles save, GET /api/me/saved lists saved"""
        # Get a spot to save
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 1})
        spots = list_response.json()
        assert len(spots) > 0
        spot_id = spots[0]["spot_id"]
        
        # Save the spot
        save_response = api_client.post(
            f"{BASE_URL}/api/spots/{spot_id}/save",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert save_response.status_code == 200
        save_data = save_response.json()
        assert "saved" in save_data
        is_saved = save_data["saved"]
        print(f"✓ Toggled save for spot {spot_id}: saved={is_saved}")
        
        # Get saved list
        saved_response = api_client.get(
            f"{BASE_URL}/api/me/saved",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert saved_response.status_code == 200
        saved_spots = saved_response.json()
        
        if is_saved:
            assert any(s["spot_id"] == spot_id for s in saved_spots), "Saved spot not in list"
            print(f"✓ GET /api/me/saved returned {len(saved_spots)} saved spots including {spot_id}")
        else:
            print(f"✓ GET /api/me/saved returned {len(saved_spots)} saved spots")


class TestCollections:
    """Collection endpoints"""

    def test_create_collection_and_list(self, api_client, demo_user_token):
        """POST /api/collections creates collection, GET /api/me/collections lists them with previews"""
        # Create collection
        create_response = api_client.post(
            f"{BASE_URL}/api/collections",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "name": "TEST_My Test Collection",
                "description": "Test collection for pytest",
                "privacy_mode": "private"
            }
        )
        assert create_response.status_code == 200, f"Create collection failed: {create_response.text}"
        
        collection = create_response.json()
        assert collection["name"] == "TEST_My Test Collection"
        assert "_id" not in collection
        collection_id = collection["collection_id"]
        print(f"✓ Created collection {collection_id}")
        
        # List collections
        list_response = api_client.get(
            f"{BASE_URL}/api/me/collections",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert list_response.status_code == 200
        collections = list_response.json()
        assert any(c["collection_id"] == collection_id for c in collections)
        
        # Verify previews field exists
        for col in collections:
            assert "previews" in col
            assert "count" in col
        
        print(f"✓ GET /api/me/collections returned {len(collections)} collections with previews")


class TestReviewsAndCheckins:
    """Review and check-in endpoints"""

    def test_create_review_with_auth(self, api_client, demo_user_token):
        """POST /api/spots/{id}/reviews works with auth"""
        # Get a spot
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 1})
        spots = list_response.json()
        assert len(spots) > 0
        spot_id = spots[0]["spot_id"]
        
        # Create review
        review_response = api_client.post(
            f"{BASE_URL}/api/spots/{spot_id}/reviews",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "overall_rating": 5,
                "light_rating": 5,
                "comment": "TEST_Great spot for testing!"
            }
        )
        assert review_response.status_code == 200, f"Create review failed: {review_response.text}"
        
        review = review_response.json()
        assert review["overall_rating"] == 5
        assert "_id" not in review
        print(f"✓ Created review for spot {spot_id}")

    def test_create_checkin_with_auth(self, api_client, demo_user_token):
        """POST /api/spots/{id}/checkins works with auth"""
        # Get a spot
        list_response = api_client.get(f"{BASE_URL}/api/spots", params={"limit": 1})
        spots = list_response.json()
        assert len(spots) > 0
        spot_id = spots[0]["spot_id"]
        
        # Create check-in
        checkin_response = api_client.post(
            f"{BASE_URL}/api/spots/{spot_id}/checkins",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "status_summary": "TEST_Just checked in for testing",
                "crowd_level": 2,
                "notes": "Perfect lighting today"
            }
        )
        assert checkin_response.status_code == 200, f"Create check-in failed: {checkin_response.text}"
        
        checkin = checkin_response.json()
        assert checkin["status_summary"] == "TEST_Just checked in for testing"
        assert "_id" not in checkin
        print(f"✓ Created check-in for spot {spot_id}")


class TestFollows:
    """Follow endpoints"""

    def test_follow_user_toggle(self, api_client, demo_user_token):
        """POST /api/users/{id}/follow toggles follow"""
        # Get another user to follow (admin)
        login_response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@photoscout.app",
            "password": "admin123"
        })
        admin_user = login_response.json()["user"]
        admin_user_id = admin_user["user_id"]
        
        # Follow
        follow_response = api_client.post(
            f"{BASE_URL}/api/users/{admin_user_id}/follow",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert follow_response.status_code == 200, f"Follow failed: {follow_response.text}"
        
        follow_data = follow_response.json()
        assert "following" in follow_data
        print(f"✓ Toggled follow for user {admin_user_id}: following={follow_data['following']}")


class TestAdmin:
    """Admin endpoints"""

    def test_admin_pending_returns_only_pending_public_spots(self, api_client, admin_token):
        """GET /api/admin/pending returns only pending public spots (needs admin role)"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/pending",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Admin pending failed: {response.text}"
        
        pending = response.json()
        assert isinstance(pending, list)
        
        # All should be pending_review
        for spot in pending:
            assert spot["visibility_status"] == "pending_review"
            assert "_id" not in spot
        
        print(f"✓ GET /api/admin/pending returned {len(pending)} pending spots")

    def test_admin_pending_forbidden_for_non_admin(self, api_client, demo_user_token):
        """GET /api/admin/pending returns 403 for non-admin"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/pending",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ Admin endpoint correctly returns 403 for non-admin user")


class TestCreatorDashboard:
    """Creator dashboard endpoint"""

    def test_get_creator_dashboard(self, api_client, demo_user_token):
        """GET /api/me/dashboard returns creator stats"""
        response = api_client.get(
            f"{BASE_URL}/api/me/dashboard",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        
        dashboard = response.json()
        assert "total_spots" in dashboard
        assert "public_spots" in dashboard
        assert "private_spots" in dashboard
        assert "saves_received" in dashboard
        assert "reviews_received" in dashboard
        assert "followers" in dashboard
        assert "top_spots" in dashboard
        
        print(f"✓ Dashboard returned: {dashboard['total_spots']} total spots, {dashboard['followers']} followers")


class TestPrivacy:
    """Privacy enforcement"""

    def test_private_spot_returns_403_for_non_owner(self, api_client, demo_user_token, admin_token):
        """Private spot returns 403 for non-owners via GET /api/spots/{id}"""
        # Create a private spot as demo user
        create_response = api_client.post(
            f"{BASE_URL}/api/spots",
            headers={"Authorization": f"Bearer {demo_user_token}"},
            json={
                "title": "TEST_Private Spot for Privacy Test",
                "description": "Should be private",
                "latitude": 30.2672,
                "longitude": -97.7431,
                "city": "Austin",
                "state": "TX",
                "privacy_mode": "private",
                "shoot_types": ["Portrait"],
                "images": []
            }
        )
        assert create_response.status_code == 200
        spot = create_response.json()
        spot_id = spot["spot_id"]
        print(f"✓ Created private spot {spot_id}")
        
        # Try to access as admin (different user)
        access_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert access_response.status_code == 403, f"Expected 403, got {access_response.status_code}"
        print(f"✓ Private spot correctly returned 403 for non-owner")
        
        # Verify owner can still access
        owner_response = api_client.get(
            f"{BASE_URL}/api/spots/{spot_id}",
            headers={"Authorization": f"Bearer {demo_user_token}"}
        )
        assert owner_response.status_code == 200
        print(f"✓ Owner can still access their private spot")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
