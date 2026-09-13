"""Central Orchestrator for NetDefenders.

Coordinates the security-agent pipeline:

    INPUT → Normalize → Threat → Network → Malware (when applicable)
         → Correlate → Severity → Response → Final Assessment
"""

from __future__ import annotations

from typing import Any

from ai_provider import AIProvider, create_provider
from config import Config, load_config

from agents import (
    BaseAgent,
    MalwareAgent,
    NetworkAgent,
    ResponseAgent,
    ThreatAgent,
)
from core.logging_config import get_logger
from core.message_bus import MessageBus
from core.models import (
    AgentResult,
    EventCategory,
    Finding,
    SecurityAssessment,
    SecurityEvent,
    Severity,
)

_log = get_logger("orchestrator")


class Orchestrator:
    """Coordinates agents and produces a final security assessment."""

    def __init__(
        self,
        config: Config | None = None,
        message_bus: MessageBus | None = None,
        ai_provider: AIProvider | None = None,
    ) -> None:
        self.config = config or load_config()
        self.message_bus = message_bus or MessageBus()
        self.ai_provider = ai_provider or create_provider(self.config)

        # Instantiate agents.
        self.threat_agent = ThreatAgent(
            message_bus=self.message_bus, config=self.config
        )
        self.network_agent = NetworkAgent(
            message_bus=self.message_bus, config=self.config
        )
        self.malware_agent = MalwareAgent(
            message_bus=self.message_bus, config=self.config
        )
        self.response_agent = ResponseAgent(
            message_bus=self.message_bus, config=self.config
        )

        # Register all agents on the bus for visibility.
        for agent in self.agents:
            self.message_bus.subscribe(f"task.{agent.name}", agent.analyze)

        _log.info(
            "Orchestrator initialised with %d agents (AI provider: %s)",
            len(self.agents),
            self.ai_provider.name,
        )

    @property
    def agents(self) -> list[BaseAgent]:
        """All registered agents in execution order."""
        return [
            self.threat_agent,
            self.network_agent,
            self.malware_agent,
            self.response_agent,
        ]

    # -- public API --------------------------------------------------------

    def run(self, events: list[SecurityEvent]) -> SecurityAssessment:
        """Execute the full analysis pipeline on *events*."""
        _log.info("Orchestrator starting pipeline with %d events", len(events))

        normalized = self._normalize(events)
        _log.info("Normalization complete: %d events ready", len(normalized))

        results: list[AgentResult] = []

        # Threat analysis
        threat_result = self._run_agent(self.threat_agent, normalized)
        results.append(threat_result)

        # Network analysis
        net_result = self._run_agent(self.network_agent, normalized)
        results.append(net_result)

        # Malware/IOC analysis — only when file-relevant events exist
        file_events = [
            e for e in normalized
            if e.file_name or e.file_hash or e.category == EventCategory.FILE
        ]
        if file_events:
            malware_result = self._run_agent(self.malware_agent, normalized)
            results.append(malware_result)
        else:
            _log.info("No file-related events — skipping MalwareAgent")
            results.append(
                AgentResult(
                    agent_name=self.malware_agent.name,
                    agent_role=self.malware_agent.role,
                    summary="Skipped — no file-related events",
                    success=True,
                )
            )

        # Build the final assessment (correlation + severity + response)
        assessment = self.response_agent.build_assessment(normalized, results)

        # Add the response agent's own result entry so the report shows all
        # agents that participated.
        results.append(
            AgentResult(
                agent_name=self.response_agent.name,
                agent_role=self.response_agent.role,
                summary=(
                    f"Correlated {len(assessment.correlated_findings)} findings, "
                    f"generated {len(assessment.response_recommendations)} recommendations"
                ),
                findings=[],  # response agent produces recommendations, not findings
                success=True,
            )
        )
        assessment.agent_results = results

        _log.info(
            "Pipeline complete: severity=%s, findings=%d, recommendations=%d",
            assessment.overall_severity.value,
            len(assessment.correlated_findings),
            len(assessment.response_recommendations),
        )

        return assessment

    # -- internal helpers --------------------------------------------------

    @property
    def _max_retries(self) -> int:
        return getattr(self.config, "max_agent_retries", 2)

    def _run_agent(
        self, agent: BaseAgent, events: list[SecurityEvent]
    ) -> AgentResult:
        """Invoke *agent* with retry logic."""
        last_result: AgentResult | None = None
        for attempt in range(1, self._max_retries + 2):  # initial + retries
            result = agent.analyze(events)
            if result.success:
                return result
            _log.warning(
                "Agent '%s' failed on attempt %d/%d: %s",
                agent.name,
                attempt,
                self._max_retries + 1,
                result.error,
            )
            last_result = result
        # Return the last failure so the pipeline continues.
        assert last_result is not None
        return last_result

    @staticmethod
    def _normalize(events: list[Any]) -> list[SecurityEvent]:
        """Convert raw input into validated :class:`SecurityEvent` objects."""
        normalized: list[SecurityEvent] = []
        for i, raw in enumerate(events):
            if isinstance(raw, SecurityEvent):
                normalized.append(raw)
            elif isinstance(raw, dict):
                try:
                    normalized.append(SecurityEvent(**raw))
                except Exception as exc:  # noqa: BLE001
                    _log.warning(
                        "Skipping malformed event at index %d: %s", i, exc
                    )
            else:
                _log.warning(
                    "Skipping malformed event at index %d (type=%s)",
                    i,
                    type(raw).__name__,
                )
        return normalized
