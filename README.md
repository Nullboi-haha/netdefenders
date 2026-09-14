# NetDefenders

AI-assisted defensive cybersecurity analysis system with a single central AI analyzer.

## What NetDefenders Is

NetDefenders is a local security-analysis tool that examines security events and produces a structured threat assessment with recommended defensive actions. It uses **one central SecurityAnalyzer** that examines all categories of defensive security data — suspicious processes, network connections, IPs/domains, malware indicators, authentication events, privilege escalation, persistence, and attack patterns. The system works fully offline with deterministic pattern matching, and can optionally use an OpenAI model for enhanced reasoning when an API key is provided.

This is a **defensive** tool. It does not perform attacks, scan external systems, execute malware, or take destructive actions. It analyzes supplied data and recommends responses for a human analyst to approve.

## Architecture

```
INPUT (security events)
        │
        ▼
  Normalize & Validate
        │
        ▼
  SecurityAnalyzer (single central AI analyzer)
    ├── Process analysis (suspicious processes, credential attacks, persistence, privesc)
    ├── Network analysis (suspicious ports, known-bad IPs, scanning, anomalous traffic)
    ├── Malware analysis (file hashes, filenames, double extensions, suspicious strings)
    └── AI enhancement (when an API key is configured)
        │
        ▼
  Correlate & Deduplicate Findings
        │
        ▼
  Determine Overall Severity & Confidence
        │
        ▼
  Generate Prioritized Defensive Recommendations
        │
        ▼
  FINAL SECURITY ASSESSMENT
```

### Single Central Analyzer

The `SecurityAnalyzer` is the sole intelligence in the system. It receives normalized security events and analyzes them across all security categories in a single pass. There are no separate agent classes — the analyzer handles threat detection, network analysis, malware/IOC analysis, and response recommendation generation internally.

### Analysis Categories

The analyzer examines events across these categories (not separate agents):

| Category | What it detects |
|----------|----------------|
| Suspicious processes | Known attack tools (mimikatz, procdump, cobaltstrike, etc.) |
| Credential attacks | Credential dumping, kerberoasting, password spraying, pass-the-hash |
| Persistence | Scheduled tasks, registry run keys, startup folders, WMI subscriptions |
| Privilege escalation | PrintSpoofer, JuicyPotato, token impersonation, BypassUAC |
| Suspicious commands | Encoded PowerShell, base64 decoding, net user creation |
| Network — suspicious ports | C2/backdoor ports (4444, 31337, 6667, etc.) |
| Network — known-bad IPs | Connections to known malicious infrastructure |
| Network — scanning | Port scan behavior (many distinct ports from one host) |
| Network — anomalies | Repeated connections, high-risk outbound traffic |
| Malware — file hashes | Known-malicious SHA-256 hashes |
| Malware — filenames | Filenames matching known attack tools |
| Malware — double extensions | Disguised executables (e.g. invoice.pdf.exe) |
| Malware — suspicious strings | API calls and patterns common in malware |

### AI Provider Abstraction

An `AIProvider` interface keeps LLM integration separate from analyzer logic. When `OPENAI_API_KEY` is set and the `openai` package is installed, an `OpenAIProvider` is used for enhanced reasoning. Otherwise, a `LocalFallback` provider ensures the system works fully offline. To add another provider, implement the `AIProvider` interface and register it in `create_provider()`.

### Message Bus

The Orchestrator publishes pipeline events (`pipeline.started`, `pipeline.completed`, `pipeline.error`) to an in-process message bus for logging and observability.

## Directory Structure

```
netdefenders/
├── .env.example
├── .gitignore
├── README.md
├── requirements.txt
├── config.py
├── orchestrator.py
├── analyzer.py
├── ai_provider.py
├── main.py
├── core/
│   ├── __init__.py
│   ├── models.py
│   ├── message_bus.py
│   └── logging_config.py
├── data/
│   ├── __init__.py
│   ├── sample_data.py
│   └── samples/
├── tests/
│   ├── __init__.py
│   └── test_netdefenders.py
```

## Installation

### Prerequisites

- Python 3.11 or later
- pip (comes with Python)

### Steps (Windows)

Open a Command Prompt or PowerShell in the `netdefenders` directory:

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Steps (Linux/macOS)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Environment Variables

Copy `.env.example` to `.env` and edit as needed:

```cmd
copy .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | No | (empty) | OpenAI API key for AI-enhanced analysis. When empty, the system uses deterministic local analysis. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model name to use with the OpenAI provider |
| `LOG_LEVEL` | No | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `LOG_FILE` | No | (empty) | Path to a log file. When empty, logs go to console only. |
| `MAX_RETRIES` | No | `2` | Number of retry attempts when analysis fails |

**Never commit your `.env` file.** It is in `.gitignore`.

## Running the Application

### Demo Mode

Runs the full pipeline with built-in sample security events:

```cmd
python main.py --demo
```

For JSON output:

```cmd
python main.py --demo --json
```

### Interactive Mode

Starts an interactive prompt where you can enter JSON security events:

```cmd
python main.py
```

Type `demo` to load the sample dataset, or enter events as JSON (one per line), then type `run` to analyze.

## Running Tests

```cmd
python -m pytest
```

With verbose output:

```cmd
python -m pytest -v
```

All tests run offline — no internet connection or API key is required.

## How the Analyzer Works

The `SecurityAnalyzer` receives normalized `SecurityEvent` objects and runs all detection checks in a single pass:

1. **Detect** — Each event is checked against all detection rules (processes, domains, persistence, credential attacks, privilege escalation, commands, network ports, known-bad IPs, file hashes, filenames, double extensions, suspicious strings). Aggregate checks (scanning, repeated connections) run across all network events.

2. **Correlate** — Findings are deduplicated by title so the same threat reported from multiple events appears once.

3. **Score** — Overall severity is computed from the highest finding severity score. Confidence is averaged across all findings.

4. **Recommend** — Defensive recommendations are generated from each finding's recommended action, ordered by severity (highest first), and deduplicated.

5. **Assess** — A final `SecurityAssessment` is produced containing all findings, indicators, severity, confidence, recommendations, and a human-readable summary.

## How to Configure an LLM Provider

1. Install the OpenAI package (optional):
   ```cmd
   pip install openai
   ```

2. Add your API key to `.env`:
   ```
   OPENAI_API_KEY=sk-your-key-here
   OPENAI_MODEL=gpt-4o-mini
   ```

3. Run normally — the analyzer will automatically use the OpenAI provider for enhanced reasoning.

To add a different provider (e.g. Anthropic, local LLM):

1. Create a new class implementing the `AIProvider` interface in `ai_provider.py`.
2. Add it to the `create_provider()` factory function.
3. Add the relevant environment variables to `.env.example`.

## Security Notice

NetDefenders is a **defensive** tool. It:

- Analyzes only supplied/local data
- Does NOT scan or attack external systems
- Does NOT execute unknown files
- Does NOT perform credential theft
- Does NOT deploy malware or persistence mechanisms
- Does NOT automatically execute destructive actions
- Recommends actions for human analyst approval only
