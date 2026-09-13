"""Threat Analysis Agent.

Inspects normalised security events for indicators of malicious behaviour
such as suspicious processes, credential attacks, persistence, and
privilege escalation.  Uses deterministic pattern matching so it works
without an external API.
"""

from __future__ import annotations

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

# ---------------------------------------------------------------------------
# Detection rule definitions
# ---------------------------------------------------------------------------

# Process names commonly associated with living-off-the-land attacks or
# post-exploitation frameworks.
_SUSPICIOUS_PROCESSES = {
    "mimikatz", "procdump", "powersploit", "cobaltstrike", "beacon",
    "metsrv", "sharpershark", "seatbelt", "rubeus", "impacket",
    "hydra", "john", "hashcat", "nc.exe", "ncat.exe", "pwdump",
    "fgdump", "wce.exe", "laZagne.exe",
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


class ThreatAgent(BaseAgent):
    """Identifies potentially malicious behaviour in security events."""

    def __init__(self, message_bus=None, config=None) -> None:
        super().__init__(
            name="ThreatAgent",
            role="Threat Analysis",
            message_bus=message_bus,
            config=config,
        )

    def _run(
        self, events: list[SecurityEvent]
    ) -> tuple[list[Finding], str]:
        findings: list[Finding] = []

        for evt in events:
            findings.extend(self._check_process(evt))
            findings.extend(self._check_domain(evt))
            findings.extend(self._check_description_patterns(evt))
            findings.extend(self._check_commands(evt))

        summary = (
            f"ThreatAgent analyzed {len(events)} events, "
            f"produced {len(findings)} findings"
        )
        return findings, summary

    # -- individual checks -------------------------------------------------

    def _check_process(self, evt: SecurityEvent) -> list[Finding]:
        proc = (evt.process_name or "").lower()
        if not proc:
            return []
        # Match by base name (strip .exe / .dll) and also substring match
        # so "mimikatz.exe" matches "mimikatz" in the suspicious set.
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
                    source_agent=self.name,
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
                        source_agent=self.name,
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
                        source_agent=self.name,
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
                        source_agent=self.name,
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
                        source_agent=self.name,
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
                        source_agent=self.name,
                        evidence=[f"description={evt.description}", f"pattern={cmd}"],
                        recommended_action=(
                            "Review the full command line and parent process, "
                            "check if the action was authorised, and collect "
                            "PowerShell/script logs if available."
                        ),
                    )
                )
        return results
