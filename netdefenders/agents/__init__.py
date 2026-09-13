"""NetDefenders agent package.

Exposes the public agent classes so they can be imported as::

    from agents import ThreatAgent, NetworkAgent, MalwareAgent, ResponseAgent
"""

from .base_agent import BaseAgent
from .threat_agent import ThreatAgent
from .network_agent import NetworkAgent
from .malware_agent import MalwareAgent
from .response_agent import ResponseAgent

__all__ = [
    "BaseAgent",
    "ThreatAgent",
    "NetworkAgent",
    "MalwareAgent",
    "ResponseAgent",
]
