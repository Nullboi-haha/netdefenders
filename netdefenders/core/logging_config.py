"""Structured logging configuration for NetDefenders.

Provides a single :func:`get_logger` entry point that every module uses.
Logs are human-readable console output plus optional file output.  Secrets
and API keys are never logged.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)-24s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_configured = False
_sensitive_patterns: list[str] = []


class _SecretFilter(logging.Filter):
    """Redact anything that looks like an API key from log records."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        msg = str(record.getMessage())
        for pattern in _sensitive_patterns:
            if pattern and pattern in msg:
                record.msg = msg.replace(pattern, "***REDACTED***")
        return True


def configure_logging(
    level: str | None = None,
    log_file: str | None = None,
    sensitive: list[str] | None = None,
) -> logging.Logger:
    """Initialise root and NetDefenders loggers.

    Parameters
    ----------
    level
        Logging level name (``DEBUG``, ``INFO``, …).  Falls back to the
        ``LOG_LEVEL`` env var or ``INFO``.
    log_file
        Optional file path.  Falls back to ``LOG_FILE`` env var.
    sensitive
        List of raw secret strings that should be redacted if they appear
        in any log message.
    """
    global _configured, _sensitive_patterns

    if sensitive:
        _sensitive_patterns = [s for s in sensitive if s]

    root = logging.getLogger()

    # Only configure handlers once so repeated calls don't duplicate output.
    if not _configured:
        lvl_name = (level or os.environ.get("LOG_LEVEL") or "INFO").upper()
        lvl = getattr(logging, lvl_name, logging.INFO)

        formatter = logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT)
        secret_filter = _SecretFilter()

        console = logging.StreamHandler()
        console.setFormatter(formatter)
        console.addFilter(secret_filter)
        root.addHandler(console)

        file_path = log_file or os.environ.get("LOG_FILE")
        if file_path:
            try:
                Path(file_path).parent.mkdir(parents=True, exist_ok=True)
                file_handler = logging.FileHandler(file_path, encoding="utf-8")
                file_handler.setFormatter(formatter)
                file_handler.addFilter(secret_filter)
                root.addHandler(file_handler)
            except OSError:
                pass  # read-only FS etc. — console logging is enough

        root.setLevel(lvl)
        _configured = True

    return logging.getLogger("netdefenders")


def get_logger(name: str) -> logging.Logger:
    """Return a child logger under the ``netdefenders`` namespace."""
    if not _configured:
        configure_logging()
    if name.startswith("netdefenders"):
        return logging.getLogger(name)
    return logging.getLogger(f"netdefenders.{name}")
