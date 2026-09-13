"""Response Recommendation Agent.

Takes the findings produced by the other agents and generates prioritised
defensive recommendations.  It clearly separates observed evidence,
suspected threats, and recommended actions, and it **never** executes
destructive actions automatically.
"""

from __future__ import annotations

from typing import Any

from core.models import (
    AgentResult,
    Confidence,
    Finding,
    FindingCategory,
    Indicator,
    SecurityAssessment,
    SecurityEvent,
    Severity,
)

from .base_agent import BaseAgent


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


class ResponseAgent(BaseAgent):
    """Generates defensive recommendations from correlated findings."""

    def __init__(self, message_bus=None, config=None) -> None:
        super().__init__(
            name="ResponseAgent",
            role="Response Recommendations",
            message_bus=message_bus,
            config=config,
        )

    def _run(
        self, events: list[SecurityEvent]
    ) -> tuple[list[Finding], str]:
        """Standard entry point — not used by the orchestrator.

        The orchestrator calls :meth:`generate_recommendations` directly
        with agent results, but :meth:`_run` is implemented so the agent
        can also be invoked standalone (e.g. in tests) using raw events.
        """
        # When called standalone with only events, produce a simple
        # recommendation finding per event.
        findings: list[Finding] = []
        for evt in events:
            findings.append(
                Finding(
                    title=f"Review event: {evt.description[:60]}",
                    description=(
                        f"Event from {evt.source} on {evt.host} should be "
                        f"reviewed by a security analyst."
                    ),
                    severity=Severity.LOW,
                    confidence=Confidence.LOW,
                    category=FindingCategory.RECOMMENDATION,
                    source_agent=self.name,
                    evidence=[f"event_id={evt.id}", f"host={evt.host}"],
                    recommended_action="Review the event and escalate if needed.",
                )
            )
        summary = f"ResponseAgent produced {len(findings)} standalone recommendations"
        return findings, summary

    # -- primary method used by orchestrator -------------------------------

    def generate_recommendations(
        self, assessment: SecurityAssessment
    ) -> list[str]:
        """Build a prioritised, de-duplicated list of recommendations.

        Recommendations are ordered by severity (highest first).  Each
        entry is prefixed with a severity tag so the final report clearly
        communicates urgency.
        """
        recs: list[tuple[int, str]] = []

        for finding in assessment.correlated_findings:
            action = finding.recommended_action
            if not action:
                action = _DEFAULT_RECOMMENDATIONS.get(
                    finding.category,
                    "Review and determine appropriate action.",
                )
            tag = finding.severity.value.upper()
            rec_text = f"[{tag}] {action}"
            recs.append((finding.severity.numeric, rec_text))

        # Sort by severity descending, then deduplicate preserving order.
        recs.sort(key=lambda x: x[0], reverse=True)
        seen: set[str] = set()
        ordered: list[str] = []
        for _, text in recs:
            if text not in seen:
                seen.add(text)
                ordered.append(text)

        return ordered

    def build_assessment(
        self,
        events: list[SecurityEvent],
        agent_results: list[AgentResult],
    ) -> SecurityAssessment:
        """Consolidate agent results into a final :class:`SecurityAssessment`.

        This is the primary public method called by the orchestrator.  It
        correlates findings, computes overall severity/confidence, and
        generates response recommendations.
        """
        # Gather all findings.
        all_findings: list[Finding] = []
        for result in agent_results:
            all_findings.extend(result.findings)

        # Deduplicate findings by title (different agents may flag the
        # same event).
        seen_titles: set[str] = set()
        correlated: list[Finding] = []
        for f in all_findings:
            if f.title not in seen_titles:
                seen_titles.add(f.title)
                correlated.append(f)

        # Collect all indicators.
        all_indicators: list[Indicator] = []
        for f in correlated:
            all_indicators.extend(f.indicators)

        # Compute overall severity.
        if correlated:
            max_score = max(f.severity_score for f in correlated)
            overall_sev = Severity.from_score(max_score)
            avg_conf = sum(
                f.confidence.value == "high" and 0.9
                or f.confidence.value == "medium" and 0.55
                or 0.3
                for f in correlated
            ) / len(correlated)
            overall_conf = Confidence.from_score(avg_conf)
        else:
            overall_sev = Severity.INFO
            overall_conf = Confidence.LOW
            max_score = 0.0

        assessment = SecurityAssessment(
            events_analyzed=len(events),
            agent_results=agent_results,
            correlated_findings=correlated,
            indicators=all_indicators,
            overall_severity=overall_sev,
            overall_confidence=overall_conf,
            severity_score=round(max_score, 2),
        )

        assessment.response_recommendations = self.generate_recommendations(assessment)
        assessment.summary = self._build_summary(assessment)
        return assessment

    def _build_summary(self, assessment: SecurityAssessment) -> str:
        """Produce a human-readable assessment summary."""
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
                f"(source: {f.source_agent}, confidence: {f.confidence.value})"
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
