"""NetDefenders CLI entry point.

Usage::

    python main.py            # interactive mode
    python main.py --demo     # run with built-in sample dataset
    python main.py --help     # show usage
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import load_config
from core.logging_config import get_logger
from core.models import SecurityAssessment, SecurityEvent
from data.sample_data import load_demo_events
from orchestrator import Orchestrator

_log = get_logger("main")


def _format_assessment(assessment: SecurityAssessment) -> str:
    """Return a human-readable rendering of the assessment."""
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("  NETDEFENDERS — SECURITY ASSESSMENT REPORT")
    lines.append("=" * 72)
    lines.append("")

    # Analyzer summary
    lines.append("ANALYZER:")
    lines.append(
        f"  SecurityAnalyzer       [OK]  "
        f"findings: {len(assessment.correlated_findings)}  "
        f"events: {assessment.events_analyzed}"
    )
    lines.append("")

    # Findings
    lines.append(f"FINDINGS ({len(assessment.correlated_findings)}):")
    for i, f in enumerate(assessment.correlated_findings, 1):
        lines.append(f"  {i}. [{f.severity.value.upper()}] {f.title}")
        lines.append(f"     Confidence: {f.confidence.value}")
        lines.append(f"     Category: {f.category.value}")
        if f.evidence:
            lines.append(f"     Evidence: {'; '.join(f.evidence[:4])}")
        if f.recommended_action:
            lines.append(f"     Action: {f.recommended_action}")
        lines.append("")

    # Indicators
    if assessment.indicators:
        lines.append(f"INDICATORS ({len(assessment.indicators)}):")
        for ind in assessment.indicators:
            mal = "MALICIOUS" if ind.malicious else "benign"
            lines.append(f"  • [{ind.type.value}] {ind.value} ({mal}) — {ind.description}")
        lines.append("")

    # Overall
    lines.append("-" * 72)
    lines.append(
        f"OVERALL SEVERITY: {assessment.overall_severity.value.upper()}"
        f"  (score: {assessment.severity_score}/10)"
    )
    lines.append(f"OVERALL CONFIDENCE: {assessment.overall_confidence.value}")
    lines.append("")

    # Recommendations
    lines.append("RECOMMENDED ACTIONS:")
    for i, rec in enumerate(assessment.response_recommendations, 1):
        lines.append(f"  {i}. {rec}")
    lines.append("")

    lines.append("=" * 72)
    lines.append(
        "Note: NetDefenders does not automatically execute any actions. "
        "All recommendations require analyst approval."
    )
    lines.append("=" * 72)
    return "\n".join(lines)


def run_demo() -> SecurityAssessment:
    """Load the sample dataset and run the full pipeline."""
    _log.info("Starting NetDefenders in DEMO mode")
    events = load_demo_events()
    _log.info("Loaded %d sample security events", len(events))

    orch = Orchestrator()
    assessment = orch.run(events)

    print(_format_assessment(assessment))
    return assessment


def run_interactive() -> None:
    """Minimal interactive prompt for ad-hoc event input."""
    print("=" * 72)
    print("  NetDefenders — Interactive Mode")
    print("=" * 72)
    print("Enter security events as JSON (one per line).")
    print("Type 'demo' to run the demo dataset, 'quit' to exit.")
    print()

    orch = Orchestrator()
    events: list[SecurityEvent] = []

    while True:
        try:
            line = input("nd> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line:
            continue
        if line.lower() in ("quit", "exit", "q"):
            break
        if line.lower() == "demo":
            events = load_demo_events()
            break
        if line.lower() == "run":
            if events:
                assessment = orch.run(events)
                print(_format_assessment(assessment))
                events = []
            else:
                print("No events loaded. Enter JSON events or type 'demo'.")
            continue

        try:
            data = json.loads(line)
            if isinstance(data, list):
                for d in data:
                    events.append(SecurityEvent(**d))
            else:
                events.append(SecurityEvent(**data))
            print(f"  Loaded. {len(events)} event(s) queued. Type 'run' to analyze.")
        except Exception as exc:  # noqa: BLE001
            print(f"  Error parsing input: {exc}")

    if events:
        assessment = orch.run(events)
        print(_format_assessment(assessment))


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.  Returns a process exit code."""
    parser = argparse.ArgumentParser(
        prog="netdefenders",
        description="NetDefenders — AI-assisted defensive cybersecurity analysis",
    )
    parser.add_argument(
        "--demo", action="store_true",
        help="Run the pipeline with built-in sample security events",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Output the assessment as JSON (use with --demo)",
    )
    args = parser.parse_args(argv)

    if args.demo:
        assessment = run_demo()
        if args.json:
            print(json.dumps(assessment.to_dict(), indent=2, default=str))
        return 0

    run_interactive()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
