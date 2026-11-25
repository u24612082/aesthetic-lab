"""Fail-closed isolation checks and one-use Mac pairing for the frozen trial only."""
import hashlib
import hmac
import ipaddress
import json
import os
import time
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from .config import ROOT, db_path


def validate_environment():
    workspace = Path(os.environ.get("APP_TRIAL_ROOT", "/nonexistent")).resolve()
    if (ROOT.resolve() != workspace / "app" or db_path() != workspace / "data.sqlite3"
            or os.getenv("APP_BIND") != "127.0.0.1" or os.getenv("APP_PORT") != "8767"
            or os.getenv("APP_DEMO") != "true" or not os.getenv("APP_TRIAL_ID")
            or os.getenv("AUTO_COACH") != "false" or os.getenv("CLAUDE_AUTO_COACH") != "false"
            or os.getenv("APP_INBOX") or os.getenv("APP_PHONE_INTERFACE") or os.getenv("ANTHROPIC_API_KEY")):
        raise RuntimeError("Trial isolation settings are invalid. Refusing to start.")
    return workspace


def install_trial(app):
    workspace = validate_environment()

    @app.middleware("http")
    async def trial_connections(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith(("/api/coach", "/api/phone")):
            return JSONResponse({"detail": "External coaching and phone connections are disabled in this isolated trial."}, status_code=409)
        return await call_next(request)

    @app.get("/trial/open")
    def open_trial(request: Request, ticket: str = ""):
        if not request.client or not ipaddress.ip_address(request.client.host).is_loopback:
            raise HTTPException(403, "Open this trial on your Mac.")
        path = workspace / "open-ticket.json"
        try:
            expected = json.loads(path.read_text())
            valid = expected["expires"] > time.time() and hmac.compare_digest(
                expected["digest"], hashlib.sha256(ticket.encode()).hexdigest())
            if not valid:
                raise ValueError()
            path.unlink()  # A concurrent or replayed request must fail.
        except (OSError, ValueError, KeyError):
            raise HTTPException(401, "Reopen Try IP Method.command for a fresh trial link.") from None
        from .app import cookie_value
        response = RedirectResponse("/#/progression-blocks", status_code=303)
        response.set_cookie("lab_ip_trial_session", cookie_value(), httponly=True, samesite="strict", max_age=30 * 86400)
        response.headers["Cache-Control"] = "no-store"
        return response
