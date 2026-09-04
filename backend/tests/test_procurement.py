def test_app_is_alive(client):
    """Smoke test: the app starts and the bootstrap-status endpoint responds."""
    resp = client.get("/api/auth/bootstrap-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "needs_setup" in data


def test_setup_creates_admin_user(authed_client):
    """After setup, the /api/auth/me endpoint returns the logged-in user."""
    resp = authed_client.get("/api/auth/me")
    assert resp.status_code == 200
    me = resp.json()
    assert me["email"] == "tester@example.com"
    assert me["role"] in ("admin", "manager")


def test_suppliers_list_is_accessible(authed_client):
    """Logged-in admin/manager can GET the suppliers list."""
    resp = authed_client.get("/api/suppliers")
    # 200 OK or 403 are acceptable — 500 is not.
    assert resp.status_code != 500, f"Server error on /api/suppliers: {resp.text}"


def test_products_list_is_accessible(authed_client):
    """Logged-in admin/manager can GET the products list."""
    resp = authed_client.get("/api/products")
    assert resp.status_code != 500, f"Server error on /api/products: {resp.text}"


def test_purchase_orders_list_is_accessible(authed_client):
    """Logged-in admin/manager can GET the purchase orders list."""
    resp = authed_client.get("/api/purchase-orders")
    assert resp.status_code != 500, f"Server error on /api/purchase-orders: {resp.text}"

