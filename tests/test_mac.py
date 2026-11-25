import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("mac_launcher", Path(__file__).parents[1] / "scripts/mac.py")
mac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mac)


def test_mac_url_uses_configured_loopback(monkeypatch):
    monkeypatch.setenv("APP_BIND", "127.0.0.1")
    monkeypatch.setenv("APP_PORT", "8765")
    monkeypatch.setenv("APP_TLS_CERT", "")
    monkeypatch.setenv("APP_TLS_KEY", "")
    assert mac.local_url() == "http://127.0.0.1:8765"


def test_mac_does_not_start_another_server_when_ready(monkeypatch):
    monkeypatch.setattr(mac, "ready", lambda _: True)
    def unexpected(*args, **kwargs):
        raise AssertionError("A healthy running service must not be restarted")
    monkeypatch.setattr(mac.subprocess, "run", unexpected)
    mac.ensure_running("http://127.0.0.1:8765")


def test_mac_rejects_missing_loopback(monkeypatch):
    monkeypatch.setenv("APP_BIND", "192.168.1.50")
    monkeypatch.setenv("APP_TLS_CERT", "cert.pem")
    monkeypatch.setenv("APP_TLS_KEY", "key.pem")
    with pytest.raises(ValueError, match="127.0.0.1"):
        mac.local_url()


def test_check_does_not_open_browser_or_change_clipboard(monkeypatch, capsys):
    monkeypatch.setattr(mac, "local_url", lambda: "http://127.0.0.1:8765")
    monkeypatch.setattr(mac, "ready", lambda _: True)
    monkeypatch.setattr(mac.sys, "argv", ["mac.py", "--check"])
    def response(base, path, authenticated=False):
        assert authenticated
        return {"workouts": 0, "auto_coach": False} if path == "/api/status" else []
    monkeypatch.setattr(mac, "get_json", response)
    def unexpected(*args, **kwargs):
        raise AssertionError("--check must not launch programs or start the server")
    monkeypatch.setattr(mac.subprocess, "run", unexpected)
    assert mac.main() == 0
    output = capsys.readouterr().out
    assert "Mac dashboard ready" in output
    assert mac.token() not in output
