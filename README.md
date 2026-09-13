# NetDefenders

AI-assisted defensive cybersecurity analysis system with multiple specialized agents coordinated by a central orchestrator.

## What NetDefenders Is

NetDefenders is a local security-analysis tool that examines security events and produces a structured threat assessment with recommended defensive actions. It uses a team of specialized agents — each focused on a different domain — that are coordinated by a central Orchestrator. The system works fully offline with deterministic pattern matching, and can optionally use an OpenAI model for enhanced reasoning when an API key is provided.

This is a **defensive** tool. It does not perform attacks, scan external systems, execute malware, or take destructive actions. It analyzes supplied data and recommends responses for a human analyst to approve.

## Architecture

```
INPUT (security events)
        │
        ▼
  Normalize & Validate
        │
        ▼
  Threat Analysis Agent ──► Findings
        │
        ▼
  Network Analysis Agent ──► Findings
        │
        ▼
  Malware/IOC Agent (when file events exist) ──► Findings
        │
        ▼
  Correlate & Deduplicate Findings
        │
        ▼
  Determine Overall Severity & Confidence
        │
        ▼
  Response Agent ──► Recommended Actions
        │
        ▼
  FINAL SECURITY ASSESSMENT
```

### Agents

| Agent | Role |
|-------|------|
| **ThreatAgent** | Detects suspicious processes, credential attacks, persistence, privilege escalation, and known attack patterns |
| **NetworkAgent** | Analyzes network events for suspicious ports, known-bad IPs, scanning behavior, and anomalous repeated connections |
| **MalwareAgent** | Performs static analysis of file metadata — hashes, filenames, double extensions, suspicious strings (never executes files) |
| **ResponseAgent** | Correlates all findings, computes overall severity, and generates prioritized defensive recommendations |

### Communication

Agents communicate through an in-process **Message Bus** (publish/subscribe). The Orchestrator sends tasks to agents via the bus and collects structured `AgentResult` objects. Each agent publishes `agent.started` and `agent.completed` messages so the orchestrator has full visibility into the pipeline.

### AI Provider Abstraction

An `AIProvider` interface keeps LLM integration separate from agent logic. When `OPENAI_API_KEY` is set and the `openai` package is installed, an `OpenAIProvider` is used. Otherwise, a `LocalFallback` provider ensures the system works fully offline. To add another provider, implement the `AIProvider` interface and register it in `create_provider()`.

## Directory Structure

```
netdefenders/
├── .env.example
├── .gitignore
├── README.md
├── requirements.txt
├── config.py
├── orchestrator.py
├── ai_provider.py
├── main.py
├── agents/
│   ├── __init__.py
│   ├── base_agent.py
│   ├── threat_agent.py
│   ├── network_agent.py
│   ├── malware_agent.py
│   └── response_agent.py
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
| `MAX_AGENT_RETRIES` | No | `2` | Number of retry attempts when an agent fails |

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

## How to Add Another Agent

1. Create a new file in `agents/` (e.g. `agents/custom_agent.py`).
2. Subclass `BaseAgent` and implement the `_run()` method:

```python
from agents.base_agent import BaseAgent
from core.models import Finding, SecurityEvent

class CustomAgent(BaseAgent):
    def __init__(self, message_bus=None, config=None):
        super().__init__("CustomAgent", "Custom Analysis", message_bus, config)

    def _run(self, events):
        findings = []
        # your analysis logic here
        return findings, f"CustomAgent analyzed {len(events)} events"
```

3. Import and register it in `agents/__init__.py`.
4. Add it to the Orchestrator's `agents` list in `orchestrator.py`.

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

3. Run normally — the system will automatically use the OpenAI provider.

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
