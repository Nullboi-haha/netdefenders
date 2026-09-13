"""Sample security events for demo mode and testing.

All data is synthetic and safe — no real IOCs or private information.
"""

from __future__ import annotations

from core.models import EventCategory, SecurityEvent


def load_demo_events() -> list[SecurityEvent]:
    """Return a list of synthetic security events for the demo pipeline."""
    return [
        # --- Threat: suspicious process (mimikatz) ---
        SecurityEvent(
            id="evt-001",
            category=EventCategory.PROCESS,
            source="edr",
            description="Credential dumping tool detected",
            host="WORKSTATION-01",
            user="jsmith",
            process_name="mimikatz.exe",
            process_pid=4521,
        ),

        # --- Threat: persistence via scheduled task ---
        SecurityEvent(
            id="evt-002",
            category=EventCategory.SYSTEM,
            source="sysmon",
            description="schtasks /create /tn UpdateTask /tr powershell -enc",
            host="WORKSTATION-01",
            user="SYSTEM",
            process_name="schtasks.exe",
            process_pid=3100,
        ),

        # --- Network: connection to known-bad IP on suspicious port ---
        SecurityEvent(
            id="evt-003",
            category=EventCategory.NETWORK,
            source="firewall",
            description="Outbound connection to suspicious server",
            host="WORKSTATION-01",
            remote_ip="185.220.101.5",
            remote_port=4444,
            protocol="TCP",
        ),

        # --- Network: connection to suspicious domain ---
        SecurityEvent(
            id="evt-004",
            category=EventCategory.NETWORK,
            source="dns",
            description="DNS query for known malicious domain",
            host="WORKSTATION-01",
            domain="malicious-c2.example",
            remote_ip="45.155.205.99",
        ),

        # --- Malware: known-bad hash ---
        SecurityEvent(
            id="evt-005",
            category=EventCategory.FILE,
            source="file-scanner",
            description="File written to disk with known-malicious hash",
            host="WORKSTATION-01",
            file_name="beacon.exe",
            file_hash="a665a45920422f9d417e4837ee238a8b65e6e1f6a1b3a0c9f9d6e5f4c3b2a198",
            file_size=245760,
        ),

        # --- Malware: double extension ---
        SecurityEvent(
            id="evt-006",
            category=EventCategory.FILE,
            source="email-gateway",
            description="Email attachment with double extension detected",
            host="WORKSTATION-02",
            file_name="invoice.pdf.exe",
            file_hash="5d41402abc4b2a76b9719d911017c592cf29e8d3f9f4a1b2c3d4e5f6a7b8c9d0",
            file_size=86016,
        ),

        # --- Network: scanning behaviour ---
        SecurityEvent(
            id="evt-007",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan detected",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=22,
            protocol="TCP",
        ),
        # Additional scan events to trigger the threshold (>10 distinct ports)
        SecurityEvent(
            id="evt-008",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=23,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-009",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=25,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-010",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=53,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-011",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=80,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-012",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=110,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-013",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=143,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-014",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=443,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-015",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=445,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-016",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=3306,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-017",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=3389,
            protocol="TCP",
        ),
        SecurityEvent(
            id="evt-018",
            category=EventCategory.NETWORK,
            source="ids",
            description="Port scan continued",
            host="SERVER-DB-01",
            remote_ip="203.0.113.66",
            remote_port=5432,
            protocol="TCP",
        ),

        # --- Threat: privilege escalation ---
        SecurityEvent(
            id="evt-019",
            category=EventCategory.SYSTEM,
            source="edr",
            description="Potential PrintSpoofer privilege escalation detected",
            host="WORKSTATION-02",
            user="ltorvalds",
            process_name="PrintSpoofer.exe",
            process_pid=5200,
        ),

        # --- Benign event (should produce no findings) ---
        SecurityEvent(
            id="evt-020",
            category=EventCategory.AUTH,
            source="auth-log",
            description="User logged in successfully",
            host="WORKSTATION-02",
            user="ltorvalds",
        ),
    ]
