"""Structured data models for the NetDefenders system.

All models derive from a common base that provides serialisation helpers so
findings can be logged, displayed, and transported through the pipeline
without ad-hoc dict manipulation.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Severity(str, Enum):
    """Impact severity scale used throughout the pipeline."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

    @classmethod
    def from_score(cls, score: float) -> "Severity":
        """Map a 0-10 numeric score to a severity bucket."""
        if score >= 9.0:
            return cls.CRITICAL
        if score >= 7.0:
            return cls.HIGH
        if score >= 4.0:
            return cls.MEDIUM
        if score >= 1.0:
            return cls.LOW
        return cls.INFO

    @property
    def numeric(self) -> int:
        """Return a sortable integer weight."""
        order = {
            Severity.INFO: 1,
            Severity.LOW: 2,
            Severity.MEDIUM: 3,
            Severity.HIGH: 4,
            Severity.CRITICAL: 5,
        }
        return order[self]


class Confidence(str, Enum):
    """How certain the analyzer is about a finding."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

    @classmethod
    def from_score(cls, score: float) -> "Confidence":
        if score >= 0.75:
            return cls.HIGH
        if score >= 0.4:
            return cls.MEDIUM
        return cls.LOW


class FindingCategory(str, Enum):
    """Broad classification of what a finding relates to."""

    THREAT = "threat"
    NETWORK = "network"
    MALWARE = "malware"
    IOC = "indicator_of_compromise"
    PERSISTENCE = "persistence"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    CREDENTIAL_ATTACK = "credential_attack"
    ANOMALY = "anomaly"
    RECOMMENDATION = "recommendation"
    OTHER = "other"


class IndicatorType(str, Enum):
    """Type of indicator of compromise."""

    IP = "ip"
    DOMAIN = "domain"
    HASH = "hash"
    URL = "url"
    PORT = "port"
    PROCESS = "process"
    REGISTRY = "registry"
    FILE = "file"
    EMAIL = "email"
    OTHER = "other"


class EventCategory(str, Enum):
    """Source category of a security event."""

    PROCESS = "process"
    NETWORK = "network"
    FILE = "file"
    AUTH = "auth"
    SYSTEM = "system"
    OTHER = "other"


# ---------------------------------------------------------------------------
# Base model
# ---------------------------------------------------------------------------


@dataclass
class _BaseModel:
    """Common helpers for all data models."""

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for logging / JSON output."""
        result: dict[str, Any] = {}
        for k, v in self.__dict__.items():
            if isinstance(v, Enum):
                result[k] = v.value
            elif isinstance(v, datetime):
                result[k] = v.isoformat()
            elif isinstance(v, list):
                result[k] = [
                    item.to_dict() if isinstance(item, _BaseModel)
                    else item.value if isinstance(item, Enum)
                    else item.isoformat() if isinstance(item, datetime)
                    else item
                    for item in v
                ]
            elif isinstance(v, _BaseModel):
                result[k] = v.to_dict()
            else:
                result[k] = v
        return result


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------


@dataclass
class Indicator(_BaseModel):
    """An indicator of compromise (IOC)."""

    type: IndicatorType
    value: str
    description: str = ""
    source: str = ""
    malicious: bool = False

    def __post_init__(self) -> None:
        if isinstance(self.type, str):
            self.type = IndicatorType(self.type)


@dataclass
class Finding(_BaseModel):
    """A single security finding produced by the analyzer."""

    title: str
    description: str
    severity: Severity
    confidence: Confidence
    category: FindingCategory
    source: str
    evidence: list[str] = field(default_factory=list)
    indicators: list[Indicator] = field(default_factory=list)
    recommended_action: str = ""

    def __post_init__(self) -> None:
        if isinstance(self.severity, str):
            self.severity = Severity(self.severity)
        if isinstance(self.confidence, str):
            self.confidence = Confidence(self.confidence)
        if isinstance(self.category, str):
            self.category = FindingCategory(self.category)

    @property
    def severity_score(self) -> float:
        """Approximate CVSS-like 0-10 score for ranking."""
        sev_weight = {
            Severity.CRITICAL: 10.0,
            Severity.HIGH: 8.0,
            Severity.MEDIUM: 5.0,
            Severity.LOW: 2.0,
            Severity.INFO: 0.5,
        }
        conf_weight = {
            Confidence.HIGH: 1.0,
            Confidence.MEDIUM: 0.75,
            Confidence.LOW: 0.5,
        }
        return sev_weight[self.severity] * conf_weight[self.confidence]


@dataclass
class SecurityEvent(_BaseModel):
    """A normalised security event fed into the pipeline."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    category: EventCategory = EventCategory.OTHER
    source: str = "unknown"
    description: str = ""
    host: str = ""
    user: str = ""
    process_name: str = ""
    process_pid: int | None = None
    remote_ip: str = ""
    remote_port: int | None = None
    local_port: int | None = None
    protocol: str = ""
    domain: str = ""
    file_hash: str = ""
    file_name: str = ""
    file_size: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if isinstance(self.category, str):
            self.category = EventCategory(self.category)
        if isinstance(self.timestamp, str):
            self.timestamp = datetime.fromisoformat(self.timestamp)


@dataclass
class SecurityAssessment(_BaseModel):
    """Final output of the orchestrator after correlating all findings."""

    assessment_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    events_analyzed: int = 0
    correlated_findings: list[Finding] = field(default_factory=list)
    indicators: list[Indicator] = field(default_factory=list)
    overall_severity: Severity = Severity.INFO
    overall_confidence: Confidence = Confidence.LOW
    severity_score: float = 0.0
    response_recommendations: list[str] = field(default_factory=list)
    summary: str = ""

    @property
    def critical_count(self) -> int:
        return sum(
            1 for f in self.correlated_findings if f.severity == Severity.CRITICAL
        )

    @property
    def high_count(self) -> int:
        return sum(
            1 for f in self.correlated_findings if f.severity == Severity.HIGH
        )
