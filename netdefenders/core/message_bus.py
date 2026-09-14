"""In-process message bus for pipeline communication.

The message bus provides observability for the orchestrator pipeline.
The orchestrator publishes pipeline lifecycle events (started, completed,
error) so external observers can monitor progress without direct coupling
to the analyzer internals.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from .logging_config import get_logger

_log = get_logger("message_bus")


@dataclass
class Message:
    """A single message envelope passed through the bus."""

    id: str = field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    topic: str = ""
    sender: str = ""
    recipient: str = ""
    payload: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "topic": self.topic,
            "sender": self.sender,
            "recipient": self.recipient,
            "payload": self.payload,
            "metadata": self.metadata,
        }


# Type alias for subscriber callables.
Subscriber = Callable[[Message], None]


class MessageBus:
    """Simple publish/subscribe bus scoped to a single process."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Subscriber]] = defaultdict(list)
        self._history: list[Message] = []

    def subscribe(self, topic: str, subscriber: Subscriber) -> None:
        """Register *subscriber* to receive messages on *topic*."""
        self._subscribers[topic].append(subscriber)
        _log.debug("Subscriber %s registered for topic '%s'", subscriber, topic)

    def publish(self, message: Message) -> None:
        """Deliver *message* to all subscribers of its topic."""
        self._history.append(message)
        _log.debug(
            "Publishing message %s on topic '%s' from '%s' to '%s'",
            message.id,
            message.topic,
            message.sender,
            message.recipient or "broadcast",
        )
        for subscriber in self._subscribers.get(message.topic, []):
            try:
                subscriber(message)
            except Exception as exc:  # noqa: BLE001
                _log.error(
                    "Subscriber %s raised on topic '%s': %s",
                    subscriber,
                    message.topic,
                    exc,
                )

    def send(self, sender: str, recipient: str, topic: str, payload: Any) -> Message:
        """Convenience wrapper to create + publish a directed message."""
        msg = Message(
            sender=sender,
            recipient=recipient,
            topic=topic,
            payload=payload,
        )
        self.publish(msg)
        return msg

    @property
    def history(self) -> list[Message]:
        """Return a copy of every message published so far."""
        return list(self._history)

    def clear(self) -> None:
        """Reset the bus (useful between tests)."""
        self._subscribers.clear()
        self._history.clear()
