"""Common base class for every NetDefenders agent.

The :class:`BaseAgent` defines the contract that all specialised agents
follow:

* a ``name`` and ``role``
* a uniform :meth:`analyze` entry point
* structured :class:`AgentResult` output
* per-agent logging
* error handling that never crashes the orchestrator
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from core.logging_config import get_logger
from core.message_bus import MessageBus
from core.models import AgentResult, Finding, SecurityEvent


class BaseAgent(ABC):
    """Abstract base for all agents.

    Subclasses implement :meth:`_run` which receives a list of
    :class:`SecurityEvent` objects and returns a list of :class:`Finding`
    objects plus a summary string.
    """

    def __init__(
        self,
        name: str,
        role: str,
        message_bus: MessageBus | None = None,
        config: Any = None,
    ) -> None:
        self.name = name
        self.role = role
        self.message_bus = message_bus
        self.config = config
        self.logger = get_logger(f"agent.{name}")

    # -- public API --------------------------------------------------------

    def analyze(self, events: list[SecurityEvent]) -> AgentResult:
        """Run the agent's analysis and return a structured result.

        Wraps :meth:`_run` with logging and error handling so a single
        agent failure doesn't crash the orchestrator.
        """
        self.logger.info("Agent '%s' received %d events", self.name, len(events))

        if not isinstance(events, list):
            msg = f"Agent '{self.name}' expected a list of events, got {type(events).__name__}"
            self.logger.error(msg)
            return AgentResult(
                agent_name=self.name,
                agent_role=self.role,
                success=False,
                error=msg,
            )

        # Validate individual events — skip malformed ones rather than failing.
        clean: list[SecurityEvent] = []
        for i, evt in enumerate(events):
            if isinstance(evt, SecurityEvent):
                clean.append(evt)
            else:
                self.logger.warning(
                    "Agent '%s' skipping malformed event at index %d (type=%s)",
                    self.name,
                    i,
                    type(evt).__name__,
                )

        if self.message_bus:
            self.message_bus.send(
                sender=self.name,
                recipient="orchestrator",
                topic="agent.started",
                payload={"event_count": len(clean)},
            )

        try:
            findings, summary = self._run(clean)
        except Exception as exc:  # noqa: BLE001
            self.logger.error("Agent '%s' raised an error: %s", self.name, exc)
            result = AgentResult(
                agent_name=self.name,
                agent_role=self.role,
                success=False,
                error=str(exc),
            )
            if self.message_bus:
                self.message_bus.send(
                    sender=self.name,
                    recipient="orchestrator",
                    topic="agent.error",
                    payload={"error": str(exc)},
                )
            return result

        result = AgentResult(
            agent_name=self.name,
            agent_role=self.role,
            findings=findings,
            summary=summary,
            success=True,
        )

        self.logger.info(
            "Agent '%s' completed: %d findings", self.name, len(findings)
        )

        if self.message_bus:
            self.message_bus.send(
                sender=self.name,
                recipient="orchestrator",
                topic="agent.completed",
                payload={"finding_count": len(findings)},
            )

        return result

    # -- to be implemented by subclasses ----------------------------------

    @abstractmethod
    def _run(
        self, events: list[SecurityEvent]
    ) -> tuple[list[Finding], str]:
        """Process *events* and return ``(findings, summary)``.

        Implementations must not raise — any exception is caught by
        :meth:`analyze` and converted to a failed result.
        """
        ...
