"""AI provider abstraction for NetDefenders.

Keeps LLM integration separate from analyzer logic.  When an API key
is available, :class:`OpenAIProvider` can be used to enhance reasoning.
When no key is configured, :class:`LocalFallback` provides deterministic
responses so the system remains fully functional.

To add another provider, implement the :class:`AIProvider` interface and
register it in :func:`create_provider`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from core.logging_config import get_logger

_log = get_logger("ai_provider")


class AIProvider(ABC):
    """Abstract interface for all AI providers."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def analyze(self, prompt: str, context: dict[str, Any] | None = None) -> str:
        """Return the provider's analysis text for *prompt*."""
        ...


class LocalFallback(AIProvider):
    """Deterministic local fallback — always available, no API needed."""

    def __init__(self) -> None:
        self._name = "local-fallback"

    @property
    def name(self) -> str:
        return self._name

    @property
    def is_available(self) -> bool:
        return True

    def analyze(self, prompt: str, context: dict[str, Any] | None = None) -> str:
        _log.debug("Local fallback responding to prompt (%d chars)", len(prompt))
        ctx_str = ""
        if context:
            ctx_str = f" Context keys: {', '.join(context.keys())}."
        return (
            "LOCAL ANALYSIS (no AI provider configured): "
            "Reliance on deterministic pattern matching. "
            f"Prompt processed.{ctx_str}"
        )


class OpenAIProvider(AIProvider):
    """OpenAI Chat Completions provider.

    Uses the ``openai`` Python package lazily so the dependency is only
    needed when an API key is actually configured.
    """

    def __init__(self, api_key: str, model: str = "gpt-4o-mini") -> None:
        self._api_key = api_key
        self._model = model
        self._client = None
        self._available = False

        try:
            from openai import OpenAI  # type: ignore[import-untyped]

            self._client = OpenAI(api_key=api_key)
            self._available = True
            _log.info("OpenAI provider initialised with model '%s'", model)
        except ImportError:
            _log.warning(
                "OpenAI API key configured but 'openai' package is not "
                "installed.  Install with: pip install openai"
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("Failed to initialise OpenAI client: %s", exc)

    @property
    def name(self) -> str:
        return "openai"

    @property
    def is_available(self) -> bool:
        return self._available and self._client is not None

    def analyze(self, prompt: str, context: dict[str, Any] | None = None) -> str:
        if not self.is_available:
            return LocalFallback().analyze(prompt, context)

        full_prompt = prompt
        if context:
            full_prompt += f"\n\nContext: {context}"

        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a defensive cybersecurity analyst. "
                            "Provide structured, factual analysis. "
                            "Never suggest offensive or destructive actions."
                        ),
                    },
                    {"role": "user", "content": full_prompt},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001
            _log.error("OpenAI API call failed: %s — falling back to local", exc)
            return LocalFallback().analyze(prompt, context)


def create_provider(config: Any) -> AIProvider:
    """Factory that returns the best available provider for *config*.

    If an OpenAI key is configured **and** the ``openai`` package is
    installed, returns :class:`OpenAIProvider`.  Otherwise returns
    :class:`LocalFallback`.
    """
    has_key = getattr(config, "has_openai", False)
    if has_key:
        provider = OpenAIProvider(
            api_key=config.openai_api_key,
            model=config.openai_model,
        )
        if provider.is_available:
            return provider
        _log.warning(
            "OPENAI_API_KEY is set but the provider could not initialise. "
            "Using local fallback."
        )
    return LocalFallback()
