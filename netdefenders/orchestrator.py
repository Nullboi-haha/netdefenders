"""Central Orchestrator for NetDefenders.

Coordinates the single-analyzer pipeline:

    INPUT → Normalize → SecurityAnalyzer → Findings
         → Correlation → Severity → Recommendations → Final Assessment
"""

from __future__ import annotations

from typing import Any

from ai_provider import AIProvider, create_provider
from analyzer import SecurityAnalyzer
from config import Config, load_config
from core.logging_config import get_logger
from core.message_bus import MessageBus
from core.models import SecurityAssessment, SecurityEvent

_log = get_logger("orchestrator")


class Orchestrator:
    """Coordinates the single analyzer and produces a final assessment."""

    def __init__(
        self,
        config: Config | None = None,
        message_bus: MessageBus | None = None,
        ai_provider: AIProvider | None = None,
    ) -> None:
        self.config = config or load_config()
        self.message_bus = message_bus or MessageBus()
        self.ai_provider = ai_provider or create_provider(self.config)
        self.analyzer = SecurityAnalyzer(
            ai_provider=self.ai_provider,
            config=self.config,
        )

        _log.info(
            "Orchestrator initialised (AI provider: %s)",
            self.ai_provider.name,
        )

    def run(self, events: list[SecurityEvent]) -> SecurityAssessment:
        """Execute the full analysis pipeline on *events*."""
        _log.info("Orchestrator starting pipeline with %d events", len(events))

        self.message_bus.send(
            sender="orchestrator",
            recipient="analyzer",
            topic="pipeline.started",
            payload={"event_count": len(events)},
        )

        normalized = self._normalize(events)
        _log.info("Normalization complete: %d events ready", len(normalized))

        try:
            assessment = self.analyzer.analyze(normalized)
        except Exception as exc:  # noqa: BLE001
            _log.error("Analyzer raised an error: %s", exc)
            self.message_bus.send(
                sender="analyzer",
                recipient="orchestrator",
                topic="pipeline.error",
                payload={"error": str(exc)},
            )
            return SecurityAssessment(
                events_analyzed=len(normalized),
                summary=f"Analysis failed: {exc}",
            )

        self.message_bus.send(
            sender="analyzer",
            recipient="orchestrator",
            topic="pipeline.completed",
            payload={
                "findings": len(assessment.correlated_findings),
                "severity": assessment.overall_severity.value,
            },
        )

        _log.info(
            "Pipeline complete: severity=%s, findings=%d, recommendations=%d",
            assessment.overall_severity.value,
            len(assessment.correlated_findings),
            len(assessment.response_recommendations),
        )
        return assessment

    @staticmethod
    def _normalize(events: list[Any]) -> list[SecurityEvent]:
        """Convert raw input into validated SecurityEvent objects."""
        normalized: list[SecurityEvent] = []
        for i, raw in enumerate(events):
            if isinstance(raw, SecurityEvent):
                normalized.append(raw)
            elif isinstance(raw, dict):
                try:
                    normalized.append(SecurityEvent(**raw))
                except Exception as exc:  # noqa: BLE001
                    _log.warning("Skipping malformed event at index %d: %s", i, exc)
            else:
                _log.warning(
                    "Skipping malformed event at index %d (type=%s)",
                    i,
                    type(raw).__name__,
                )
        return normalized
