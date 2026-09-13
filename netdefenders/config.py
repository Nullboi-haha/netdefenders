"""Configuration management for NetDefenders.

Loads settings from environment variables and a ``.env`` file.  Secrets are
kept out of logs and the public :class:`Config` object never exposes raw API
keys beyond the initial load — :attr:`has_openai` is the safe boolean to
check.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from core.logging_config import configure_logging, get_logger

_log = get_logger("config")


@dataclass
class Config:
    """Application-wide configuration values."""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    log_level: str = "INFO"
    log_file: str = ""
    max_agent_retries: int = 2
    base_dir: Path = Path(".")
    data_dir: Path = Path("data")
    samples_dir: Path = Path("data/samples")

    @property
    def has_openai(self) -> bool:
        """True only when a non-empty OpenAI key was loaded."""
        return bool(self.openai_api_key and self.openai_api_key.strip())

    def safe_summary(self) -> dict[str, object]:
        """Return a dict safe for logging (no secrets)."""
        return {
            "has_openai": self.has_openai,
            "openai_model": self.openai_model,
            "log_level": self.log_level,
            "max_agent_retries": self.max_agent_retries,
        }


def load_config(env_file: str | Path | None = None) -> Config:
    """Load configuration from ``.env`` and environment variables.

    Parameters
    ----------
    env_file
        Explicit path to a ``.env`` file.  If ``None`` the loader searches
        for ``.env`` in the current directory and parents.
    """
    # Determine project root (directory containing this file's parent).
    base_dir = Path(__file__).resolve().parent
    search = [env_file] if env_file else []
    search.extend([base_dir / ".env", Path.cwd() / ".env"])

    for candidate in search:
        if candidate and candidate.exists():
            load_dotenv(candidate)
            _log.debug("Loaded env file: %s", candidate)
            break

    cfg = Config(
        openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip(),
        log_level=os.environ.get("LOG_LEVEL", "INFO").strip(),
        log_file=os.environ.get("LOG_FILE", "").strip(),
        max_agent_retries=int(os.environ.get("MAX_AGENT_RETRIES", "2")),
        base_dir=base_dir,
        data_dir=base_dir / "data",
        samples_dir=base_dir / "data" / "samples",
    )

    # Initialise logging with the loaded level + file and redact the key.
    configure_logging(
        level=cfg.log_level,
        log_file=cfg.log_file or None,
        sensitive=[cfg.openai_api_key] if cfg.has_openai else [],
    )

    _log.info("Configuration loaded: %s", cfg.safe_summary())
    if not cfg.has_openai:
        _log.info(
            "No OPENAI_API_KEY configured — using deterministic local analysis."
        )

    return cfg
