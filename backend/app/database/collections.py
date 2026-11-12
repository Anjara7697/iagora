"""Noms des collections MongoDB partagés entre couches (AUDIT-ARCH-001).

Un service qui lit les décisions de l'agent n'importe plus `app.agents` pour connaître le nom de la
collection : les deux couches dépendent de ce module neutre.
"""

AGENT_RUNS = "agent_runs"
AGENT_EVENTS = "agent_events"
CONVERSATIONS = "conversations"
