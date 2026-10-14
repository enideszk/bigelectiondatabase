"""Paths and settings. Settings come from environment variables, usually via the repo's .env file."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# etl/src/etl/config.py -> repo root. absolute() (not resolve()) keeps mapped drive letters readable.
REPO_ROOT = Path(__file__).absolute().parents[3]
load_dotenv(REPO_ROOT / ".env")

MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
FIXTURES_DIR = REPO_ROOT / "data" / "fixtures"
WEB_PUBLIC_DIR = REPO_ROOT / "web" / "public"
EXPORT_DIR = WEB_PUBLIC_DIR / "data"
TILES_PATH = WEB_PUBLIC_DIR / "tiles" / "units.pmtiles"
TYPES_SCHEMA_PATH = REPO_ROOT / "web" / "src" / "lib" / "types.schema.json"


class ConfigError(RuntimeError):
    pass


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ConfigError("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url


def test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        raise ConfigError("TEST_DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url


def raw_dir() -> Path:
    """Untouched downloads. Never edit files in here."""
    return Path(os.environ.get("RAW_DATA_DIR") or REPO_ROOT / "data" / "raw")


def interim_dir() -> Path:
    """Cleaned intermediate files written by loaders' clean() step."""
    return Path(os.environ.get("INTERIM_DATA_DIR") or REPO_ROOT / "data" / "interim")
