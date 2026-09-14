"""Single central security analyzer for NetDefenders.

A single unified analyzer that examines all categories of defensive
security data.  When an AI
provider is configured, the analyzer can use it for enhanced reasoning;
otherwise it falls back to deterministic local pattern matching.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from typing import Any

from ai_provider import AIProvider
from core.logging_config import get_logger
from core.models import (
    Confidence,
    Finding,
    FindingCategory,
    Indicator,
    IndicatorType,
    SecurityAssessment,
    SecurityEvent,
    Severity,
)

_log = get_logger("analyzer")

ANALYZER_NAME = "SecurityAnalyzer"

# ---------------------------------------------------------------------------
# Detection rule definitions
# ---------------------------------------------------------------------------

# Process names commonly associated with living-off-the-land attacks or
# post-exploitation frameworks.
_SUSPICIOUS_PROCESSES = {
    "mimikatz", "procdump", "powersploit", "cobaltstrike", "beacon",
    "metsrv", "sharpershark", "seatbelt", "rubeus", "impacket",
    "hydra", "john", "hashcat", "nc.exe", "ncat.exe", "pwdump",
    "fgdump", "wce.exe", "lazagne.exe",
}

# Domains / domain fragments that are well-known malicious infrastructure.
_SUSPICIOUS_DOMAINS = {
    "malicious-c2.example", "evil-c2.net", "bad-domain.tk",
    "commandandcontrol.xyz", "exfiltration-site.info",
}

# Attack-pattern keywords found in event descriptions.
_PERSISTENCE_KEYWORDS = [
    "schtasks /create", "autorun", "registry run key", "startup folder",
    "winlogon shell", "wmi subscription", "scheduled task",
]
_PRIV_ESC_KEYWORDS = [
    "bypassuac", "juicypotato", "roguepotato", "printspoofer",
    "token impersonation", "seimpersonate", "getsystem",
]
_CRED_ATTACK_KEYWORDS = [
    "mimikatz", "lsass dump", "credential dumping", "kerberoasting",
    "brute force", "password spray", "pass the hash", "ntds.dit",
]

# Suspicious commands / patterns
_SUSPICIOUS_COMMANDS = [
    "powershell -enc", "powershell -e ", "powershell hidden",
    "cmd /c ", "base64 -d", "curl http://", "wget http://",
    "net user /add", "net localgroup administrators",
]

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

# File extensions commonly associated with malware droppers/payloads.
_SUSPICIOUS_EXTENSIONS = {
    ".exe", ".dll", ".scr", ".pif", ".bat", ".cmd", ".vbs", ".ps1",
    ".hta", ".jar", ".lnk",
}

# Filenames that appear in known attack toolkits.
_SUSPICIOUS_FILENAMES = {
    "mimikatz.exe", "procdump.exe", "cobaltstrike.exe", "beacon.exe",
    "sharpershark.exe", "payload.exe", "dropper.exe", "loader.dll",
    "nc.exe", "psexec.exe", "winrar.exe",
}

# Known-bad SHA-256 hashes (synthetic — don't correspond to real malware).
_KNOWN_BAD_HASHES = {
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "a665a45920422f9d417e4837ee238a8b65e6e1f6a1b3a0c9f9d6e5f4c3b2a198",
    "5d41402abc4b2a76b9719d911017c592cf29e8d3f9f4a1b2c3d4e5f6a7b8c9d0",
}

# Strings that, if present in a file description, suggest malicious intent.
_SUSPICIOUS_STRINGS = [
    "cmd.exe /c", "powershell -enc", "base64", "invokedll", "rundll32",
    "regsvr32 /u", "certutil -decode", "bitsadmin /transfer",
    "CreateRemoteThread", "VirtualAllocEx", "WriteProcessMemory",
]

# Map category → default recommendation when a finding lacks one.
_DEFAULT_RECOMMENDATIONS: dict[FindingCategory, str] = {
    FindingCategory.THREAT: "Investigate the affected host and collect additional logs.",
    FindingCategory.NETWORK: "Block the suspicious destination and monitor for further connections.",
    FindingCategory.MALWARE: "Quarantine the file and submit to a malware sandbox for deeper analysis.",
    FindingCategory.IOC: "Add the indicator to blocklists and search the environment for matches.",
    FindingCategory.PERSISTENCE: "Remove the persistence mechanism and audit for follow-on activity.",
    FindingCategory.PRIVILEGE_ESCALATION: "Review admin group membership and rotate potentially exposed credentials.",
    FindingCategory.CREDENTIAL_ATTACK: "Rotate all affected credentials and force password resets.",
    FindingCategory.ANOMALY: "Investigate the anomaly and increase monitoring on the affected host.",
    FindingCategory.RECOMMENDATION: "Review and apply the recommendation as appropriate.",
    FindingCategory.OTHER: "Review the finding and determine appropriate action.",
}


class SecurityAnalyzer:
    """Single central AI analyzer for all defensive security data.

    Receives normalized security events, analyzes them across all
    categories (processes, network, malware, auth, persistence, etc.),
    and produces a final security assessment with correlated findings,
    severity scoring, and prioritized defensive recommendations.

    When an AI provider is configured, it is used for enhanced reasoning.
    When no API key is available, deterministic local pattern matching
    is used so the system remains fully functional.
    """

    def __init__(
        self,
        ai_provider: AIProvider | None = None,
        config: Any = None,
    ) -> None:
        self.ai_provider = ai_provider
        self.config = config
        self.name = ANALYZER_NAME

    # -- public API --------------------------------------------------------

    def analyze(self, events: list[SecurityEvent]) -> SecurityAssessment:
        """Run the complete analysis pipeline on *events*.

        1. Detect findings across all security categories.
        2. Correlate and deduplicate findings.
        3. Compute overall severity and confidence.
        4. Generate prioritized defensive recommendations.
        5. Produce a final security assessment.
        """
        _log.info("SecurityAnalyzer starting analysis of %d events", len(events))

        findings = self._detect_all(events)
        _log.info("Detection complete: %d raw findings", len(findings))

        correlated = self._correlate(findings)
        _log.info("Correlation complete: %d unique findings", len(correlated))

        indicators = self._collect_indicators(correlated)
        overall_sev, overall_conf, score = self._compute_severity(correlated)
        recommendations = self._generate_recommendations(correlated)

        assessment = SecurityAssessment(
            events_analyzed=len(events),
            correlated_findings=correlated,
            indicators=indicators,
            overall_severity=overall_sev,
            overall_confidence=overall_conf,
            severity_score=round(score, 2),
            response_recommendations=recommendations,
        )
        assessment.summary = self._build_summary(assessment)

        _log.info(
            "Analysis complete: severity=%s, findings=%d, recommendations=%d",
            assessment.overall_severity.value,
            len(assessment.correlated_findings),
            len(assessment.response_recommendations),
        )
        return assessment

    # -- detection (all categories in one pass) ----------------------------

    def _detect_all(self, events: list[SecurityEvent]) -> list[Finding]:
        """Run every detection check across all event categories."""
        findings: list[Finding] = []

        for evt in events:
            findings.extend(self._check_process(evt))
            findings.extend(self._check_domain(evt))
            findings.extend(self._check_description_patterns(evt))
            findings.extend(self._check_commands(evt))
            findings.extend(self._check_suspicious_port(evt))
            findings.extend(self._check_known_bad_ip(evt))
            findings.extend(self._check_high_risk_port(evt))
            findings.extend(self._check_file_hash(evt))
            findings.extend(self._check_filename(evt))
            findings.extend(self._check_double_extension(evt))
            findings.extend(self._check_suspicious_strings(evt))

        # Aggregate checks (scanning, repeated connections)
        net_events = [e for e in events if e.remote_ip]
        findings.extend(self._check_scanning(net_events))
        findings.extend(self._check_repeated_connections(net_events))

        # Optionally enhance with AI
        if self.ai_provider and self.ai_provider.is_available:
            enhanced = self._ai_enhance(events, findings)
            if enhanced:
                findings.extend(enhanced)

        return findings

    def _ai_enhance(
        self, events: list[SecurityEvent], existing: list[Finding]
    ) -> list[Finding]:
        """Use the AI provider to look for patterns the rules missed."""
        try:
            prompt = self._build_ai_prompt(events, existing)
            response = self.ai_provider.analyze(prompt, {
                "event_count": len(events),
                "existing_findings": len(existing),
            })
            _log.info("AI provider '%s' returned enhanced analysis", self.ai_provider.name)
            # The AI response is free-form text — we log it but don't
            # parse it into structured findings to avoid false positives
            # from unvalidated LLM output.
            return []
        except Exception as exc:  # noqa: BLE001
            _log.warning("AI enhancement failed: %s — continuing with local findings", exc)
            return []

    def _build_ai_prompt(
        self, events: list[SecurityEvent], findings: list[Finding]
    ) -> str:
        """Build a prompt for the AI provider."""
        event_summaries = [
            f"  - {e.source}/{e.category.value}: {e.description[:100]}"
            for e in events[:20]
        ]
        finding_summaries = [
            f"  - [{f.severity.value}] {f.title}" for f in findings[:10]
        ]
        return (
            "Analyze the following security events for suspicious behavior. "
            "Identify any threats the existing findings may have missed.\n\n"
            f"Events ({len(events)} total, showing first 20):\n"
            + "\n".join(event_summaries)
            + f"\n\nExisting findings ({len(findings)} total, showing first 10):\n"
            + "\n".join(finding_summaries)
        )

    # -- individual detection checks ---------------------------------------

    def _check_process(self, evt: SecurityEvent) -> list[Finding]:
        proc = (evt.process_name or "").lower()
        if not proc:
            return []
        base = proc.rsplit(".", 1)[0] if "." in proc else proc
        matched = proc in _SUSPICIOUS_PROCESSES or base in _SUSPICIOUS_PROCESSES
        if not matched:
            for bad in _SUSPICIOUS_PROCESSES:
                if bad in proc:
                    matched = True
                    break
        if matched:
            return [
                Finding(
                    title=f"Suspicious process detected: {evt.process_name}",
                    description=(
                        f"Process '{evt.process_name}' (PID {evt.process_pid}) "
                        f"on host '{evt.host}' matches a known attack tool "
                        f"or post-exploitation framework."
                    ),
                    severity=Severity.HIGH,
                    confidence=Confidence.HIGH,
                    category=FindingCategory.THREAT,
                    source=self.name,
                    evidence=[
                        f"process_name={evt.process_name}",
                        f"pid={evt.process_pid}",
                        f"host={evt.host}",
                    ],
                    indicators=[
                        Indicator(
                            type=IndicatorType.PROCESS,
                            value=evt.process_name,
                            description="Known attack tool",
                            source=evt.source,
                            malicious=True,
                        )
                    ],
                    recommended_action=(
                        f"Isolate host '{evt.host}', terminate PID "
                        f"{evt.process_pid}, and capture a memory image "
                        f"for forensic analysis."
                    ),
                )
            ]
        return []

    def _check_domain(self, evt: SecurityEvent) -> list[Finding]:
        domain = (evt.domain or "").lower()
        if not domain:
            return []
        for bad in _SUSPICIOUS_DOMAINS:
            if bad in domain:
                return [
                    Finding(
                        title=f"Suspicious domain: {evt.domain}",
                        description=(
                            f"Host '{evt.host}' communicated with '{evt.domain}' "
                            f"which matches known malicious infrastructure."
                        ),
                        severity=Severity.HIGH,
                        confidence=Confidence.HIGH,
                        category=FindingCategory.IOC,
                        source=self.name,
                        evidence=[
                            f"domain={evt.domain}",
                            f"host={evt.host}",
                            f"remote_ip={evt.remote_ip}",
                        ],
                        indicators=[
                            Indicator(
                                type=IndicatorType.DOMAIN,
                                value=evt.domain,
                                description="Known malicious domain",
                                source=evt.source,
                                malicious=True,
                            )
                        ],
                        recommended_action=(
                            f"Block domain '{evt.domain}' at the firewall/DNS "
                            f"resolver and investigate host '{evt.host}'."
                        ),
                    )
                ]
        return []

    def _check_description_patterns(self, evt: SecurityEvent) -> list[Finding]:
        desc = (evt.description or "").lower()
        results: list[Finding] = []
        if not desc:
            return results

        for kw in _PERSISTENCE_KEYWORDS:
            if kw in desc:
                results.append(
                    Finding(
                        title=f"Persistence mechanism: {evt.description[:80]}",
                        description=(
                            f"Event on host '{evt.host}' indicates a "
                            f"persistence technique: '{kw}'."
                        ),
                        severity=Severity.MEDIUM,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.PERSISTENCE,
                        source=self.name,
                        evidence=[f"description={evt.description}", f"keyword={kw}"],
                        recommended_action=(
                            "Review the scheduled task / registry entry, "
                            "remove if unauthorised, and audit for follow-on activity."
                        ),
                    )
                )

        for kw in _PRIV_ESC_KEYWORDS:
            if kw in desc:
                results.append(
                    Finding(
                        title=f"Privilege escalation indicator: {kw}",
                        description=(
                            f"Event on host '{evt.host}' shows privilege "
                            f"escalation activity: '{kw}'."
                        ),
                        severity=Severity.HIGH,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.PRIVILEGE_ESCALATION,
                        source=self.name,
                        evidence=[f"description={evt.description}", f"keyword={kw}"],
                        recommended_action=(
                            "Review local admin group membership on the host, "
                            "check for new accounts, and rotate credentials "
                            "that may have been exposed."
                        ),
                    )
                )

        for kw in _CRED_ATTACK_KEYWORDS:
            if kw in desc:
                results.append(
                    Finding(
                        title=f"Credential attack indicator: {kw}",
                        description=(
                            f"Event on host '{evt.host}' shows credential "
                            f"attack activity: '{kw}'."
                        ),
                        severity=Severity.CRITICAL,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.CREDENTIAL_ATTACK,
                        source=self.name,
                        evidence=[f"description={evt.description}", f"keyword={kw}"],
                        recommended_action=(
                            "Rotate all credentials for affected accounts, "
                            "force password resets, and review authentication logs."
                        ),
                    )
                )

        return results

    def _check_commands(self, evt: SecurityEvent) -> list[Finding]:
        desc = (evt.description or "").lower()
        if not desc:
            return []
        results: list[Finding] = []
        for cmd in _SUSPICIOUS_COMMANDS:
            if cmd in desc:
                results.append(
                    Finding(
                        title=f"Suspicious command execution: {cmd}",
                        description=(
                            f"Host '{evt.host}' executed a suspicious command "
                            f"pattern: '{cmd}'."
                        ),
                        severity=Severity.MEDIUM,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.THREAT,
                        source=self.name,
                        evidence=[f"description={evt.description}", f"pattern={cmd}"],
                        recommended_action=(
                            "Review the full command line and parent process, "
                            "check if the action was authorised, and collect "
                            "PowerShell/script logs if available."
                        ),
                    )
                )
        return results

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
                source=self.name,
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
                source=self.name,
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

    def _check_high_risk_port(self, evt: SecurityEvent) -> list[Finding]:
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
                source=self.name,
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
                        source=self.name,
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
                        source=self.name,
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

    def _check_file_hash(self, evt: SecurityEvent) -> list[Finding]:
        h = (evt.file_hash or "").lower().strip()
        if not h or h not in _KNOWN_BAD_HASHES:
            return []
        return [
            Finding(
                title=f"Known-malicious file hash: {h[:16]}…",
                description=(
                    f"File '{evt.file_name}' on host '{evt.host}' has a "
                    f"hash that matches a known-malicious indicator."
                ),
                severity=Severity.CRITICAL,
                confidence=Confidence.HIGH,
                category=FindingCategory.MALWARE,
                source=self.name,
                evidence=[f"file_name={evt.file_name}", f"sha256={h}", f"host={evt.host}"],
                indicators=[
                    Indicator(
                        type=IndicatorType.HASH,
                        value=h,
                        description="Known-malicious file hash",
                        source=evt.source,
                        malicious=True,
                    )
                ],
                recommended_action=(
                    f"Quarantine '{evt.file_name}' on '{evt.host}', "
                    f"remove from all systems, and search for the hash "
                    f"across the environment."
                ),
            )
        ]

    def _check_filename(self, evt: SecurityEvent) -> list[Finding]:
        fname = (evt.file_name or "").lower()
        if not fname:
            return []
        for bad_name in _SUSPICIOUS_FILENAMES:
            if bad_name in fname:
                return [
                    Finding(
                        title=f"Suspicious filename: {evt.file_name}",
                        description=(
                            f"File '{evt.file_name}' on host '{evt.host}' "
                            f"matches a known attack-tool filename."
                        ),
                        severity=Severity.HIGH,
                        confidence=Confidence.MEDIUM,
                        category=FindingCategory.MALWARE,
                        source=self.name,
                        evidence=[
                            f"file_name={evt.file_name}",
                            f"matched_pattern={bad_name}",
                            f"host={evt.host}",
                        ],
                        indicators=[
                            Indicator(
                                type=IndicatorType.FILE,
                                value=evt.file_name,
                                description="Suspicious filename",
                                source=evt.source,
                                malicious=True,
                            )
                        ],
                        recommended_action=(
                            f"Quarantine '{evt.file_name}', collect its hash, "
                            f"and verify whether the file was authorised."
                        ),
                    )
                ]
        return []

    def _check_double_extension(self, evt: SecurityEvent) -> list[Finding]:
        fname = (evt.file_name or "").lower()
        if not fname:
            return []
        parts = fname.rsplit(".", 2)
        if len(parts) >= 3 and parts[-2] in ("pdf", "doc", "xls", "txt", "jpg") \
                and f".{parts[-1]}" in _SUSPICIOUS_EXTENSIONS:
            return [
                Finding(
                    title=f"Double-extension file: {evt.file_name}",
                    description=(
                        f"File '{evt.file_name}' on host '{evt.host}' uses a "
                        f"double-extension trick to disguise an executable."
                    ),
                    severity=Severity.HIGH,
                    confidence=Confidence.HIGH,
                    category=FindingCategory.MALWARE,
                    source=self.name,
                    evidence=[f"file_name={evt.file_name}", f"host={evt.host}"],
                    recommended_action=(
                        f"Quarantine '{evt.file_name}', alert the user who "
                        f"received it, and check email gateway logs."
                    ),
                )
            ]
        return []

    def _check_suspicious_strings(self, evt: SecurityEvent) -> list[Finding]:
        desc = (evt.description or "").lower()
        if not desc:
            return []
        hits: list[str] = []
        for s in _SUSPICIOUS_STRINGS:
            if s.lower() in desc:
                hits.append(s)
        if not hits:
            return []
        return [
            Finding(
                title=f"Suspicious strings in file event: {evt.file_name}",
                description=(
                    f"File '{evt.file_name}' on host '{evt.host}' contains "
                    f"indicators commonly seen in malware: {', '.join(hits)}."
                ),
                severity=Severity.MEDIUM,
                confidence=Confidence.MEDIUM,
                category=FindingCategory.MALWARE,
                source=self.name,
                evidence=[f"file_name={evt.file_name}", f"strings={hits}", f"host={evt.host}"],
                recommended_action=(
                    "Submit the file to your malware analysis sandbox (do "
                    "NOT execute directly), collect its hash, and check "
                    "threat-intel feeds."
                ),
            )
        ]

    # -- correlation & assessment ------------------------------------------

    def _correlate(self, findings: list[Finding]) -> list[Finding]:
        """Deduplicate findings by title."""
        seen: set[str] = set()
        correlated: list[Finding] = []
        for f in findings:
            if f.title not in seen:
                seen.add(f.title)
                correlated.append(f)
        return correlated

    def _collect_indicators(self, findings: list[Finding]) -> list[Indicator]:
        indicators: list[Indicator] = []
        for f in findings:
            indicators.extend(f.indicators)
        return indicators

    def _compute_severity(
        self, findings: list[Finding]
    ) -> tuple[Severity, Confidence, float]:
        if not findings:
            return Severity.INFO, Confidence.LOW, 0.0
        max_score = max(f.severity_score for f in findings)
        overall_sev = Severity.from_score(max_score)
        conf_scores = {
            Confidence.HIGH: 0.9,
            Confidence.MEDIUM: 0.55,
            Confidence.LOW: 0.3,
        }
        avg_conf = sum(conf_scores[f.confidence] for f in findings) / len(findings)
        overall_conf = Confidence.from_score(avg_conf)
        return overall_sev, overall_conf, max_score

    def _generate_recommendations(self, findings: list[Finding]) -> list[str]:
        recs: list[tuple[int, str]] = []
        for finding in findings:
            action = finding.recommended_action
            if not action:
                action = _DEFAULT_RECOMMENDATIONS.get(
                    finding.category, "Review and determine appropriate action."
                )
            tag = finding.severity.value.upper()
            recs.append((finding.severity.numeric, f"[{tag}] {action}"))
        recs.sort(key=lambda x: x[0], reverse=True)
        seen: set[str] = set()
        ordered: list[str] = []
        for _, text in recs:
            if text not in seen:
                seen.add(text)
                ordered.append(text)
        return ordered

    def _build_summary(self, assessment: SecurityAssessment) -> str:
        parts: list[str] = []
        parts.append(
            f"NetDefenders Security Assessment — {assessment.timestamp.isoformat()}"
        )
        parts.append(
            f"Events analyzed: {assessment.events_analyzed} | "
            f"Findings: {len(assessment.correlated_findings)} | "
            f"Indicators: {len(assessment.indicators)}"
        )
        parts.append(
            f"Overall severity: {assessment.overall_severity.value.upper()} "
            f"(score: {assessment.severity_score}/10) | "
            f"Confidence: {assessment.overall_confidence.value}"
        )

        parts.append("\n--- Observed Evidence ---")
        for f in assessment.correlated_findings:
            parts.append(
                f"  [{f.severity.value.upper()}] {f.title} "
                f"(confidence: {f.confidence.value})"
            )
            if f.evidence:
                parts.append(f"    Evidence: {', '.join(f.evidence[:3])}")

        parts.append("\n--- Suspected Threats ---")
        threats = [f for f in assessment.correlated_findings if f.severity.numeric >= 3]
        if threats:
            for f in threats:
                parts.append(f"  - {f.title}: {f.description[:120]}")
        else:
            parts.append("  No high-severity threats identified.")

        parts.append("\n--- Recommended Actions ---")
        for i, rec in enumerate(assessment.response_recommendations, 1):
            parts.append(f"  {i}. {rec}")

        parts.append(
            "\nNote: NetDefenders does not automatically execute actions. "
            "All recommendations require analyst approval."
        )
        return "\n".join(parts)

    # -- static helper -----------------------------------------------------

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        """Compute a SHA-256 hex digest — useful for safe IOC generation."""
        return hashlib.sha256(data).hexdigest()
