from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config_path = tmp_path / "config.json"
    monkeypatch.setattr("quota_tracker.paths.DEFAULT_CONFIG_PATH", config_path)
    monkeypatch.setattr("quota_tracker.config.DEFAULT_CONFIG_PATH", config_path)
