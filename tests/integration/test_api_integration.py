"""Integration tests for API endpoints and static serving behavior."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quota_tracker.api import create_app
from quota_tracker.db import (
    QuotaRecord,
    SessionRecord,
    TokenUsageRecord,
    apply_migrations,
    connect_db,
    ensure_default_providers,
    insert_quota,
    insert_token_usage,
    upsert_session,
    write_transaction,
)


def _seed(db_path: Path) -> None:
    conn = connect_db(str(db_path))
    try:
        apply_migrations(conn)
        ensure_default_providers(conn)
        with write_transaction(conn):
            sid = upsert_session(
                conn,
                SessionRecord(
                    provider_id="codex",
                    external_session_id="s-1",
                    model_name="gpt-5",
                    project_path="/tmp/p",
                    project_name="p",
                    created_at="2026-01-01T00:00:00+00:00",
                    last_seen_at="2026-01-01T00:01:00+00:00",
                    metadata={"cli_version": "1.0.0"},
                ),
            )
            insert_token_usage(
                conn,
                TokenUsageRecord(
                    provider_id="codex",
                    session_id=sid,
                    external_event_id="e-1",
                    timestamp="2026-01-01T00:01:00+00:00",
                    model_name="gpt-5",
                    source="local_log",
                    input_tokens=1,
                    output_tokens=2,
                    cached_tokens=3,
                    reasoning_tokens=4,
                    thoughts_tokens=5,
                    tool_tokens=6,
                    total_tokens=21,
                    raw_data={"x": 1},
                ),
            )
            insert_quota(
                conn,
                QuotaRecord(
                    provider_id="codex",
                    quota_name="primary",
                    source="local_log",
                    timestamp="2026-01-01T00:01:00+00:00",
                    used_percent=25.0,
                    remaining_percent=75.0,
                    window_minutes=60,
                    resets_at="2026-01-01T01:00:00+00:00",
                    raw_data={"a": 1},
                ),
            )
    finally:
        conn.close()


def test_api_endpoints_and_static_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "api.sqlite3"
    config_path = tmp_path / "config.json"
    _seed(db_path)
    app = create_app(db_path=db_path, config_path=config_path)
    client = TestClient(app)

    assert client.get("/api/providers").status_code == 200
    assert (
        client.patch(
            "/api/providers/codex",
            json={
                "enabled": False,
                "home_path": str(tmp_path / "codex-home"),
                "active_probe_enabled": True,
                "passive_sync_enabled": False,
            },
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/quotas",
            params={
                "provider_id": "codex",
                "quota_name": "primary",
                "start": "2026-01-01T00:00:00+00:00",
                "end": "2026-01-01T00:02:00+00:00",
                "limit": 5,
            },
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/sessions",
            params={
                "provider_id": "codex",
                "project_name": "p",
                "model_name": "gpt-5",
                "start": "2026-01-01T00:00:00+00:00",
                "end": "2026-01-01T00:02:00+00:00",
            },
        ).status_code
        == 200
    )

    grouped = client.get("/api/token-usage", params={"group_by": "provider"})
    assert grouped.status_code == 200
    assert grouped.json()["items"][0]["total_tokens"] == 21
    filtered = client.get(
        "/api/token-usage",
        params={"group_by": "hour", "provider_id": "codex"},
    )
    assert filtered.status_code == 200
    assert len(filtered.json()["items"]) >= 1
    assert client.get("/api/token-usage", params={"group_by": "model"}).status_code == 200
    assert client.get("/api/token-usage", params={"group_by": "session"}).status_code == 200
    assert client.get("/api/token-usage", params={"group_by": "day"}).status_code == 200
    assert client.get("/api/token-usage", params={"group_by": "hour"}).status_code == 200

    assert client.get("/api/token-usage", params={"group_by": "bad"}).status_code == 400

    filtered_full = client.get(
        "/api/token-usage",
        params={
            "group_by": "hour",
            "provider_id": "codex",
            "model_name": "gpt-5",
            "start": "2026-01-01T00:00:00+00:00",
            "end": "2026-01-01T00:02:00+00:00",
        },
    )
    assert filtered_full.status_code == 200
    assert filtered_full.json()["items"][0]["total_tokens"] == 21
    assert client.get("/api/config").status_code == 200
    assert client.patch("/api/config", json={"web_port": 9000}).status_code == 200
    assert client.patch("/api/config", json={"web_port": 99999}).status_code == 400
    assert client.patch("/api/config", json={"active_probe_interval_minutes": 0}).status_code == 400
    assert client.patch("/api/config", json={"passive_sync_interval_minutes": 0}).status_code == 400
    assert client.patch("/api/config", json={"sync_interval_minutes": 0}).status_code == 400
    assert client.patch("/api/config", json={"sync_interval_minutes": 10}).status_code == 200
    assert (
        client.patch(
            "/api/config",
            json={
                "active_probe_interval_minutes": 10,
                "passive_sync_interval_minutes": 5,
                "web_host": "0.0.0.0",
                "database_path": str(tmp_path / "db2.sqlite3"),
                "log_level": "DEBUG",
            },
        ).status_code
        == 200
    )

    assert client.get("/api/quotas", params={"order": "asc"}).status_code == 200
    assert client.get("/api/quotas", params={"order": "bad"}).status_code == 400
    assert client.get("/api/token-usage/by-project").status_code == 200
    assert (
        client.get(
            "/api/token-usage/by-project",
            params={
                "provider_id": "codex",
                "start": "2026-01-01T00:00:00+00:00",
                "end": "2026-01-01T02:00:00+00:00",
            },
        ).status_code
        == 200
    )
    by_project = client.get("/api/token-usage/by-project").json()
    assert "items" in by_project
    assert "total" in by_project
    assert len(by_project["items"]) >= 1
    assert by_project["items"][0]["project_path"] == "/tmp/p"
    assert "db2.sqlite3" in config_path.read_text()
    assert client.patch("/api/providers/unknown", json={"enabled": True}).status_code == 404
    assert client.get("/api/nope").status_code == 404

    frontend_dist = tmp_path / "frontend" / "dist"
    frontend_dist.mkdir(parents=True, exist_ok=True)
    (frontend_dist / "index.html").write_text("<html>ok</html>")
    assets_dir = frontend_dist / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (assets_dir / "x.js").write_text("console.log('x');")

    monkeypatch.setenv("QUOTA_TRACKER_FRONTEND", str(frontend_dist))
    app2 = create_app(db_path=db_path, config_path=config_path)
    client2 = TestClient(app2)
    assert client2.get("/").status_code == 200
    assert "ok" in client2.get("/foo/bar").text
    (frontend_dist / "robots.txt").write_text("ua")
    assert client2.get("/robots.txt").status_code == 200
    assert client2.get("/assets/x.js").status_code == 200
    assert client2.get("/api/health").status_code == 200

    bundle_dist = tmp_path / "bundle" / "frontend" / "dist"
    bundle_dist.mkdir(parents=True)
    (bundle_dist / "index.html").write_text("<html>bundled</html>")
    (bundle_dist / "assets").mkdir()
    monkeypatch.delenv("QUOTA_TRACKER_FRONTEND")
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)
    bundled_client = TestClient(create_app(db_path=db_path, config_path=config_path))
    assert "bundled" in bundled_client.get("/").text


def test_codex_cached_tokens_are_not_double_counted(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    conn = connect_db(str(db_path))
    try:
        apply_migrations(conn)
        ensure_default_providers(conn)
        with write_transaction(conn):
            sid = upsert_session(
                conn,
                SessionRecord(
                    provider_id="codex",
                    external_session_id="s-cached",
                    model_name="gpt-5",
                    project_path="/tmp/p",
                    project_name="p",
                    created_at="2026-01-01T00:00:00+00:00",
                    last_seen_at="2026-01-01T00:01:00+00:00",
                    metadata={},
                ),
            )
            insert_token_usage(
                conn,
                TokenUsageRecord(
                    provider_id="codex",
                    session_id=sid,
                    external_event_id="e-cached",
                    timestamp="2026-01-01T00:01:00+00:00",
                    model_name="gpt-5",
                    source="local_log",
                    input_tokens=10,
                    output_tokens=5,
                    cached_tokens=8,
                    reasoning_tokens=0,
                    thoughts_tokens=0,
                    tool_tokens=0,
                    total_tokens=15,
                    raw_data={},
                ),
            )
    finally:
        conn.close()

    client = TestClient(create_app(db_path=db_path, config_path=tmp_path / "config.json"))
    response = client.get(
        "/api/token-usage",
        params={"group_by": "provider", "provider_id": "codex"},
    )
    assert response.status_code == 200
    row = response.json()["items"][0]
    assert row["input_tokens"] == 2
    assert row["cached_tokens"] == 8
    assert row["input_cost"] == pytest.approx(0.000005)
    assert row["cached_cost"] == pytest.approx(0.000002)
    assert row["output_cost"] == pytest.approx(0.000075)
    assert row["estimated_cost"] == pytest.approx(0.000082)


def test_provider_patch_not_found_from_missing_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    monkeypatch.setattr("quota_tracker.api.routes.list_provider_rows", lambda conn: [])
    client = TestClient(app)
    response = client.patch("/api/providers/codex", json={"enabled": True})
    assert response.status_code == 404


def test_create_provider(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)
    
    payload = {
        "base_provider": "gemini",
        "account_name": "testing",
        "display_name": "Testing Alias",
        "home_path": "~/.gemini-testing",
    }
    response = client.post("/api/providers", json=payload)
    assert response.status_code == 200
    assert response.json()["provider_id"] == "gemini:testing"
    
    # Verify it exists now
    health = client.get("/api/providers").json()
    assert any(p["id"] == "gemini:testing" for p in health["providers"])


def test_create_provider_validation_errors_and_conflicts(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)

    base_payload = {
        "base_provider": "gemini",
        "account_name": "testing",
        "display_name": "Testing Alias",
        "home_path": str(tmp_path / "gemini-testing"),
    }

    response = client.post(
        "/api/providers",
        json={**base_payload, "base_provider": "unknown"},
    )
    assert response.status_code == 400

    response = client.post(
        "/api/providers",
        json={**base_payload, "account_name": "default"},
    )
    assert response.status_code == 400

    response = client.post("/api/providers", json=base_payload)
    assert response.status_code == 200

    response = client.post(
        "/api/providers",
        json={
            **base_payload,
            "display_name": "Another",
            "home_path": str(tmp_path / "gemini-testing-dup"),
        },
    )
    assert response.status_code == 409

    response = client.post(
        "/api/providers",
        json={
            **base_payload,
            "account_name": "second",
            "home_path": str(tmp_path / "gemini-second"),
        },
    )
    assert response.status_code == 409


def test_patch_provider_duplicate_display_name(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)

    payload_a = {
        "base_provider": "gemini",
        "account_name": "alpha",
        "display_name": "Alpha",
        "home_path": str(tmp_path / "gemini-alpha"),
    }
    payload_b = {
        "base_provider": "gemini",
        "account_name": "beta",
        "display_name": "Beta",
        "home_path": str(tmp_path / "gemini-beta"),
    }
    assert client.post("/api/providers", json=payload_a).status_code == 200
    assert client.post("/api/providers", json=payload_b).status_code == 200

    response = client.patch("/api/providers/gemini:beta", json={"display_name": "Alpha"})
    assert response.status_code == 409


def test_delete_provider(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)

    payload = {
        "base_provider": "gemini",
        "account_name": "testing2",
        "display_name": "Testing Delete",
        "home_path": "~/.gemini-testing-2",
    }
    client.post("/api/providers", json=payload)
    health = client.get("/api/providers").json()
    assert any(p["id"] == "gemini:testing2" for p in health["providers"])

    # Try deleting primary provider (should fail)
    response = client.delete("/api/providers/gemini")
    assert response.status_code == 400

    # Delete the secondary provider
    response = client.delete("/api/providers/gemini:testing2")
    assert response.status_code == 200

    health = client.get("/api/providers").json()
    assert not any(p["id"] == "gemini:testing2" for p in health["providers"])


def test_quota_downsampling(tmp_path: Path) -> None:
    db_path = tmp_path / "downsample.sqlite3"
    conn = connect_db(str(db_path))
    try:
        apply_migrations(conn)
        ensure_default_providers(conn)
        # Seed 100 points over 100 minutes.
        with write_transaction(conn):
            for i in range(100):
                ts = f"2026-01-01T00:{i:02d}:00+00:00"
                insert_quota(
                    conn,
                    QuotaRecord(
                        provider_id="codex",
                        quota_name="primary",
                        source="test",
                        timestamp=ts,
                        used_percent=float(i),
                        remaining_percent=float(100 - i),
                        window_minutes=60,
                        resets_at=None,
                        raw_data={},
                    ),
                )
    finally:
        conn.close()

    app = create_app(db_path=db_path)
    client = TestClient(app)

    # Request downsampling to 10 points.
    resp = client.get(
        "/api/quotas",
        params={
            "provider_id": "codex",
            "quota_name": "primary",
            "downsample": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["downsampled"] is True
    assert len(data["items"]) <= 15  # Sufficiently small number of buckets


def test_api_bootstraps_default_providers_on_fresh_db(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    app = create_app(db_path=db_path)
    client = TestClient(app)

    response = client.get("/api/providers")
    assert response.status_code == 200
    provider_ids = {provider["id"] for provider in response.json()["providers"]}
    assert {"gemini", "codex", "copilot", "claude"}.issubset(provider_ids)
    assert client.post("/api/providers/gemini/scan", json={}).status_code == 200


def test_manual_action_all_provider_id_supported(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    app = create_app(db_path=db_path)
    client = TestClient(app)

    assert client.post("/api/providers/all/scan", json={}).status_code == 200
    assert client.post("/api/providers/all/probe").status_code == 200
    assert client.post("/api/providers/all/rescan", json={"full_rescan": True}).status_code == 200


def test_manual_action_nonexistent_provider_returns_404(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)

    # These are expected to FAIL currently (they return 200 with summary showing 0 ops)
    assert client.post("/api/providers/gemini:missing/scan", json={}).status_code == 404
    assert client.post("/api/providers/gemini:missing/probe").status_code == 404
    assert client.post("/api/providers/gemini:missing/rescan", json={"full_rescan": True}).status_code == 404


def test_manual_action_disabled_provider_returns_409(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite3"
    _seed(db_path)
    app = create_app(db_path=db_path)
    client = TestClient(app)

    response = client.patch(
        "/api/providers/codex",
        json={"enabled": False},
    )
    assert response.status_code == 200

    assert client.post("/api/providers/codex/probe").status_code == 409
