"""Comprehensive test suite for NetDefenders (single-analyzer architecture).

All tests run offline — no internet connection or paid API is required.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import pytest  # noqa: E402

from ai_provider import LocalFallback, OpenAIProvider, create_provider  # noqa: E402
from analyzer import SecurityAnalyzer  # noqa: E402
from config import Config, load_config  # noqa: E402
from core.message_bus import Message, MessageBus  # noqa: E402
from core.models import (  # noqa: E402
    Confidence,
    EventCategory,
    Finding,
    FindingCategory,
    Indicator,
    IndicatorType,
    SecurityAssessment,
    SecurityEvent,
    Severity,
)
from data.sample_data import load_demo_events  # noqa: E402
from orchestrator import Orchestrator  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def cfg() -> Config:
    os.environ.pop("OPENAI_API_KEY", None)
    return load_config()


@pytest.fixture
def demo_events() -> list[SecurityEvent]:
    return load_demo_events()


@pytest.fixture
def analyzer() -> SecurityAnalyzer:
    return SecurityAnalyzer(ai_provider=LocalFallback())


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestConfig:
    def test_load_config_returns_config_object(self, cfg: Config) -> None:
        assert isinstance(cfg, Config)
        assert cfg.log_level in ("INFO", "DEBUG", "WARNING", "ERROR")

    def test_no_api_key_defaults_to_local(self, cfg: Config) -> None:
        assert cfg.has_openai is False

    def test_config_has_expected_attributes(self, cfg: Config) -> None:
        assert hasattr(cfg, "openai_api_key")
        assert hasattr(cfg, "openai_model")
        assert hasattr(cfg, "log_level")
        assert hasattr(cfg, "max_agent_retries")
        assert hasattr(cfg, "data_dir")
        assert hasattr(cfg, "samples_dir")

    def test_safe_summary_has_no_secrets(self, cfg: Config) -> None:
        summary = cfg.safe_summary()
        assert "openai_api_key" not in summary
        assert "has_openai" in summary


# ---------------------------------------------------------------------------
# Data model tests
# ---------------------------------------------------------------------------


class TestModels:
    def test_security_event_defaults(self) -> None:
        evt = SecurityEvent()
        assert evt.id
        assert evt.category == EventCategory.OTHER
        assert evt.source == "unknown"

    def test_security_event_from_dict_category_conversion(self) -> None:
        evt = SecurityEvent(category="network")
        assert evt.category == EventCategory.NETWORK

    def test_severity_from_score(self) -> None:
        assert Severity.from_score(9.5) == Severity.CRITICAL
        assert Severity.from_score(7.5) == Severity.HIGH
        assert Severity.from_score(5.0) == Severity.MEDIUM
        assert Severity.from_score(2.0) == Severity.LOW
        assert Severity.from_score(0.0) == Severity.INFO

    def test_confidence_from_score(self) -> None:
        assert Confidence.from_score(0.9) == Confidence.HIGH
        assert Confidence.from_score(0.5) == Confidence.MEDIUM
        assert Confidence.from_score(0.2) == Confidence.LOW

    def test_finding_severity_score(self) -> None:
        f = Finding(
            title="test", description="test",
            severity=Severity.CRITICAL, confidence=Confidence.HIGH,
            category=FindingCategory.THREAT, source_agent="test",
        )
        assert f.severity_score == 10.0

        f_low = Finding(
            title="test", description="test",
            severity=Severity.LOW, confidence=Confidence.LOW,
            category=FindingCategory.THREAT, source_agent="test",
        )
        assert f_low.severity_score == 1.0

    def test_finding_string_to_enum_conversion(self) -> None:
        f = Finding(
            title="t", description="d",
            severity="high", confidence="medium", category="network",
            source_agent="x",
        )
        assert f.severity == Severity.HIGH
        assert f.confidence == Confidence.MEDIUM
        assert f.category == FindingCategory.NETWORK

    def test_indicator_type_conversion(self) -> None:
        ind = Indicator(type="ip", value="1.2.3.4")
        assert ind.type == IndicatorType.IP

    def test_to_dict_serialization(self) -> None:
        evt = SecurityEvent(host="test-host", category=EventCategory.NETWORK)
        d = evt.to_dict()
        assert d["host"] == "test-host"
        assert d["category"] == "network"

    def test_security_assessment_counts(self) -> None:
        a = SecurityAssessment()
        a.correlated_findings = [
            Finding("t1", "d", Severity.CRITICAL, Confidence.HIGH,
                    FindingCategory.THREAT, "x"),
            Finding("t2", "d", Severity.CRITICAL, Confidence.HIGH,
                    FindingCategory.THREAT, "x"),
            Finding("t3", "d", Severity.HIGH, Confidence.HIGH,
                    FindingCategory.THREAT, "x"),
        ]
        assert a.critical_count == 2
        assert a.high_count == 1


# ---------------------------------------------------------------------------
# Message bus tests
# ---------------------------------------------------------------------------


class TestMessageBus:
    def test_publish_subscribe(self) -> None:
        bus = MessageBus()
        received: list[Message] = []
        bus.subscribe("test.topic", received.append)
        bus.publish(Message(topic="test.topic", sender="a", payload="hello"))
        assert len(received) == 1
        assert received[0].payload == "hello"

    def test_send_creates_directed_message(self) -> None:
        bus = MessageBus()
        received: list[Message] = []
        bus.subscribe("direct", received.append)
        msg = bus.send("alice", "bob", "direct", {"key": "val"})
        assert msg.sender == "alice"
        assert msg.recipient == "bob"
        assert len(received) == 1

    def test_history(self) -> None:
        bus = MessageBus()
        bus.publish(Message(topic="h1", sender="a"))
        bus.publish(Message(topic="h2", sender="b"))
        assert len(bus.history) == 2

    def test_clear(self) -> None:
        bus = MessageBus()
        bus.publish(Message(topic="x", sender="a"))
        bus.clear()
        assert len(bus.history) == 0

    def test_subscriber_exception_does_not_crash(self) -> None:
        bus = MessageBus()
        def bad_sub(msg: Message) -> None:
            raise ValueError("boom")
        good: list[Message] = []
        bus.subscribe("err", bad_sub)
        bus.subscribe("err", good.append)
        bus.publish(Message(topic="err", sender="a"))
        assert len(good) == 1


# ---------------------------------------------------------------------------
# SecurityAnalyzer tests (single analyzer — all detection categories)
# ---------------------------------------------------------------------------


class TestSecurityAnalyzer:
    def test_analyzer_initializes(self, analyzer: SecurityAnalyzer) -> None:
        assert analyzer.name == "SecurityAnalyzer"
        assert analyzer.ai_provider is not None

    def test_analyze_returns_assessment(self, analyzer: SecurityAnalyzer) -> None:
        assessment = analyzer.analyze([SecurityEvent(host="h1")])
        assert isinstance(assessment, SecurityAssessment)
        assert assessment.events_analyzed == 1

    def test_empty_events(self, analyzer: SecurityAnalyzer) -> None:
        assessment = analyzer.analyze([])
        assert assessment.events_analyzed == 0
        assert len(assessment.correlated_findings) == 0
        assert assessment.overall_severity == Severity.INFO

    def test_handles_malformed_events(self, analyzer: SecurityAnalyzer) -> None:
        # SecurityEvent objects are always valid; the orchestrator handles
        # raw non-SecurityEvent input. Here we pass only valid events.
        assessment = analyzer.analyze([SecurityEvent(host="h1"), SecurityEvent(host="h2")])
        assert assessment.events_analyzed == 2

    # -- detection: processes --
    def test_detects_suspicious_process(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(process_name="mimikatz.exe", process_pid=1234, host="h1")
        assessment = analyzer.analyze([evt])
        assert any("mimikatz" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: domains --
    def test_detects_suspicious_domain(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(domain="malicious-c2.example", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("domain" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: persistence --
    def test_detects_persistence(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="schtasks /create /tn evil", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("persistence" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: credential attacks --
    def test_detects_credential_attack(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="mimikatz lsass dump detected", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("credential" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: privilege escalation --
    def test_detects_privilege_escalation(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="PrintSpoofer privilege escalation", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("privilege" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: suspicious commands --
    def test_detects_suspicious_command(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="powershell -enc abc123", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("command" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: network — suspicious port --
    def test_detects_suspicious_port(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(remote_ip="1.2.3.4", remote_port=4444, protocol="TCP", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("4444" in f.title for f in assessment.correlated_findings)

    # -- detection: network — known bad IP --
    def test_detects_known_bad_ip(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(remote_ip="185.220.101.5", remote_port=80, host="h1")
        assessment = analyzer.analyze([evt])
        assert any("known-bad" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: network — scanning --
    def test_detects_scanning(self, analyzer: SecurityAnalyzer) -> None:
        events = [
            SecurityEvent(host="h1", remote_ip="10.0.0.1", remote_port=p)
            for p in range(1, 15)
        ]
        assessment = analyzer.analyze(events)
        assert any("scanning" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: malware — known bad hash --
    def test_detects_known_bad_hash(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(
            file_name="beacon.exe",
            file_hash="a665a45920422f9d417e4837ee238a8b65e6e1f6a1b3a0c9f9d6e5f4c3b2a198",
            host="h1",
        )
        assessment = analyzer.analyze([evt])
        assert any("malicious" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: malware — double extension --
    def test_detects_double_extension(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(file_name="invoice.pdf.exe", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("double-extension" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: malware — suspicious filename --
    def test_detects_suspicious_filename(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(file_name="procdump.exe", host="h1")
        assessment = analyzer.analyze([evt])
        assert any("procdump" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: malware — suspicious strings --
    def test_detects_suspicious_strings(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(
            file_name="loader.dll",
            description="Contains CreateRemoteThread and VirtualAllocEx",
            host="h1",
        )
        assessment = analyzer.analyze([evt])
        assert any("suspicious strings" in f.title.lower() for f in assessment.correlated_findings)

    # -- detection: benign event produces no findings --
    def test_benign_event_no_findings(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="user logged in", host="h1")
        assessment = analyzer.analyze([evt])
        assert len(assessment.correlated_findings) == 0

    # -- correlation --
    def test_correlation_deduplicates(self, analyzer: SecurityAnalyzer) -> None:
        evt1 = SecurityEvent(process_name="mimikatz.exe", process_pid=1, host="h1")
        evt2 = SecurityEvent(process_name="mimikatz.exe", process_pid=2, host="h2")
        assessment = analyzer.analyze([evt1, evt2])
        # Same title → deduplicated to 1
        proc_findings = [f for f in assessment.correlated_findings if "mimikatz" in f.title.lower()]
        assert len(proc_findings) == 1

    # -- severity computation --
    def test_severity_is_high_with_cred_attack(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(description="mimikatz lsass dump", host="h1")
        assessment = analyzer.analyze([evt])
        # Credential attack is CRITICAL severity with MEDIUM confidence →
        # severity_score = 10.0 * 0.75 = 7.5 → maps to HIGH overall.
        assert assessment.overall_severity in (Severity.HIGH, Severity.CRITICAL)
        assert any(f.category == FindingCategory.CREDENTIAL_ATTACK
                   for f in assessment.correlated_findings)

    # -- recommendations --
    def test_recommendations_generated(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(
            process_name="mimikatz.exe", process_pid=1234, host="h1",
        )
        assessment = analyzer.analyze([evt])
        assert len(assessment.response_recommendations) > 0
        assert any("[HIGH]" in r for r in assessment.response_recommendations)

    def test_recommendations_ordered_by_severity(self, analyzer: SecurityAnalyzer) -> None:
        critical_evt = SecurityEvent(description="mimikatz lsass dump", host="h1")
        medium_evt = SecurityEvent(description="schtasks /create /tn x", host="h2")
        assessment = analyzer.analyze([critical_evt, medium_evt])
        assert len(assessment.response_recommendations) >= 2
        # CRITICAL should appear before MEDIUM
        first_crit = next(
            (i for i, r in enumerate(assessment.response_recommendations) if "[CRITICAL]" in r), -1
        )
        first_med = next(
            (i for i, r in enumerate(assessment.response_recommendations) if "[MEDIUM]" in r), -1
        )
        assert first_crit != -1
        assert first_med != -1
        assert first_crit < first_med

    # -- summary --
    def test_summary_contains_sections(self, analyzer: SecurityAnalyzer) -> None:
        evt = SecurityEvent(process_name="mimikatz.exe", host="h1")
        assessment = analyzer.analyze([evt])
        assert "Observed Evidence" in assessment.summary
        assert "Suspected Threats" in assessment.summary
        assert "Recommended Actions" in assessment.summary

    # -- compute_sha256 helper --
    def test_compute_sha256(self) -> None:
        h = SecurityAnalyzer.compute_sha256(b"hello")
        assert len(h) == 64
        assert h == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


# ---------------------------------------------------------------------------
# Orchestrator tests
# ---------------------------------------------------------------------------


class TestOrchestrator:
    def test_orchestrator_initializes(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assert orch.analyzer is not None
        assert orch.ai_provider is not None

    def test_orchestrator_runs_full_pipeline(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert isinstance(assessment, SecurityAssessment)
        assert assessment.events_analyzed == len(demo_events)
        assert len(assessment.correlated_findings) > 0
        assert assessment.overall_severity in (Severity.CRITICAL, Severity.HIGH)

    def test_orchestrator_handles_empty_input(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run([])
        assert assessment.events_analyzed == 0
        assert len(assessment.correlated_findings) == 0
        assert assessment.overall_severity == Severity.INFO

    def test_orchestrator_handles_malformed_input(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(["garbage", 42, {"host": "ok"}])  # type: ignore[list-item]
        assert assessment.events_analyzed == 1

    def test_orchestrator_message_bus_logs_pipeline(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        orch.run(demo_events)
        topics = [m.topic for m in orch.message_bus.history]
        assert "pipeline.started" in topics
        assert "pipeline.completed" in topics


# ---------------------------------------------------------------------------
# AI provider tests
# ---------------------------------------------------------------------------


class TestAIProvider:
    def test_local_fallback_always_available(self) -> None:
        p = LocalFallback()
        assert p.is_available is True
        assert p.name == "local-fallback"

    def test_local_fallback_returns_text(self) -> None:
        p = LocalFallback()
        result = p.analyze("test prompt", {"key": "val"})
        assert isinstance(result, str)
        assert len(result) > 0

    def test_create_provider_no_key_returns_local(self, cfg: Config) -> None:
        p = create_provider(cfg)
        assert isinstance(p, LocalFallback)

    def test_openai_provider_without_package(self) -> None:
        os.environ["OPENAI_API_KEY"] = "sk-fake-key-for-testing"
        cfg2 = load_config()
        p = create_provider(cfg2)
        assert isinstance(p, LocalFallback)
        os.environ.pop("OPENAI_API_KEY", None)

    def test_openai_provider_not_available_without_key(self) -> None:
        p = OpenAIProvider(api_key="", model="gpt-4o-mini")
        assert p.is_available is False

    def test_analyzer_works_with_local_fallback(self) -> None:
        analyzer = SecurityAnalyzer(ai_provider=LocalFallback())
        evt = SecurityEvent(process_name="mimikatz.exe", host="h1")
        assessment = analyzer.analyze([evt])
        assert len(assessment.correlated_findings) > 0

    def test_analyzer_works_with_no_provider(self) -> None:
        analyzer = SecurityAnalyzer(ai_provider=None)
        evt = SecurityEvent(process_name="mimikatz.exe", host="h1")
        assessment = analyzer.analyze([evt])
        assert len(assessment.correlated_findings) > 0


# ---------------------------------------------------------------------------
# Demo dataset tests
# ---------------------------------------------------------------------------


class TestDemoData:
    def test_demo_events_loaded(self, demo_events) -> None:
        assert len(demo_events) > 0
        assert all(isinstance(e, SecurityEvent) for e in demo_events)

    def test_demo_events_have_required_fields(self, demo_events) -> None:
        for evt in demo_events:
            assert evt.id
            assert evt.host
            assert evt.source

    def test_demo_contains_threats(self, demo_events) -> None:
        threats = [
            e for e in demo_events
            if e.process_name and "mimikatz" in e.process_name.lower()
        ]
        assert len(threats) >= 1

    def test_demo_contains_network_events(self, demo_events) -> None:
        net = [e for e in demo_events if e.remote_ip]
        assert len(net) >= 5

    def test_demo_contains_file_events(self, demo_events) -> None:
        files = [e for e in demo_events if e.file_name or e.file_hash]
        assert len(files) >= 2

    def test_demo_pipeline_produces_recommendations(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert len(assessment.response_recommendations) > 0
        assert assessment.overall_severity.numeric >= Severity.HIGH.numeric

    def test_demo_finds_mimikatz(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert any("mimikatz" in f.title.lower() for f in assessment.correlated_findings)

    def test_demo_finds_known_bad_ip(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert any("known-bad" in f.title.lower() for f in assessment.correlated_findings)

    def test_demo_finds_scanning(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert any("scanning" in f.title.lower() for f in assessment.correlated_findings)

    def test_demo_finds_malware_hash(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert any("malicious" in f.title.lower() for f in assessment.correlated_findings)
