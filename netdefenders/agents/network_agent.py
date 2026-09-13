"""Network Analysis Agent.

Examines network-type security events for unusual connections, suspicious
ports, scanning behaviour, and anomalous traffic patterns.  Operates only
on supplied data — it does **not** perform active scanning.
"""

from __future__ import annotations

from collections import Counter
from typing import Sequence

from core.models import (
    Confidence,
    Finding,
    FindingCategory,
    Indicator,
    IndicatorType,
    SecurityEvent,
    Severity,
)

from .base_agent import BaseAgent

# Ports often abused for C2, exfiltration, or backdoors.
_SUSPICIOUS_PORTS = {4444, 4445, 6667, 6668, 6669, 8080, 8443, 9001, 1337, 31337}

# Known-bad IPs used in the deterministic demo dataset.
_KNOWN_BAD_IPS = {
    "185.220.101.5", "45.155.205.99", "203.0.113.66", "198.51.100.23",
}

# Ports commonly used for outbound exfiltration / non-standard tunnels.
_HIGH_RISK_REMOTE_PORTS = {4444, 31337, 6667, 9001}

# Threshold for "scanning behaviour" — many distinct ports from one source.
_SCAN_PORT_THRESHOLD = 10


class NetworkAgent(BaseAgent):
    """Detects anomalous network behaviour from supplied event data."""

    def __init__(self, message_bus=None, config=None) -> None:
        super().__init__(
            name="NetworkAgent",
            role="Network Analysis",
            message_bus=message_bus,
            config=config,
        )

    def _run(
        self, events: list[SecurityEvent]
    ) -> tuple[list[Finding], str]:
        findings: list[Finding] = []

        net_events = [e for e in events if e.remote_ip]

        for evt in net_events:
            findings.extend(self._check_suspicious_port(evt))
            findings.extend(self._check_known_bad_ip(evt))
            findings.extend(self._check_unexpected_protocol(evt))

        findings.extend(self._check_scanning(net_events))
        findings.extend(self._check_repeated_connections(net_events))

        summary = (
            f"NetworkAgent analyzed {len(net_events)} network events, "
            f"produced {len(findings)} findings"
        )
        return findings, summary

    # -- individual checks -------------------------------------------------

    def _check_suspicious_port(self, evt: SecurityEvent) -> list[Finding]:
        port = evt.remote_port
        if port is None or port not in _SUSPICIOUS_PORTS:
            return []
        return [
            Finding(
                title=f"Connection to suspicious port {port}",
                description=(
                    f"Host '{evt.host}' connected to {evt.remote_ip}:{port} "
                    f"— port {port} is commonly associated with C2 or "
                    f"backdoor traffic."
                ),
                severity=Severity.HIGH,
                confidence=Confidence.MEDIUM,
                category=FindingCategory.NETWORK,
                source_agent=self.name,
                evidence=[
                    f"remote_ip={evt.remote_ip}",
                    f"remote_port={port}",
                    f"host={evt.host}",
                    f"protocol={evt.protocol}",
                ],
                indicators=[
                    Indicator(
                        type=IndicatorType.PORT,
                        value=str(port),
                        description="Suspicious destination port",
                        source=evt.source,
                        malicious=True,
                    )
                ],
                recommended_action=(
                    f"Block {evt.remote_ip} at the firewall and investigate "
                    f"the process initiating the connection on '{evt.host}'."
                ),
            )
        ]

    def _check_known_bad_ip(self, evt: SecurityEvent) -> list[Finding]:
        if evt.remote_ip not in _KNOWN_BAD_IPS:
            return []
        return [
            Finding(
                title=f"Connection to known-bad IP: {evt.remote_ip}",
                description=(
                    f"Host '{evt.host}' connected to {evt.remote_ip} which "
                    f"is listed as known malicious infrastructure."
                ),
                severity=Severity.CRITICAL,
                confidence=Confidence.HIGH,
                category=FindingCategory.IOC,
                source_agent=self.name,
                evidence=[
                    f"remote_ip={evt.remote_ip}",
                    f"host={evt.host}",
                    f"port={evt.remote_port}",
                ],
                indicators=[
                    Indicator(
                        type=IndicatorType.IP,
                        value=evt.remote_ip,
                        description="Known malicious IP",
                        source=evt.source,
                        malicious=True,
                    )
                ],
                recommended_action=(
                    f"Immediately block {evt.remote_ip}, isolate host "
                    f"'{evt.host}', and review all traffic to this destination."
                ),
            )
        ]

    def _check_unexpected_protocol(self, evt: SecurityEvent) -> list[Finding]:
        port = evt.remote_port
        if port is None or port not in _HIGH_RISK_REMOTE_PORTS:
            return []
        proto = (evt.protocol or "").upper()
        if proto and proto not in ("TCP", "UDP"):
            return []
        return [
            Finding(
                title=f"High-risk outbound connection to port {port}",
                description=(
                    f"Host '{evt.host}' made an outbound connection to "
                    f"{evt.remote_ip}:{port} over {proto}. This port is "
                    f"rarely used for legitimate traffic."
                ),
                severity=Severity.MEDIUM,
                confidence=Confidence.LOW,
                category=FindingCategory.ANOMALY,
                source_agent=self.name,
                evidence=[
                    f"remote_ip={evt.remote_ip}",
                    f"remote_port={port}",
                    f"protocol={proto}",
                ],
                recommended_action=(
                    "Verify the business need for this connection. If none, "
                    "block and investigate the initiating process."
                ),
            )
        ]

    def _check_scanning(self, events: list[SecurityEvent]) -> list[Finding]:
        """Detect port-scan behaviour — one host hitting many distinct ports."""
        by_host: dict[str, set[int]] = {}
        for e in events:
            if e.remote_port is not None:
                by_host.setdefault(e.host, set()).add(e.remote_port)

        results: list[Finding] = []
        for host, ports in by_host.items():
            if len(ports) >= _SCAN_PORT_THRESHOLD:
                results.append(
                    Finding(
                        title=f"Port scanning behaviour on {host}",
                        description=(
                            f"Host '{host}' connected to {len(ports)} distinct "
                            f"remote ports, indicating possible port scanning."
                        ),
                        severity=Severity.MEDIUM,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.NETWORK,
                        source_agent=self.name,
                        evidence=[
                            f"host={host}",
                            f"distinct_ports={len(ports)}",
                            f"sample_ports={sorted(ports)[:15]}",
                        ],
                        recommended_action=(
                            "Investigate the process performing the scan, "
                            "check if it is an authorised security tool, "
                            "and block if not."
                        ),
                    )
                )
        return results

    def _check_repeated_connections(
        self, events: list[SecurityEvent]
    ) -> list[Finding]:
        """Flag repeated connections to the same destination (>20 times)."""
        counts: Counter[tuple[str, str, int]] = Counter()
        for e in events:
            if e.remote_ip and e.remote_port is not None:
                key = (e.host, e.remote_ip, e.remote_port)
                counts[key] += 1

        results: list[Finding] = []
        for (host, ip, port), count in counts.items():
            if count > 20:
                results.append(
                    Finding(
                        title=f"Repeated connections: {host} → {ip}:{port} ({count}x)",
                        description=(
                            f"Host '{host}' made {count} connections to "
                            f"{ip}:{port}, which may indicate a beacon or "
                            f"persistent C2 channel."
                        ),
                        severity=Severity.MEDIUM,
                        confidence=Confidence.LOW,
                        category=FindingCategory.ANOMALY,
                        source_agent=self.name,
                        evidence=[
                            f"host={host}",
                            f"remote_ip={ip}",
                            f"remote_port={port}",
                            f"count={count}",
                        ],
                        recommended_action=(
                            "Analyse connection timing for beacon patterns, "
                            "block the destination if C2 is confirmed, and "
                            "increase monitoring on the host."
                        ),
                    )
                )
        return results
