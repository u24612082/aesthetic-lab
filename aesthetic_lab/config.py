import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def db_path() -> Path:
    return Path(os.getenv("APP_DB", str(ROOT / "var/aesthetic.sqlite3"))).expanduser().resolve()


def timezone() -> ZoneInfo:
    return ZoneInfo(os.getenv("APP_TIMEZONE", "Africa/Johannesburg"))


def token() -> str:
    value = os.getenv("APP_TOKEN", "")
    if len(value) < 32:
        raise RuntimeError("APP_TOKEN must contain at least 32 characters. Run scripts/bootstrap.py.")
    return value
