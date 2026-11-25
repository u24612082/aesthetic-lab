"""Coaching configuration, visible health status, and serialized report requests."""
import os
import hmac
import tempfile
import threading
import time
from pathlib import Path

import anthropic
from dotenv import set_key

from .analytics import dashboard
from .claude_analyser import analyse
from .config import ROOT, token
from .db import connect, event

ENV_PATH = ROOT / ".env"
_lock = threading.Lock()
_last_failure_at = None


class CoachError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def friendly_error(exc):
    if isinstance(exc, anthropic.AuthenticationError):
        return CoachError("authentication", "Claude rejected the API key. Reconnect with an active Anthropic API key.")
    if isinstance(exc, anthropic.PermissionDeniedError):
        return CoachError("permission", "The Anthropic account cannot access this model. Check account permissions.")
    if isinstance(exc, anthropic.NotFoundError):
        return CoachError("model", "The configured Claude model is unavailable. Check ANTHROPIC_MODEL in .env.")
    if isinstance(exc, anthropic.RateLimitError):
        return CoachError("rate_limit", "Anthropic has rate-limited the request. Wait before retrying.")
    if isinstance(exc, anthropic.APITimeoutError):
        return CoachError("timeout", "Claude did not respond in time. Try again in a minute.")
    if isinstance(exc, anthropic.APIConnectionError):
        return CoachError("network", "The Mac could not reach Anthropic. Check its internet connection.")
    if isinstance(exc, anthropic.BadRequestError):
        return CoachError("request", "Anthropic could not accept the request. Check API credits, billing and model settings.")
    if isinstance(exc, anthropic.APIStatusError):
        return CoachError("provider", f"Anthropic returned HTTP {exc.status_code}. Try again later.")
    if isinstance(exc, (OSError, PermissionError)):
        return CoachError("storage", "The Mac could not save coaching configuration or results. Check local file access.")
    return CoachError("invalid_report", "The coach could not produce a valid audit. The previous report is preserved; try again later.")


def save_settings(updates):
    """Replace .env atomically and keep secrets private; never return their values."""
    path = Path(ENV_PATH)
    original = path.read_text(encoding='utf-8') if path.exists() else ""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", prefix=".env-coach-", dir=path.parent, delete=False) as f:
            temporary = Path(f.name)
            f.write(original)
        temporary.chmod(0o600)
        for name, value in updates.items():
            set_key(str(temporary), name, value, quote_mode="always")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    os.environ.update(updates)


def connect_claude(api_key):
    global _last_failure_at
    if os.getenv('COACH_PROVIDER')=='subscription':
        raise CoachError('subscription','Subscription mode uses Claude Code and local MCP. API billing is disabled in this workspace.')
    if os.getenv("APP_DEMO", "false").lower() == "true":
        raise CoachError("demo", "Demo mode uses local rules. Connect Claude in your personal workspace on port 8765.")
    key = api_key.strip()
    if not 20 <= len(key) <= 512 or not key.isascii() or any(c.isspace() for c in key):
        raise CoachError("invalid_key", "Enter a valid Anthropic API key. It will stay on this Mac.")
    if hmac.compare_digest(key.encode(),token().encode()):
        raise CoachError("invalid_key", "That is the dashboard pairing token. Use an Anthropic API key from the Claude Console instead.")
    if not _lock.acquire(blocking=False):
        raise CoachError("busy", "An audit or connection check is already running. Wait for it to finish.")
    try:
        model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        # Validate account/model access without sending training/food data or generating text.
        with anthropic.Anthropic(api_key=key, timeout=12, max_retries=0) as client:
            client.models.retrieve(model)
        save_settings({"ANTHROPIC_API_KEY":key,"AUTO_COACH":"true"})
        _last_failure_at = None
        event("coach", "connected", "Claude API key and model access verified. Automatic audits enabled.")
    except CoachError:
        raise
    except Exception as exc:
        raise friendly_error(exc) from None
    finally:
        _lock.release()
    return {"message":"Claude API access verified. Automatic audits are enabled.","model":model}


def disconnect_claude():
    global _last_failure_at
    if os.getenv("APP_DEMO", "false").lower() == "true":
        raise CoachError("demo", "Demo mode cannot change your personal Claude connection.")
    if not _lock.acquire(blocking=False):
        raise CoachError("busy", "Wait for the running audit before disconnecting Claude.")
    try:
        save_settings({"ANTHROPIC_API_KEY":"","AUTO_COACH":"false"})
        _last_failure_at = None
        event("coach", "disconnected", "Claude disconnected. Local rules remain available.")
    except Exception as exc:
        raise friendly_error(exc) from None
    finally:
        _lock.release()
    return {"message":"Claude disconnected. Local rules remain available."}


def run_coach():
    global _last_failure_at
    if not _lock.acquire(blocking=False):
        return {"state":"running","message":"An audit or connection check is already running."}
    try:
        if _last_failure_at is not None and time.monotonic()-_last_failure_at < 60:
            raise CoachError("cooldown", "The last attempt failed. Wait one minute before retrying.")
        try:
            result = analyse()
        except Exception as exc:
            _last_failure_at = time.monotonic()
            error = friendly_error(exc)
            event("coach", "error", str(error))
            raise error from None
        _last_failure_at = None
        with connect() as c:
            previous = c.execute("SELECT status FROM sync_events WHERE transport='coach' ORDER BY id DESC LIMIT 1").fetchone()
        if result["state"] != "cached" or (previous and previous["status"] == "error"):
            event("coach", "ok", result["message"])
        return result
    finally:
        _lock.release()


def coach_status():
    data = dashboard(28)
    configured = bool(os.getenv("ANTHROPIC_API_KEY"))
    enabled = os.getenv("AUTO_COACH", "false").lower() == "true"
    stats = data["stats"]
    has_data = stats["sessions"] > 0 or stats["logged_days"] > 0 or bool(data["bodyweight"]["latest"])
    detailed = stats["sessions"]-stats["summary_only"]
    with connect() as c:
        last_event = c.execute("SELECT status,message,created_at FROM sync_events WHERE transport='coach' ORDER BY id DESC LIMIT 1").fetchone()
    error = dict(last_event) if last_event and last_event["status"] == "error" else None
    state = ("not_configured" if not configured else "disabled" if not enabled else
             "running" if _lock.locked() else "error" if error else "waiting_for_data" if not has_data else "ready")
    messages = {
        "running":"The coach is checking its connection or generating an audit.",
        "not_configured":"Claude is not connected. Add an Anthropic API key below to enable AI audits.",
        "disabled":"A key is present, but automatic AI audits are disabled. Reconnect to enable them.",
        "waiting_for_data":"Claude is configured. Add a food entry or finish a workout before generating an AI audit.",
        "ready":"Claude is configured and data is available. Generate an audit now or wait for the next automatic update.",
        "error":error["message"] if error else "The latest audit failed.",
    }
    subscription=os.getenv('COACH_PROVIDER')=='subscription'
    if subscription:
        state='subscription'
        messages[state]='Your installed Claude Code client reviews saved changes in the background using its subscription sign-in. No Terminal or pasted prompts. Pro usage limits apply; API billing stays disabled.'
        configured=enabled=False
    return {"state":state,"message":messages[state],"api_key_configured":configured,"enabled":enabled,"provider":'subscription' if subscription else 'api',
            "demo":os.getenv("APP_DEMO", "false").lower() == "true",
            "model":os.getenv("ANTHROPIC_MODEL","claude-sonnet-4-6"),"has_data":has_data,
            "data_status":"detailed" if detailed else "summary_only" if stats["sessions"] else "nutrition_only" if stats["logged_days"] else "empty",
            "sessions":stats["sessions"],"detailed_sessions":detailed,"food_days":stats["logged_days"],"weight_recordings":len(data["bodyweight"]["records"]),
            "report_mode":data["coach"]["mode"] if data["coach"] else None,
            "report_generated_at":data["coach"]["created_at"] if data["coach"] else None,"last_error":error}
