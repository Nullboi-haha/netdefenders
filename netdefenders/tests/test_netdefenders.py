"""Comprehensive test suite for NetDefenders.

All tests run offline — no internet connection or paid API is required.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure the project root is importable when running pytest from anywhere.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import pytest  # noqa: E402

from ai_provider import LocalFallback, OpenAIProvider, create_provider  # noqa: E402
from config import Config, load_config  # noqa: E402
from core.message_bus import Message, MessageBus  # noqa: E402
from core.models import (  # noqa: E402
    AgentResult,
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
from agents import (  # noqa: E402
    BaseAgent,
    MalwareAgent,
    NetworkAgent,
    ResponseAgent,
    ThreatAgent,
)
from data.sample_data import load_demo_events  # noqa: E402
from orchestrator import Orchestrator  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bus() -> MessageBus:
    return MessageBus()


@pytest.fixture
def cfg() -> Config:
    """Load config with no API key to test the fallback path."""
    os.environ.pop("OPENAI_API_KEY", None)
    return load_config()


@pytest.fixture
def demo_events() -> list[SecurityEvent]:
    return load_demo_events()


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
        assert evt.id  # auto-generated UUID
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
            title="test",
            description="test",
            severity=Severity.CRITICAL,
            confidence=Confidence.HIGH,
            category=FindingCategory.THREAT,
            source_agent="test",
        )
        assert f.severity_score == 10.0

        f_low = Finding(
            title="test",
            description="test",
            severity=Severity.LOW,
            confidence=Confidence.LOW,
            category=FindingCategory.THREAT,
            source_agent="test",
        )
        assert f_low.severity_score == 1.0

    def test_finding_string_to_enum_conversion(self) -> None:
        f = Finding(
            title="t",
            description="d",
            severity="high",
            confidence="medium",
            category="network",
            source_agent="x",
        )
        assert f.severity == Severity.HIGH
        assert f.confidence == Confidence.MEDIUM
        assert f.category == FindingCategory.NETWORK

    def test_indicator_type_conversion(self) -> None:
        ind = Indicator(type="ip", value="1.2.3.4")
        assert ind.type == IndicatorType.IP

    def test_agent_result_properties(self) -> None:
        r = AgentResult(agent_name="test", agent_role="test")
        assert r.finding_count == 0
        r.findings.append(
            Finding(
                title="t", description="d",
                severity=Severity.LOW, confidence=Confidence.LOW,
                category=FindingCategory.OTHER, source_agent="test",
            )
        )
        assert r.finding_count == 1

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
    def test_publish_subscribe(self, bus: MessageBus) -> None:
        received: list[Message] = []
        bus.subscribe("test.topic", received.append)
        bus.publish(Message(topic="test.topic", sender="a", payload="hello"))
        assert len(received) == 1
        assert received[0].payload == "hello"

    def test_send_creates_directed_message(self, bus: MessageBus) -> None:
        received: list[Message] = []
        bus.subscribe("direct", received.append)
        msg = bus.send("alice", "bob", "direct", {"key": "val"})
        assert msg.sender == "alice"
        assert msg.recipient == "bob"
        assert len(received) == 1

    def test_history(self, bus: MessageBus) -> None:
        bus.publish(Message(topic="h1", sender="a"))
        bus.publish(Message(topic="h2", sender="b"))
        assert len(bus.history) == 2

    def test_clear(self, bus: MessageBus) -> None:
        bus.publish(Message(topic="x", sender="a"))
        bus.clear()
        assert len(bus.history) == 0

    def test_subscriber_exception_does_not_crash(self, bus: MessageBus) -> None:
        def bad_sub(msg: Message) -> None:
            raise ValueError("boom")
        good: list[Message] = []
        bus.subscribe("err", bad_sub)
        bus.subscribe("err", good.append)
        bus.publish(Message(topic="err", sender="a"))
        assert len(good) == 1


# ---------------------------------------------------------------------------
# BaseAgent tests
# ---------------------------------------------------------------------------


class TestBaseAgent:
    def test_base_agent_cannot_be_instantiated_directly(self) -> None:
        with pytest.raises(TypeError):
            BaseAgent("x", "y")  # type: ignore[abstract]

    def test_base_agent_handles_malformed_input(self, bus: MessageBus) -> None:
        class DummyAgent(BaseAgent):
            def _run(self, events):
                return [], "ok"

        agent = DummyAgent("dummy", "test", message_bus=bus)
        result = agent.analyze("not a list")  # type: ignore[arg-type]
        assert result.success is False
        assert "expected a list" in result.error

    def test_base_agent_skips_non_security_events(self, bus: MessageBus) -> None:
        class DummyAgent(BaseAgent):
            def _run(self, events):
                return [], f"processed {len(events)}"

        agent = DummyAgent("dummy", "test", message_bus=bus)
        result = agent.analyze([SecurityEvent(), "garbage", 42])  # type: ignore[list-item]
        assert result.success is True
        assert "processed 1" in result.summary

    def test_base_agent_catches_run_exceptions(self, bus: MessageBus) -> None:
        class CrashAgent(BaseAgent):
            def _run(self, events):
                raise RuntimeError("agent crashed")

        agent = CrashAgent("crash", "test", message_bus=bus)
        result = agent.analyze([SecurityEvent()])
        assert result.success is False
        assert "agent crashed" in result.error


# ---------------------------------------------------------------------------
# Individual agent tests
# ---------------------------------------------------------------------------


class TestThreatAgent:
    def test_detects_suspicious_process(self, bus: MessageBus) -> None:
        agent = ThreatAgent(message_bus=bus)
        evt = SecurityEvent(
            process_name="mimikatz.exe", process_pid=1234, host="h1",
        )
        result = agent.analyze([evt])
        assert result.success
        assert any("mimikatz" in f.title.lower() for f in result.findings)

    def test_detects_suspicious_domain(self, bus: MessageBus) -> None:
        agent = ThreatAgent(message_bus=bus)
        evt = SecurityEvent(domain="malicious-c2.example", host="h1")
        result = agent.analyze([evt])
        assert any("domain" in f.title.lower() for f in result.findings)

    def test_detects_persistence(self, bus: MessageBus) -> None:
        agent = ThreatAgent(message_bus=bus)
        evt = SecurityEvent(
            description="schtasks /create /tn evil", host="h1",
        )
        result = agent.analyze([evt])
        assert any("persistence" in f.title.lower() for f in result.findings)

    def test_detects_credential_attack(self, bus: MessageBus) -> None:
        agent = ThreatAgent(message_bus=bus)
        evt = SecurityEvent(
            description="mimikatz lsass dump detected", host="h1",
        )
        result = agent.analyze([evt])
        assert any("credential" in f.title.lower() for f in result.findings)

    def test_benign_event_no_findings(self, bus: MessageBus) -> None:
        agent = ThreatAgent(message_bus=bus)
        evt = SecurityEvent(description="user logged in", host="h1")
        result = agent.analyze([evt])
        assert len(result.findings) == 0


class TestNetworkAgent:
    def test_detects_suspicious_port(self, bus: MessageBus) -> None:
        agent = NetworkAgent(message_bus=bus)
        evt = SecurityEvent(
            remote_ip="1.2.3.4", remote_port=4444, protocol="TCP", host="h1",
        )
        result = agent.analyze([evt])
        assert any("4444" in f.title for f in result.findings)

    def test_detects_known_bad_ip(self, bus: MessageBus) -> None:
        agent = NetworkAgent(message_bus=bus)
        evt = SecurityEvent(
            remote_ip="185.220.101.5", remote_port=80, host="h1",
        )
        result = agent.analyze([evt])
        assert any("known-bad" in f.title.lower() for f in result.findings)

    def test_detects_scanning(self, bus: MessageBus) -> None:
        agent = NetworkAgent(message_bus=bus)
        events = [
            SecurityEvent(host="h1", remote_ip="10.0.0.1", remote_port=p)
            for p in range(1, 15)
        ]
        result = agent.analyze(events)
        assert any("scanning" in f.title.lower() for f in result.findings)

    def test_no_network_events(self, bus: MessageBus) -> None:
        agent = NetworkAgent(message_bus=bus)
        result = agent.analyze([SecurityEvent(description="no network")])
        assert result.success
        assert len(result.findings) == 0


class TestMalwareAgent:
    def test_detects_known_bad_hash(self, bus: MessageBus) -> None:
        agent = MalwareAgent(message_bus=bus)
        evt = SecurityEvent(
            file_name="beacon.exe",
            file_hash="a665a45920422f9d417e4837ee238a8b65e6e1f6a1b3a0c9f9d6e5f4c3b2a198",
            host="h1",
        )
        result = agent.analyze([evt])
        assert any("malicious" in f.title.lower() for f in result.findings)

    def test_detects_double_extension(self, bus: MessageBus) -> None:
        agent = MalwareAgent(message_bus=bus)
        evt = SecurityEvent(file_name="invoice.pdf.exe", host="h1")
        result = agent.analyze([evt])
        assert any("double-extension" in f.title.lower() for f in result.findings)

    def test_detects_suspicious_filename(self, bus: MessageBus) -> None:
        agent = MalwareAgent(message_bus=bus)
        evt = SecurityEvent(file_name="procdump.exe", host="h1")
        result = agent.analyze([evt])
        assert any("procdump" in f.title.lower() for f in result.findings)

    def test_detects_suspicious_strings(self, bus: MessageBus) -> None:
        agent = MalwareAgent(message_bus=bus)
        evt = SecurityEvent(
            file_name="loader.dll",
            description="Contains CreateRemoteThread and VirtualAllocEx",
            host="h1",
        )
        result = agent.analyze([evt])
        assert any("suspicious strings" in f.title.lower() for f in result.findings)

    def test_compute_sha256(self) -> None:
        h = MalwareAgent.compute_sha256(b"hello")
        assert len(h) == 64
        assert h == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


class TestResponseAgent:
    def test_generate_recommendations(self, bus: MessageBus) -> None:
        agent = ResponseAgent(message_bus=bus)
        assessment = SecurityAssessment()
        assessment.correlated_findings = [
            Finding(
                title="f1", description="d",
                severity=Severity.CRITICAL, confidence=Confidence.HIGH,
                category=FindingCategory.THREAT, source_agent="x",
                recommended_action="Isolate the host immediately.",
            ),
            Finding(
                title="f2", description="d",
                severity=Severity.MEDIUM, confidence=Confidence.MEDIUM,
                category=FindingCategory.NETWORK, source_agent="x",
                recommended_action="Block the IP.",
            ),
        ]
        recs = agent.generate_recommendations(assessment)
        assert len(recs) == 2
        assert recs[0].startswith("[CRITICAL]")

    def test_build_assessment(self, bus: MessageBus) -> None:
        agent = ResponseAgent(message_bus=bus)
        events = [SecurityEvent(host="h1")]
        results = [
            AgentResult(
                agent_name="ThreatAgent", agent_role="Threat",
                findings=[
                    Finding(
                        title="threat1", description="d",
                        severity=Severity.HIGH, confidence=Confidence.HIGH,
                        category=FindingCategory.THREAT, source_agent="ThreatAgent",
                        recommended_action="Investigate.",
                    ),
                ],
            ),
        ]
        assessment = agent.build_assessment(events, results)
        assert assessment.overall_severity == Severity.HIGH
        assert len(assessment.correlated_findings) == 1
        assert len(assessment.response_recommendations) >= 1
        assert "Observed Evidence" in assessment.summary
        assert "Recommended Actions" in assessment.summary


# ---------------------------------------------------------------------------
# Orchestrator tests
# ---------------------------------------------------------------------------


class TestOrchestrator:
    def test_orchestrator_initializes(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assert orch.threat_agent is not None
        assert orch.network_agent is not None
        assert orch.malware_agent is not None
        assert orch.response_agent is not None
        assert len(orch.agents) == 4

    def test_orchestrator_runs_full_pipeline(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        assert isinstance(assessment, SecurityAssessment)
        assert assessment.events_analyzed == len(demo_events)
        assert len(assessment.correlated_findings) > 0
        assert assessment.overall_severity in (
            Severity.CRITICAL, Severity.HIGH,
        )

    def test_orchestrator_handles_empty_input(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run([])
        assert assessment.events_analyzed == 0
        assert len(assessment.correlated_findings) == 0
        assert assessment.overall_severity == Severity.INFO

    def test_orchestrator_handles_malformed_input(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(["garbage", 42, {"host": "ok"}])  # type: ignore[list-item]
        # Only the valid dict should produce 1 event
        assert assessment.events_analyzed == 1

    def test_orchestrator_skips_malware_when_no_file_events(self, cfg: Config) -> None:
        orch = Orchestrator(config=cfg)
        events = [
            SecurityEvent(host="h1", remote_ip="1.2.3.4", remote_port=4444),
        ]
        assessment = orch.run(events)
        malware_result = [
            r for r in assessment.agent_results if r.agent_name == "MalwareAgent"
        ][0]
        assert "Skipped" in malware_result.summary

    def test_orchestrator_agent_results_present(self, cfg: Config, demo_events) -> None:
        orch = Orchestrator(config=cfg)
        assessment = orch.run(demo_events)
        agent_names = {r.agent_name for r in assessment.agent_results}
        assert "ThreatAgent" in agent_names
        assert "NetworkAgent" in agent_names
        assert "MalwareAgent" in agent_names
        assert "ResponseAgent" in agent_names


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
        # With a fake key and no openai package, should gracefully fail
        os.environ["OPENAI_API_KEY"] = "sk-fake-key-for-testing"
        cfg2 = load_config()
        p = create_provider(cfg2)
        # openai package is not installed in test env → should fall back
        assert isinstance(p, LocalFallback)
        os.environ.pop("OPENAI_API_KEY", None)

    def test_openai_provider_not_available_without_key(self) -> None:
        p = OpenAIProvider(api_key="", model="gpt-4o-mini")
        assert p.is_available is False


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
